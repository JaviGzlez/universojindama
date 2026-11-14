-- Universo Jindama · Tareas del equipo
-- Tareas del grupo con estado (pendiente, en curso, en revisión, completada), prioridad, fecha límite,
-- uno o varios responsables (opcional) y restaurantes opcionales. Las tareas sin responsable las puede coger
-- cualquiera, y cualquiera puede apuntarse a una tarea que ya tiene responsables.
-- Ejecutar después de la migración 10. Se puede repetir sin peligro.

create table if not exists public.tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  title            text not null check (length(trim(title)) between 1 and 200),
  description      text check (description is null or length(description) <= 4000),
  status           text not null default 'pending' check (status in ('pending', 'in_progress', 'review', 'done')),
  priority         text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date         date,
  assignee_ids     uuid[] not null default '{}',
  restaurant_ids   uuid[] not null default '{}',
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  completed_at     timestamptz,
  completed_by     uuid references auth.users(id) on delete set null,
  position         double precision not null default extract(epoch from now()),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1
);
create index if not exists tasks_org_status on public.tasks (organization_id, status, position);

-- Actualización desde la primera versión (un solo responsable): se pasa a lista y se conserva el dato
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'assignee_id') then
    drop policy if exists tasks_select on public.tasks;
    drop policy if exists tasks_update on public.tasks;
    alter table public.tasks add column if not exists assignee_ids uuid[] not null default '{}';
    update public.tasks set assignee_ids = array[assignee_id] where assignee_id is not null and assignee_ids = '{}';
    alter table public.tasks drop column assignee_id;
  end if;
end $$;
drop function if exists public.can_see_task(uuid, uuid[], uuid, uuid);
drop function if exists public.can_manage_task(uuid, uuid, uuid);
create index if not exists tasks_assignees on public.tasks using gin (assignee_ids);

create table if not exists public.task_comments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  task_id          uuid not null references public.tasks(id) on delete cascade,
  author_id        uuid default auth.uid() references auth.users(id) on delete set null,
  body             text not null check (length(trim(body)) between 1 and 2000),
  created_at       timestamptz not null default now()
);
create index if not exists task_comments_task on public.task_comments (task_id, created_at);

-- ---------------------------------------------------------------------------
-- ¿Quién ve una tarea? Propietario y administradores de grupo: todas.
-- El resto: las de todo el grupo (sin restaurantes), las de sus restaurantes,
-- las que ha creado y las que tiene asignadas.
-- ---------------------------------------------------------------------------
create or replace function public.can_see_task(p_org uuid, p_restaurants uuid[], p_assignees uuid[], p_creator uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_org_member(p_org) and (
    public.has_org_role(p_org, array['admin']::public.app_role[])
    or auth.uid() = any (coalesce(p_assignees, '{}')) or coalesce(p_creator = auth.uid(), false)
    or coalesce(array_length(p_restaurants, 1), 0) = 0
    or exists (select 1 from unnest(p_restaurants) r where public.has_restaurant_access(r))
  );
$$;

-- ¿Puede editarla del todo? Propietario/administrador de grupo, quien la creó o cualquiera de sus responsables.
create or replace function public.can_manage_task(p_org uuid, p_assignees uuid[], p_creator uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_org_member(p_org) and (
    public.has_org_role(p_org, array['admin']::public.app_role[])
    or auth.uid() = any (coalesce(p_assignees, '{}')) or coalesce(p_creator = auth.uid(), false)
  );
$$;

-- Personas del grupo a las que se puede asignar una tarea
create or replace function public.org_people(p_org uuid)
returns table (user_id uuid, display_name text, all_restaurants boolean, restaurant_ids uuid[])
language sql stable security definer set search_path = public
as $$
  select m.user_id, coalesce(p.display_name, 'Usuario'),
         bool_or(m.restaurant_id is null),
         coalesce(array_agg(m.restaurant_id) filter (where m.restaurant_id is not null), '{}')
  from public.memberships m
  left join public.profiles p on p.user_id = m.user_id
  where m.organization_id = p_org and public.is_org_member(p_org)
  group by m.user_id, p.display_name
  order by coalesce(p.display_name, 'Usuario');
$$;
grant execute on function public.org_people(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reglas al guardar
-- ---------------------------------------------------------------------------
create or replace function public.tasks_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_full boolean;
begin
  if new.title is not null then new.title := trim(new.title); end if;
  new.description := nullif(trim(coalesce(new.description, '')), '');
  new.restaurant_ids := coalesce((select array_agg(distinct x) from unnest(new.restaurant_ids) x where x is not null), '{}');
  new.assignee_ids := coalesce((select array_agg(distinct x) from unnest(new.assignee_ids) x where x is not null), '{}');

  -- Restaurantes: del mismo grupo
  if exists (select 1 from unnest(new.restaurant_ids) x
             where not exists (select 1 from public.restaurants r where r.id = x and r.organization_id = new.organization_id)) then
    raise exception 'Algún restaurante no pertenece al grupo' using errcode = '22023';
  end if;
  -- Responsables: miembros del grupo
  if exists (select 1 from unnest(new.assignee_ids) x
             where not exists (select 1 from public.memberships m where m.organization_id = new.organization_id and m.user_id = x)) then
    raise exception 'Esa persona no pertenece al grupo' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.organization_id := old.organization_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    v_full := auth.uid() is null or coalesce(public.can_manage_task(old.organization_id, old.assignee_ids, old.created_by), false);
    if not v_full then
      -- Quien la ve puede apuntarse (solo añadirse a sí mismo, sin quitar a nadie) y,
      -- si estaba libre, empezarla. Nada más.
      if not (new.assignee_ids @> old.assignee_ids and new.assignee_ids <@ (old.assignee_ids || auth.uid())
              and auth.uid() = any (new.assignee_ids))
         or new.status not in (old.status, case when old.assignee_ids = '{}' then 'in_progress' end)
         or new.title is distinct from old.title or new.description is distinct from old.description
         or new.priority is distinct from old.priority or new.due_date is distinct from old.due_date
         or new.restaurant_ids is distinct from old.restaurant_ids then
        raise exception 'Solo quien la creó, quien la tiene asignada o un administrador puede cambiar esta tarea' using errcode = '42501';
      end if;
    end if;
    new.updated_at := now();
    new.version := old.version + 1;
  end if;

  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status <> 'done' then
      new.completed_at := now();
      new.completed_by := auth.uid();
    end if;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_guard on public.tasks;
create trigger tasks_guard before insert or update on public.tasks
  for each row execute function public.tasks_guard();

drop trigger if exists tasks_audit on public.tasks;
create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function public.audit_row();

create or replace function public.task_comments_fill()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  select t.organization_id into new.organization_id from public.tasks t where t.id = new.task_id;
  new.author_id := coalesce(auth.uid(), new.author_id);
  new.body := trim(new.body);
  return new;
end;
$$;
drop trigger if exists a0_fill_org_task_comments on public.task_comments;
create trigger a0_fill_org_task_comments before insert on public.task_comments
  for each row execute function public.task_comments_fill();

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (public.can_see_task(organization_id, restaurant_ids, assignee_ids, created_by));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.is_org_member(organization_id));

-- La regla fina (quién cambia qué) está en tasks_guard
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_see_task(organization_id, restaurant_ids, assignee_ids, created_by))
  with check (public.is_org_member(organization_id));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.app_role[]) or created_by = auth.uid());

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments for delete to authenticated
  using (author_id = auth.uid() or public.has_org_role(organization_id, array['owner']::public.app_role[]));

grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, delete on public.task_comments to authenticated;
