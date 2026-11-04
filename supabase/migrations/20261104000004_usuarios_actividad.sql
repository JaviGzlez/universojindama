-- Universo Jindama · Usuarios con nombre y actividad visible para el equipo
-- Ejecutar DESPUÉS de las tres primeras migraciones. Se puede repetir sin peligro.

-- ---------------------------------------------------------------------------
-- Perfiles: nombre visible de cada usuario (sin datos personales sensibles)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (length(trim(display_name)) > 0),
  email         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Crea el perfil al dar de alta un usuario (desde el panel o desde Supabase)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Perfiles de usuarios que ya existían
insert into public.profiles (user_id, display_name, email)
select u.id, split_part(u.email, '@', 1), u.email
from auth.users u
on conflict (user_id) do nothing;

-- ¿Comparte organización con el usuario actual?
create or replace function public.shares_org_with(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_user = auth.uid() or exists (
    select 1 from public.memberships a
    join public.memberships b on a.organization_id = b.organization_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- ¿El usuario actual es propietario de alguna organización del otro usuario?
create or replace function public.can_manage_user(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships a
    join public.memberships b on a.organization_id = b.organization_id
    where a.user_id = auth.uid() and a.role = 'owner' and b.user_id = p_user
  );
$$;

alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (public.shares_org_with(user_id));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (user_id = auth.uid() or public.can_manage_user(user_id))
  with check (user_id = auth.uid() or public.can_manage_user(user_id));

-- ---------------------------------------------------------------------------
-- Actividad: todos los miembros ven lo que se hace en los restaurantes a los
-- que tienen acceso, y los cambios de la organización (catálogo compartido,
-- accesos). Antes solo la veía el propietario.
-- ---------------------------------------------------------------------------
drop policy if exists audit_select on public.audit_events;
create policy audit_select on public.audit_events
  for select to authenticated
  using (
    organization_id is not null
    and public.is_org_member(organization_id)
    and (restaurant_id is null or public.has_restaurant_access(restaurant_id))
  );

create index if not exists audit_events_org on public.audit_events (organization_id, occurred_at desc);

-- Los cambios de nombre también quedan registrados
create or replace function public.audit_profile()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.display_name is distinct from old.display_name then
    insert into public.audit_events (organization_id, restaurant_id, actor_id, table_name, row_id, action, old_data, new_data)
    select distinct m.organization_id, null::uuid, auth.uid(), 'profiles', new.user_id::text, 'UPDATE',
           jsonb_build_object('display_name', old.display_name), jsonb_build_object('display_name', new.display_name)
    from public.memberships m where m.user_id = new.user_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit before update on public.profiles
  for each row execute function public.audit_profile();

-- ---------------------------------------------------------------------------
-- Gestión de accesos por el propietario (operaciones atómicas)
--   p_restaurants NULL = acceso a todos los restaurantes de la organización
-- ---------------------------------------------------------------------------
create or replace function public.set_member_access(p_org uuid, p_user uuid, p_role public.app_role, p_restaurants uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_org_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'Solo el propietario puede gestionar accesos' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'El rol de propietario no se asigna desde el panel';
  end if;
  if p_user = auth.uid() then
    raise exception 'No puedes cambiar tu propio acceso';
  end if;
  if exists (select 1 from public.memberships where organization_id = p_org and user_id = p_user and role = 'owner') then
    raise exception 'No se puede modificar el acceso de otro propietario';
  end if;
  if p_restaurants is not null and cardinality(p_restaurants) = 0 then
    raise exception 'Elige al menos un restaurante';
  end if;
  if p_restaurants is not null and exists (
    select 1 from unnest(p_restaurants) as r(id)
    where not exists (select 1 from public.restaurants x where x.id = r.id and x.organization_id = p_org)
  ) then
    raise exception 'Restaurante no válido';
  end if;

  delete from public.memberships where organization_id = p_org and user_id = p_user;

  if p_restaurants is null then
    insert into public.memberships (organization_id, restaurant_id, user_id, role) values (p_org, null, p_user, p_role);
  else
    insert into public.memberships (organization_id, restaurant_id, user_id, role)
    select p_org, r.id, p_user, p_role from unnest(p_restaurants) as r(id);
  end if;
end;
$$;

create or replace function public.remove_member(p_org uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_org_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'Solo el propietario puede gestionar accesos' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'No puedes quitarte el acceso a ti mismo';
  end if;
  if exists (select 1 from public.memberships where organization_id = p_org and user_id = p_user and role = 'owner') then
    raise exception 'No se puede quitar el acceso a otro propietario';
  end if;
  delete from public.memberships where organization_id = p_org and user_id = p_user;
end;
$$;

revoke execute on function public.set_member_access(uuid, uuid, public.app_role, uuid[]) from public, anon;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.set_member_access(uuid, uuid, public.app_role, uuid[]) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- grant_owner acepta también un nombre de usuario («admin»)
create or replace function public.grant_owner(p_email text, p_org_slug text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_user uuid;
  v_org  uuid;
begin
  if position('@' in v_email) = 0 then
    v_email := v_email || '@usuarios.universojindama.com';
  end if;
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is null then
    raise exception 'No existe el usuario %. Créalo antes en Authentication → Users.', v_email;
  end if;
  select id into v_org from public.organizations where slug = p_org_slug;
  if v_org is null then
    raise exception 'No existe la organización %', p_org_slug;
  end if;
  insert into public.memberships (organization_id, user_id, role)
  values (v_org, v_user, 'owner')
  on conflict do nothing;
  return 'Propietario asignado';
end;
$$;

revoke execute on function public.grant_owner(text, text) from public, anon, authenticated;
