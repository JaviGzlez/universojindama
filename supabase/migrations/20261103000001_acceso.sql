-- Universo Jindama · Fase 1 · Acceso, organizaciones y restaurantes
-- Jerarquía: organización → restaurantes → usuarios, catálogos y actividad.


-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.app_role as enum (
  'owner',        -- Propietario: organización completa
  'admin',        -- Administrador: restaurantes asignados
  'kitchen',      -- Cocina: recetas, ingredientes, equipos y escandallos
  'purchasing',   -- Compras: proveedores, facturas y precios
  'accounting',   -- Administración: gastos, personal y control económico
  'viewer'        -- Consulta: resultados e informes autorizados
);

create type public.record_status as enum ('active', 'archived');

-- ---------------------------------------------------------------------------
-- Utilidades comunes: updated_at + versión (control de concurrencia)
-- ---------------------------------------------------------------------------
create or replace function public.touch_row()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizaciones y restaurantes
-- ---------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  status      public.record_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1
);

create table public.restaurants (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  name             text not null check (length(trim(name)) > 0),
  slug             text not null check (slug ~ '^[a-z0-9-]+$'),
  currency         char(3) not null default 'EUR',
  timezone         text not null default 'Europe/Madrid',
  status           public.record_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  unique (organization_id, slug),
  -- permite claves compuestas que garantizan que un registro de restaurante
  -- pertenece a la misma organización que declara
  unique (id, organization_id)
);

create table public.restaurant_settings (
  restaurant_id     uuid primary key references public.restaurants(id) on delete cascade,
  organization_id   uuid not null,
  opening_hours     jsonb not null default '{}'::jsonb,
  -- política de valoración de precios: último validado o media ponderada
  price_policy      text not null default 'last_validated'
                    check (price_policy in ('last_validated', 'weighted_average')),
  -- política de redondeo al presentar (el cálculo interno conserva precisión)
  money_decimals    smallint not null default 2 check (money_decimals between 0 and 6),
  targets           jsonb not null default '{}'::jsonb,
  alert_thresholds  jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);

-- ---------------------------------------------------------------------------
-- Pertenencias. restaurant_id NULL = el rol aplica a todos los restaurantes
-- de la organización. El rol owner siempre es de organización completa.
-- ---------------------------------------------------------------------------
create table public.memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  restaurant_id    uuid,
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             public.app_role not null,
  created_at       timestamptz not null default now(),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id) on delete cascade,
  check (role <> 'owner' or restaurant_id is null)
);

create unique index memberships_unique
  on public.memberships (organization_id, user_id, role, coalesce(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index memberships_user on public.memberships (user_id);

create trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_row();
create trigger restaurants_touch before update on public.restaurants
  for each row execute function public.touch_row();
create trigger restaurant_settings_touch before update on public.restaurant_settings
  for each row execute function public.touch_row();

-- ---------------------------------------------------------------------------
-- Funciones de autorización (security definer para evitar recursión de RLS).
-- La API y la IA usan exactamente estas mismas comprobaciones.
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.restaurant_id is null
      and (m.role = 'owner' or m.role = any (p_roles))
  );
$$;

create or replace function public.has_restaurant_access(p_restaurant uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.restaurants r
    join public.memberships m on m.organization_id = r.organization_id
    where r.id = p_restaurant
      and m.user_id = auth.uid()
      and (m.restaurant_id is null or m.restaurant_id = r.id)
  );
$$;

create or replace function public.has_restaurant_role(p_restaurant uuid, p_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.restaurants r
    join public.memberships m on m.organization_id = r.organization_id
    where r.id = p_restaurant
      and m.user_id = auth.uid()
      and (m.restaurant_id is null or m.restaurant_id = r.id)
      and (m.role = 'owner' or m.role = 'admin' or m.role = any (p_roles))
  );
$$;

-- ---------------------------------------------------------------------------
-- Auditoría de cambios sensibles
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id               bigint generated always as identity primary key,
  organization_id  uuid,
  restaurant_id    uuid,
  actor_id         uuid,
  table_name       text not null,
  row_id           text,
  action           text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data         jsonb,
  new_data         jsonb,
  occurred_at      timestamptz not null default now()
);
create index audit_events_restaurant on public.audit_events (restaurant_id, occurred_at desc);

create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  insert into public.audit_events (organization_id, restaurant_id, actor_id, table_name, row_id, action, old_data, new_data)
  values (
    nullif(v_row->>'organization_id', '')::uuid,
    case
      when tg_table_name = 'restaurants' then (v_row->>'id')::uuid
      else nullif(v_row->>'restaurant_id', '')::uuid
    end,
    auth.uid(),
    tg_table_name,
    coalesce(v_row->>'id', v_row->>'restaurant_id'),
    tg_op,
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;

create trigger restaurants_audit after insert or update or delete on public.restaurants
  for each row execute function public.audit_row();
create trigger restaurant_settings_audit after insert or update or delete on public.restaurant_settings
  for each row execute function public.audit_row();
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function public.audit_row();

-- Al crear un restaurante se crean sus ajustes por defecto
create or replace function public.create_default_settings()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.restaurant_settings (restaurant_id, organization_id)
  values (new.id, new.organization_id)
  on conflict do nothing;
  return new;
end;
$$;

create trigger restaurants_default_settings after insert on public.restaurants
  for each row execute function public.create_default_settings();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.organizations       enable row level security;
alter table public.restaurants         enable row level security;
alter table public.restaurant_settings enable row level security;
alter table public.memberships         enable row level security;
alter table public.audit_events        enable row level security;

create policy organizations_select on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy organizations_update on public.organizations
  for update to authenticated using (public.has_org_role(id, array['owner']::public.app_role[]));

create policy restaurants_select on public.restaurants
  for select to authenticated using (public.has_restaurant_access(id));
create policy restaurants_insert on public.restaurants
  for insert to authenticated with check (public.has_org_role(organization_id, array['owner']::public.app_role[]));
create policy restaurants_update on public.restaurants
  for update to authenticated using (public.has_restaurant_role(id, array[]::public.app_role[]));

create policy settings_select on public.restaurant_settings
  for select to authenticated using (public.has_restaurant_access(restaurant_id));
create policy settings_update on public.restaurant_settings
  for update to authenticated using (public.has_restaurant_role(restaurant_id, array['accounting']::public.app_role[]));

create policy memberships_select on public.memberships
  for select to authenticated
  using (user_id = auth.uid() or public.has_org_role(organization_id, array['owner']::public.app_role[]));
create policy memberships_write on public.memberships
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.app_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.app_role[]));

create policy audit_select on public.audit_events
  for select to authenticated
  using (organization_id is not null and public.has_org_role(organization_id, array['owner']::public.app_role[]));

-- ---------------------------------------------------------------------------
-- Alta del primer propietario. Solo ejecutable desde el editor SQL de
-- Supabase (rol postgres / service_role), nunca desde el cliente.
--   select public.grant_owner('tu@email.com', 'grupo-jindama');
-- ---------------------------------------------------------------------------
create or replace function public.grant_owner(p_email text, p_org_slug text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_org  uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    raise exception 'No existe ningún usuario con el email %. Regístrate primero en /acceso.', p_email;
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

revoke execute on function public.grant_owner(text, text) from public;
revoke execute on function public.grant_owner(text, text) from anon, authenticated;
