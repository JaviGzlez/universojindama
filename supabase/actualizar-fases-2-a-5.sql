-- Universo Jindama · Actualización fases 2 a 5 (migraciones 5, 6, 7 y 8 juntas)
-- Pegar entero en Supabase → SQL Editor → Run. Se puede repetir sin peligro.

-- =======================================================================
-- 20261104000005_recetas.sql
-- =======================================================================
-- Universo Jindama · Fase 2 · Recetas, elaboraciones, escandallos guardados e histórico de costes
-- Ejecutar después de la migración 4. Se puede repetir sin peligro.

-- ---------------------------------------------------------------------------
-- Utilidades para tablas por restaurante (políticas y triggers estándar)
-- ---------------------------------------------------------------------------
create or replace function public.uj_standard_table(p_table text, p_write_roles text[], p_touch boolean default true)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_select', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_insert', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_update', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_delete', p_table);
  execute format('create policy %I on public.%I for select to authenticated using (public.has_restaurant_access(restaurant_id))', p_table || '_select', p_table);
  execute format('create policy %I on public.%I for insert to authenticated with check (public.has_restaurant_role(restaurant_id, %L::public.app_role[]))', p_table || '_insert', p_table, p_write_roles);
  execute format('create policy %I on public.%I for update to authenticated using (public.has_restaurant_role(restaurant_id, %L::public.app_role[])) with check (public.has_restaurant_role(restaurant_id, %L::public.app_role[]))', p_table || '_update', p_table, p_write_roles, p_write_roles);
  execute format('create policy %I on public.%I for delete to authenticated using (public.has_restaurant_role(restaurant_id, %L::public.app_role[]))', p_table || '_delete', p_table, p_write_roles);

  execute format('drop trigger if exists %I on public.%I', 'a0_fill_org_' || p_table, p_table);
  execute format('create trigger %I before insert on public.%I for each row execute function public.fill_organization_from_restaurant()', 'a0_fill_org_' || p_table, p_table);
  execute format('drop trigger if exists %I on public.%I', p_table || '_audit', p_table);
  execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', p_table || '_audit', p_table);
  if p_touch then
    execute format('drop trigger if exists %I on public.%I', p_table || '_touch', p_table);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_row()', p_table || '_touch', p_table);
  end if;
end;
$$;
revoke execute on function public.uj_standard_table(text, text[], boolean) from public, anon, authenticated;

do $$ begin
  create type public.recipe_kind as enum ('preparation', 'dish');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.version_status as enum ('draft', 'active', 'superseded');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.quantity_unit as enum ('g', 'kg', 'ml', 'l', 'unit');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Recetas: elaboraciones intermedias (salsa, caldo, masa) y platos de venta
-- ---------------------------------------------------------------------------
create table if not exists public.recipes (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  restaurant_id      uuid not null,
  name               text not null check (length(trim(name)) > 0),
  kind               public.recipe_kind not null,
  category           text,
  active_version_id  uuid,
  status             public.record_status not null default 'active',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            integer not null default 1,
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
create index if not exists recipes_restaurant on public.recipes (restaurant_id, kind, name);

create table if not exists public.recipe_versions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  restaurant_id         uuid not null,
  recipe_id             uuid not null references public.recipes(id) on delete cascade,
  number                integer not null,
  status                public.version_status not null default 'draft',
  -- elaboración: cantidad producida en unidad base (g, ml o ud) por tanda
  yield_quantity        numeric(14,4) check (yield_quantity > 0),
  yield_unit            public.base_unit,
  -- plato: raciones vendibles por tanda
  portions              numeric(10,2) check (portions > 0),
  labor_is_variable     boolean not null default false,
  use_overheads         boolean not null default true,
  steps                 text,
  notes                 text,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  version               integer not null default 1,
  activated_at          timestamptz,
  activated_by          uuid,
  unique (recipe_id, number),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);

create table if not exists public.recipe_ingredients (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  version_id        uuid not null references public.recipe_versions(id) on delete cascade,
  position          integer not null default 0,
  ingredient_id     uuid references public.ingredients(id),
  sub_recipe_id     uuid references public.recipes(id),
  quantity          numeric(14,4) not null check (quantity >= 0),
  unit              public.quantity_unit not null,
  quantity_type     text not null default 'net' check (quantity_type in ('net', 'gross')),
  check ((ingredient_id is null) <> (sub_recipe_id is null)),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
create index if not exists recipe_ingredients_version on public.recipe_ingredients (version_id);
create index if not exists recipe_ingredients_ing on public.recipe_ingredients (ingredient_id);
create index if not exists recipe_ingredients_sub on public.recipe_ingredients (sub_recipe_id);

create table if not exists public.recipe_equipment_usage (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  restaurant_id         uuid not null,
  version_id            uuid not null references public.recipe_versions(id) on delete cascade,
  equipment_id          uuid not null references public.equipment(id),
  minutes               numeric(10,2) not null check (minutes >= 0),
  usage_share           numeric(7,6) not null default 1 check (usage_share > 0 and usage_share <= 1),
  preheat_share         numeric(7,6) not null default 1 check (preheat_share >= 0 and preheat_share <= 1),
  measured_consumption  numeric(14,6) check (measured_consumption >= 0),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);

create table if not exists public.recipe_labor_usage (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  restaurant_id      uuid not null,
  version_id         uuid not null references public.recipe_versions(id) on delete cascade,
  labor_profile_id   uuid not null references public.labor_profiles(id),
  active_minutes     numeric(10,2) not null check (active_minutes >= 0),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);

create table if not exists public.recipe_consumables (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  version_id        uuid not null references public.recipe_versions(id) on delete cascade,
  consumable_id     uuid not null references public.consumables(id),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);

-- ---------------------------------------------------------------------------
-- Fotografías de coste: nunca se reescriben
-- ---------------------------------------------------------------------------
create table if not exists public.cost_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  restaurant_id        uuid not null,
  recipe_id            uuid not null references public.recipes(id) on delete cascade,
  recipe_version_id    uuid not null references public.recipe_versions(id) on delete cascade,
  valuation_date       date not null default current_date,
  status               text not null check (status in ('complete', 'estimated', 'incomplete')),
  direct_per_unit      numeric(18,8),   -- por ración (plato) o por g/ml/ud (elaboración)
  full_per_unit        numeric(18,8),
  batch_direct         numeric(18,8),
  reason               text not null default 'manual' check (reason in ('manual', 'activation', 'price_change', 'recalculation')),
  result               jsonb not null,
  engine_version       text not null,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
create index if not exists cost_snapshots_recipe on public.cost_snapshots (recipe_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Avisos (cambios de coste, datos pendientes…)
-- ---------------------------------------------------------------------------
create table if not exists public.alerts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  kind              text not null,
  severity          text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title             text not null,
  body              text,
  data              jsonb not null default '{}'::jsonb,
  resolved_at       timestamptz,
  resolved_by       uuid,
  created_at        timestamptz not null default now(),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
create index if not exists alerts_open on public.alerts (restaurant_id, created_at desc) where resolved_at is null;

-- ---------------------------------------------------------------------------
-- Integridad
-- ---------------------------------------------------------------------------
-- Las líneas solo se editan en versiones en borrador
create or replace function public.check_version_draft()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_status public.version_status;
begin
  select status into v_status from public.recipe_versions where id = coalesce(new.version_id, old.version_id);
  -- v_status nulo = la versión se está borrando en cascada
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Solo se pueden modificar versiones en borrador. Crea una versión nueva.';
  end if;
  return coalesce(new, old);
end;
$$;

-- Bloquea referencias circulares entre elaboraciones y exige que la subreceta sea una elaboración del mismo restaurante
create or replace function public.check_sub_recipe()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_recipe uuid;
  v_kind public.recipe_kind;
  v_rest uuid;
  v_cycle boolean;
begin
  if new.sub_recipe_id is null then return new; end if;
  select recipe_id into v_recipe from public.recipe_versions where id = new.version_id;
  select kind, restaurant_id into v_kind, v_rest from public.recipes where id = new.sub_recipe_id;
  if v_kind is distinct from 'preparation' then
    raise exception 'Solo se pueden usar elaboraciones intermedias dentro de otra receta';
  end if;
  if v_rest <> new.restaurant_id then
    raise exception 'La elaboración debe ser del mismo restaurante';
  end if;
  -- ¿la subreceta (en cualquiera de sus versiones) usa, directa o indirectamente, la receta actual?
  with recursive usa(recipe_id) as (
    select new.sub_recipe_id
    union
    select ri.sub_recipe_id
    from usa
    join public.recipe_versions rv on rv.recipe_id = usa.recipe_id
    join public.recipe_ingredients ri on ri.version_id = rv.id
    where ri.sub_recipe_id is not null
  )
  select exists (select 1 from usa where recipe_id = v_recipe) into v_cycle;
  if v_cycle then
    raise exception 'Referencia circular: esa elaboración ya usa esta receta';
  end if;
  return new;
end;
$$;

-- Ingredientes visibles desde el restaurante
create or replace function public.check_line_ingredient()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ok boolean;
begin
  if new.ingredient_id is null then return new; end if;
  select (i.organization_id = new.organization_id and (i.restaurant_id is null or i.restaurant_id = new.restaurant_id))
    into v_ok from public.ingredients i where i.id = new.ingredient_id;
  if not coalesce(v_ok, false) then
    raise exception 'El ingrediente no pertenece a este restaurante';
  end if;
  return new;
end;
$$;

-- Recursos (equipos, perfiles, consumibles) del mismo restaurante que la versión
create or replace function public.check_line_resource()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_rest uuid; v_res_rest uuid;
begin
  select restaurant_id into v_rest from public.recipe_versions where id = new.version_id;
  if v_rest is distinct from new.restaurant_id then
    raise exception 'La línea debe pertenecer al restaurante de la receta';
  end if;
  if tg_table_name = 'recipe_equipment_usage' then
    select restaurant_id into v_res_rest from public.equipment where id = new.equipment_id;
  elsif tg_table_name = 'recipe_labor_usage' then
    select restaurant_id into v_res_rest from public.labor_profiles where id = new.labor_profile_id;
  elsif tg_table_name = 'recipe_consumables' then
    select restaurant_id into v_res_rest from public.consumables where id = new.consumable_id;
  else
    return new;
  end if;
  if v_res_rest is distinct from new.restaurant_id then
    raise exception 'El recurso no pertenece a este restaurante';
  end if;
  return new;
end;
$$;

select public.uj_standard_table('recipes', array['kitchen']);
select public.uj_standard_table('recipe_versions', array['kitchen']);
select public.uj_standard_table('recipe_ingredients', array['kitchen'], false);
select public.uj_standard_table('recipe_equipment_usage', array['kitchen'], false);
select public.uj_standard_table('recipe_labor_usage', array['kitchen'], false);
select public.uj_standard_table('recipe_consumables', array['kitchen'], false);
-- las fotografías de coste las genera cualquier rol que cambie precios o recetas
select public.uj_standard_table('cost_snapshots', array['kitchen', 'purchasing', 'accounting'], false);
select public.uj_standard_table('alerts', array['kitchen', 'purchasing', 'accounting'], false);

-- las fotografías no se modifican ni se borran
drop policy if exists cost_snapshots_update on public.cost_snapshots;
drop policy if exists cost_snapshots_delete on public.cost_snapshots;
drop policy if exists alerts_delete on public.alerts;

do $$
declare t text;
begin
  foreach t in array array['recipe_ingredients', 'recipe_equipment_usage', 'recipe_labor_usage', 'recipe_consumables']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_draft', t);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.check_version_draft()', t || '_draft', t);
  end loop;
  foreach t in array array['recipe_equipment_usage', 'recipe_labor_usage', 'recipe_consumables']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_resource', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.check_line_resource()', t || '_resource', t);
  end loop;
end $$;

drop trigger if exists recipe_ingredients_sub on public.recipe_ingredients;
create trigger recipe_ingredients_sub before insert or update on public.recipe_ingredients
  for each row execute function public.check_sub_recipe();
drop trigger if exists recipe_ingredients_ing on public.recipe_ingredients;
create trigger recipe_ingredients_ing before insert or update on public.recipe_ingredients
  for each row execute function public.check_line_ingredient();

-- Una versión activa o sustituida no se modifica (salvo la propia activación)
create or replace function public.check_version_locked()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'draft' and (
       new.yield_quantity is distinct from old.yield_quantity or new.yield_unit is distinct from old.yield_unit
    or new.portions is distinct from old.portions or new.labor_is_variable is distinct from old.labor_is_variable
    or new.use_overheads is distinct from old.use_overheads or new.recipe_id is distinct from old.recipe_id) then
    raise exception 'Esta versión ya no es un borrador: crea una versión nueva para cambiarla';
  end if;
  return new;
end;
$$;
drop trigger if exists recipe_versions_locked on public.recipe_versions;
create trigger recipe_versions_locked before update on public.recipe_versions
  for each row execute function public.check_version_locked();

-- ---------------------------------------------------------------------------
-- Operaciones
-- ---------------------------------------------------------------------------
-- Nueva versión: copia la activa (o la última) como borrador
create or replace function public.new_recipe_version(p_recipe uuid)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_src uuid;
  v_new uuid;
  v_num integer;
begin
  if exists (select 1 from public.recipe_versions where recipe_id = p_recipe and status = 'draft') then
    raise exception 'Ya hay un borrador abierto para esta receta';
  end if;
  select coalesce(r.active_version_id, (select id from public.recipe_versions where recipe_id = p_recipe order by number desc limit 1))
    into v_src from public.recipes r where r.id = p_recipe;
  select coalesce(max(number), 0) + 1 into v_num from public.recipe_versions where recipe_id = p_recipe;

  insert into public.recipe_versions (restaurant_id, recipe_id, number, yield_quantity, yield_unit, portions, labor_is_variable, use_overheads, steps, notes)
  select r.restaurant_id, r.id, v_num, v.yield_quantity, v.yield_unit, v.portions, coalesce(v.labor_is_variable, false), coalesce(v.use_overheads, true), v.steps, v.notes
  from public.recipes r left join public.recipe_versions v on v.id = v_src
  where r.id = p_recipe
  returning id into v_new;

  if v_src is not null then
    insert into public.recipe_ingredients (restaurant_id, version_id, position, ingredient_id, sub_recipe_id, quantity, unit, quantity_type)
      select restaurant_id, v_new, position, ingredient_id, sub_recipe_id, quantity, unit, quantity_type from public.recipe_ingredients where version_id = v_src;
    insert into public.recipe_equipment_usage (restaurant_id, version_id, equipment_id, minutes, usage_share, preheat_share, measured_consumption)
      select restaurant_id, v_new, equipment_id, minutes, usage_share, preheat_share, measured_consumption from public.recipe_equipment_usage where version_id = v_src;
    insert into public.recipe_labor_usage (restaurant_id, version_id, labor_profile_id, active_minutes)
      select restaurant_id, v_new, labor_profile_id, active_minutes from public.recipe_labor_usage where version_id = v_src;
    insert into public.recipe_consumables (restaurant_id, version_id, consumable_id)
      select restaurant_id, v_new, consumable_id from public.recipe_consumables where version_id = v_src;
  end if;
  return v_new;
end;
$$;

-- Activar: la anterior pasa a sustituida. Las fotografías de coste se conservan.
create or replace function public.activate_recipe_version(p_version uuid)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_recipe uuid;
  v_status public.version_status;
  v_kind public.recipe_kind;
  v_yield numeric;
  v_portions numeric;
begin
  select rv.recipe_id, rv.status, r.kind, rv.yield_quantity, rv.portions
    into v_recipe, v_status, v_kind, v_yield, v_portions
  from public.recipe_versions rv join public.recipes r on r.id = rv.recipe_id
  where rv.id = p_version
  for update of rv;
  if v_recipe is null then raise exception 'Versión no encontrada'; end if;
  if v_status <> 'draft' then raise exception 'Solo se puede activar un borrador'; end if;
  if v_kind = 'dish' and v_portions is null then raise exception 'Indica las raciones vendibles antes de activar'; end if;
  if v_kind = 'preparation' and v_yield is null then raise exception 'Indica la cantidad producida antes de activar'; end if;
  if not exists (select 1 from public.recipe_ingredients where version_id = p_version) then
    raise exception 'La receta no tiene ingredientes';
  end if;

  update public.recipe_versions set status = 'superseded' where recipe_id = v_recipe and status = 'active';
  update public.recipe_versions set status = 'active', activated_at = now(), activated_by = auth.uid() where id = p_version;
  update public.recipes set active_version_id = p_version where id = v_recipe;
end;
$$;

grant execute on function public.new_recipe_version(uuid) to authenticated;
grant execute on function public.activate_recipe_version(uuid) to authenticated;

-- ¿Qué recetas activas dependen (directa o indirectamente) de estos ingredientes?
create or replace function public.recipes_using_ingredients(p_restaurant uuid, p_ingredients uuid[])
returns table (recipe_id uuid)
language sql stable security invoker set search_path = public
as $$
  with recursive afectadas(recipe_id) as (
    select rv.recipe_id
    from public.recipe_ingredients ri
    join public.recipe_versions rv on rv.id = ri.version_id and rv.status = 'active'
    where ri.restaurant_id = p_restaurant and ri.ingredient_id = any (p_ingredients)
    union
    select rv.recipe_id
    from afectadas a
    join public.recipe_ingredients ri on ri.sub_recipe_id = a.recipe_id
    join public.recipe_versions rv on rv.id = ri.version_id and rv.status = 'active'
  )
  select distinct recipe_id from afectadas;
$$;
grant execute on function public.recipes_using_ingredients(uuid, uuid[]) to authenticated;

-- Guardar un borrador completo de una vez (cabecera + líneas), con control de versión
create or replace function public.save_recipe_draft(p_version uuid, p_expected integer, p_data jsonb)
returns integer
language plpgsql security invoker set search_path = public
as $$
declare
  v record;
  v_new integer;
begin
  select * into v from public.recipe_versions where id = p_version for update;
  if v.id is null then raise exception 'Versión no encontrada'; end if;
  if v.status <> 'draft' then raise exception 'Solo se pueden editar borradores'; end if;
  if v.version <> p_expected then raise exception 'Otra persona ha guardado cambios en este borrador. Recarga la página.'; end if;

  update public.recipe_versions set
    portions = nullif(p_data->>'portions', '')::numeric,
    yield_quantity = nullif(p_data->>'yield_quantity', '')::numeric,
    yield_unit = nullif(p_data->>'yield_unit', '')::public.base_unit,
    labor_is_variable = coalesce((p_data->>'labor_is_variable')::boolean, false),
    use_overheads = coalesce((p_data->>'use_overheads')::boolean, true),
    steps = nullif(p_data->>'steps', ''),
    notes = nullif(p_data->>'notes', '')
  where id = p_version
  returning version into v_new;

  delete from public.recipe_ingredients where version_id = p_version;
  delete from public.recipe_equipment_usage where version_id = p_version;
  delete from public.recipe_labor_usage where version_id = p_version;
  delete from public.recipe_consumables where version_id = p_version;

  insert into public.recipe_ingredients (restaurant_id, version_id, position, ingredient_id, sub_recipe_id, quantity, unit, quantity_type)
  select v.restaurant_id, p_version, (x.ord - 1)::int, nullif(x.e->>'ingredient_id', '')::uuid, nullif(x.e->>'sub_recipe_id', '')::uuid,
         (x.e->>'quantity')::numeric, (x.e->>'unit')::public.quantity_unit, coalesce(x.e->>'quantity_type', 'net')
  from jsonb_array_elements(coalesce(p_data->'ingredientes', '[]'::jsonb)) with ordinality as x(e, ord);

  insert into public.recipe_equipment_usage (restaurant_id, version_id, equipment_id, minutes, usage_share, preheat_share, measured_consumption)
  select v.restaurant_id, p_version, (e->>'equipment_id')::uuid, (e->>'minutes')::numeric,
         coalesce(nullif(e->>'usage_share', '')::numeric, 1), coalesce(nullif(e->>'preheat_share', '')::numeric, 1),
         nullif(e->>'measured_consumption', '')::numeric
  from jsonb_array_elements(coalesce(p_data->'equipos', '[]'::jsonb)) as e;

  insert into public.recipe_labor_usage (restaurant_id, version_id, labor_profile_id, active_minutes)
  select v.restaurant_id, p_version, (e->>'labor_profile_id')::uuid, (e->>'active_minutes')::numeric
  from jsonb_array_elements(coalesce(p_data->'personal', '[]'::jsonb)) as e;

  insert into public.recipe_consumables (restaurant_id, version_id, consumable_id)
  select v.restaurant_id, p_version, (e->>'consumable_id')::uuid
  from jsonb_array_elements(coalesce(p_data->'consumibles', '[]'::jsonb)) as e;

  return v_new;
end;
$$;
grant execute on function public.save_recipe_draft(uuid, integer, jsonb) to authenticated;

-- Último coste guardado de cada receta
create or replace view public.latest_cost_snapshots
with (security_invoker = true) as
select distinct on (recipe_id) id, restaurant_id, recipe_id, recipe_version_id, status, direct_per_unit, full_per_unit, created_at, reason
from public.cost_snapshots
order by recipe_id, created_at desc;

-- =======================================================================
-- 20261104000006_compras.sql
-- =======================================================================
-- Universo Jindama · Fase 3 · Proveedores, productos y facturas de compra
-- Separar ingrediente (aceite de oliva), producto de proveedor (garrafa 5 l marca X)
-- y compra (3 garrafas a un precio y fecha). Solo «registrar» aplica precios e inventario.

do $$ begin
  create type public.invoice_status as enum ('draft', 'review', 'validated', 'posted', 'void');
exception when duplicate_object then null; end $$;

create table if not exists public.suppliers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  name              text not null check (length(trim(name)) > 0),
  tax_id            text,
  contact           text,
  phone             text,
  email             text,
  notes             text,
  status            public.record_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
-- No se fusionan proveedores por parecido de nombre; solo se evita el duplicado exacto
create unique index if not exists suppliers_unique_name on public.suppliers (restaurant_id, lower(trim(name))) where status = 'active';

create table if not exists public.supplier_products (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  supplier_id       uuid not null references public.suppliers(id),
  ingredient_id     uuid not null references public.ingredients(id),
  reference         text,
  brand             text,
  description       text not null,          -- «Garrafa 5 l»
  pack_quantity     numeric(14,4) not null check (pack_quantity > 0),
  pack_unit         public.quantity_unit not null,
  last_price        numeric(14,4),          -- precio por envase, sin impuestos recuperables
  last_price_date   date,
  status            public.record_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);

create table if not exists public.purchase_invoices (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  supplier_id       uuid not null references public.suppliers(id),
  number            text not null check (length(trim(number)) > 0),
  invoice_date      date not null,
  currency          char(3) not null default 'EUR',
  status            public.invoice_status not null default 'draft',
  discount_total    numeric(14,2) not null default 0 check (discount_total >= 0),  -- descuento de cabecera
  shipping          numeric(14,2) not null default 0 check (shipping >= 0),        -- portes
  tax_total         numeric(14,2),
  total             numeric(14,2),           -- total del documento, para cuadrar
  notes             text,
  validated_at      timestamptz,
  validated_by      uuid,
  posted_at         timestamptz,
  posted_by         uuid,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
-- Detección de duplicados: mismo proveedor y número en el mismo restaurante
create unique index if not exists purchase_invoices_unique on public.purchase_invoices (restaurant_id, supplier_id, lower(trim(number))) where status <> 'void';

create table if not exists public.purchase_lines (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  restaurant_id         uuid not null,
  invoice_id            uuid not null references public.purchase_invoices(id) on delete cascade,
  position              integer not null default 0,
  supplier_product_id   uuid references public.supplier_products(id),
  ingredient_id         uuid references public.ingredients(id),
  description           text not null,
  packs                 numeric(14,4) not null check (packs > 0),            -- envases comprados
  pack_quantity         numeric(14,4) not null check (pack_quantity > 0),    -- contenido por envase
  pack_unit             public.quantity_unit not null,
  pack_price            numeric(14,4) not null check (pack_price >= 0),      -- precio por envase sin IVA
  discount_pct          numeric(7,4) not null default 0 check (discount_pct >= 0 and discount_pct < 100),
  tax_rate              numeric(7,6) not null default 0 check (tax_rate >= 0 and tax_rate < 1),
  -- calculados al validar (motor de la aplicación, con conversiones y portes repartidos)
  base_quantity         numeric(18,6),
  price_per_base_unit   numeric(18,8),
  line_net              numeric(14,4),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
create index if not exists purchase_lines_invoice on public.purchase_lines (invoice_id);

-- Las facturas validadas o registradas no se editan
create or replace function public.check_invoice_editable()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_status public.invoice_status;
begin
  if tg_table_name = 'purchase_lines' then
    select status into v_status from public.purchase_invoices where id = coalesce(new.invoice_id, old.invoice_id);
    -- se permite completar los campos calculados al validar desde la operación de validación
    if v_status is not null and v_status not in ('draft', 'review') and current_setting('uj.validating', true) is distinct from 'on' then
      raise exception 'La factura ya está validada o registrada: no se pueden cambiar sus líneas';
    end if;
    return coalesce(new, old);
  end if;
  -- cabecera: solo editable en borrador o revisión; los cambios de estado pasan por sus operaciones
  if current_setting('uj.validating', true) = 'on' or current_setting('uj.posting', true) = 'on' then
    return new;
  end if;
  if old.status not in ('draft', 'review') then
    raise exception 'La factura ya está validada o registrada y no se puede modificar';
  end if;
  if new.status in ('validated', 'posted') then
    raise exception 'Usa las operaciones «Validar» y «Registrar»';
  end if;
  return new;
end;
$$;

-- Ingrediente y producto del mismo restaurante
create or replace function public.check_purchase_refs()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ok boolean;
begin
  if tg_table_name = 'supplier_products' then
    select restaurant_id = new.restaurant_id into v_ok from public.suppliers where id = new.supplier_id;
    if not coalesce(v_ok, false) then raise exception 'El proveedor no es de este restaurante'; end if;
  end if;
  if tg_table_name = 'purchase_invoices' then
    select restaurant_id = new.restaurant_id into v_ok from public.suppliers where id = new.supplier_id;
    if not coalesce(v_ok, false) then raise exception 'El proveedor no es de este restaurante'; end if;
    return new;
  end if;
  if tg_table_name = 'purchase_lines' then
    if new.supplier_product_id is not null then
      select restaurant_id = new.restaurant_id into v_ok from public.supplier_products where id = new.supplier_product_id;
      if not coalesce(v_ok, false) then raise exception 'El producto no es de este restaurante'; end if;
    end if;
  end if;
  if new.ingredient_id is not null then
    select (i.organization_id = new.organization_id and (i.restaurant_id is null or i.restaurant_id = new.restaurant_id))
      into v_ok from public.ingredients i where i.id = new.ingredient_id;
    if not coalesce(v_ok, false) then raise exception 'El ingrediente no pertenece a este restaurante'; end if;
  end if;
  return new;
end;
$$;

select public.uj_standard_table('suppliers', array['purchasing']);
select public.uj_standard_table('supplier_products', array['purchasing']);
select public.uj_standard_table('purchase_invoices', array['purchasing']);
select public.uj_standard_table('purchase_lines', array['purchasing'], false);

drop trigger if exists purchase_invoices_editable on public.purchase_invoices;
create trigger purchase_invoices_editable before update on public.purchase_invoices
  for each row execute function public.check_invoice_editable();
drop trigger if exists purchase_lines_editable on public.purchase_lines;
create trigger purchase_lines_editable before insert or update or delete on public.purchase_lines
  for each row execute function public.check_invoice_editable();
drop trigger if exists supplier_products_refs on public.supplier_products;
create trigger supplier_products_refs before insert or update on public.supplier_products
  for each row execute function public.check_purchase_refs();
drop trigger if exists purchase_invoices_refs on public.purchase_invoices;
create trigger purchase_invoices_refs before insert or update on public.purchase_invoices
  for each row execute function public.check_purchase_refs();
drop trigger if exists purchase_lines_refs on public.purchase_lines;
create trigger purchase_lines_refs before insert or update on public.purchase_lines
  for each row execute function public.check_purchase_refs();

-- Las facturas registradas no se borran
drop policy if exists purchase_invoices_delete on public.purchase_invoices;
create policy purchase_invoices_delete on public.purchase_invoices
  for delete to authenticated
  using (status in ('draft', 'review') and public.has_restaurant_role(restaurant_id, array['purchasing']::public.app_role[]));

-- ---------------------------------------------------------------------------
-- Validar: guarda los importes calculados por línea (los calcula la aplicación)
--   p_lines: [{ "id": uuid, "base_quantity": "…", "price_per_base_unit": "…", "line_net": "…" }]
-- ---------------------------------------------------------------------------
create or replace function public.validate_purchase_invoice(p_invoice uuid, p_version integer, p_lines jsonb)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_status public.invoice_status;
  v_version integer;
  v_count integer;
  l jsonb;
begin
  select status, version into v_status, v_version from public.purchase_invoices where id = p_invoice for update;
  if v_status is null then raise exception 'Factura no encontrada'; end if;
  if v_version <> p_version then raise exception 'La factura ha cambiado mientras la revisabas. Recarga la página.'; end if;
  if v_status not in ('draft', 'review') then raise exception 'La factura ya está validada o registrada'; end if;
  select count(*) into v_count from public.purchase_lines where invoice_id = p_invoice;
  if v_count = 0 then raise exception 'La factura no tiene líneas'; end if;
  if exists (select 1 from public.purchase_lines where invoice_id = p_invoice and ingredient_id is null) then
    raise exception 'Todas las líneas deben estar asociadas a una materia prima';
  end if;
  if jsonb_array_length(p_lines) <> v_count then raise exception 'Faltan líneas por calcular'; end if;

  perform set_config('uj.validating', 'on', true);
  for l in select * from jsonb_array_elements(p_lines) loop
    update public.purchase_lines
       set base_quantity = (l->>'base_quantity')::numeric,
           price_per_base_unit = (l->>'price_per_base_unit')::numeric,
           line_net = (l->>'line_net')::numeric
     where id = (l->>'id')::uuid and invoice_id = p_invoice;
  end loop;
  update public.purchase_invoices set status = 'validated', validated_at = now(), validated_by = auth.uid() where id = p_invoice;
  perform set_config('uj.validating', 'off', true);
end;
$$;

-- Volver a borrador (solo si aún no está registrada)
create or replace function public.reopen_purchase_invoice(p_invoice uuid)
returns void
language plpgsql security invoker set search_path = public
as $$
begin
  perform set_config('uj.validating', 'on', true);
  update public.purchase_invoices set status = 'review', validated_at = null, validated_by = null
   where id = p_invoice and status = 'validated';
  if not found then raise exception 'Solo se puede reabrir una factura validada y no registrada'; end if;
  perform set_config('uj.validating', 'off', true);
end;
$$;

grant execute on function public.validate_purchase_invoice(uuid, integer, jsonb) to authenticated;
grant execute on function public.reopen_purchase_invoice(uuid) to authenticated;

-- =======================================================================
-- 20261104000007_carta_ventas_inventario.sql
-- =======================================================================
-- Universo Jindama · Fase 4 · Carta, canales, ventas, inventario y registro de compras

do $$ begin
  create type public.channel_kind as enum ('dine_in', 'takeaway', 'own_delivery', 'platform');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.stock_kind as enum ('purchase', 'transfer_in', 'transfer_out', 'production_in', 'production_out', 'waste', 'adjustment');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Canales de venta y carta
-- ---------------------------------------------------------------------------
create table if not exists public.sales_channels (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null,
  restaurant_id          uuid not null,
  name                   text not null check (length(trim(name)) > 0),
  kind                   public.channel_kind not null default 'dine_in',
  commission_pct         numeric(7,6) not null default 0 check (commission_pct >= 0 and commission_pct < 1),
  commission_base        text not null default 'net' check (commission_base in ('net', 'gross')),
  fixed_fee_per_order    numeric(10,4) not null default 0 check (fixed_fee_per_order >= 0),
  portions_per_order     numeric(8,2) not null default 1 check (portions_per_order > 0),
  packaging_per_portion  numeric(10,4) not null default 0 check (packaging_per_portion >= 0),
  valid_from             date not null default current_date,
  notes                  text,
  status                 public.record_status not null default 'active',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                integer not null default 1,
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);

create table if not exists public.menu_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  name              text not null check (length(trim(name)) > 0),
  category          text,
  recipe_id         uuid references public.recipes(id),
  status            public.record_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
create unique index if not exists menu_items_unique_name on public.menu_items (restaurant_id, lower(trim(name))) where status = 'active';

-- Precio por plato y canal, con vigencia (histórico: un cambio es una fila nueva)
create table if not exists public.channel_prices (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  menu_item_id      uuid not null references public.menu_items(id) on delete cascade,
  channel_id        uuid not null references public.sales_channels(id),
  pvp               numeric(10,2) not null check (pvp >= 0),
  pvp_includes_tax  boolean not null default true,
  tax_rate          numeric(7,6) not null check (tax_rate >= 0 and tax_rate < 1),
  valid_from        date not null default current_date,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
create index if not exists channel_prices_lookup on public.channel_prices (menu_item_id, channel_id, valid_from desc);

-- ---------------------------------------------------------------------------
-- Ventas por plato (manual o CSV del TPV). import_key evita duplicados.
-- ---------------------------------------------------------------------------
create table if not exists public.sales (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  sale_date         date not null,
  menu_item_id      uuid not null references public.menu_items(id),
  channel_id        uuid references public.sales_channels(id),
  quantity          numeric(12,2) not null check (quantity > 0),
  gross_amount      numeric(14,2) check (gross_amount >= 0),     -- importe cobrado con impuestos
  source            text not null default 'manual' check (source in ('manual', 'csv')),
  import_key        text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
-- índice completo (los NULL no chocan) para que «upsert … on conflict» lo pueda usar
drop index if exists public.sales_import_key;
create unique index if not exists sales_import_key_u on public.sales (restaurant_id, import_key);
create index if not exists sales_date on public.sales (restaurant_id, sale_date);

-- ---------------------------------------------------------------------------
-- Inventario: movimientos en unidad base del ingrediente (+ entra, − sale)
-- ---------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  ingredient_id     uuid not null references public.ingredients(id),
  kind              public.stock_kind not null,
  quantity          numeric(18,6) not null check (quantity <> 0),
  occurred_at       timestamptz not null default now(),
  unit_cost         numeric(18,8),
  invoice_id        uuid references public.purchase_invoices(id),
  reference         text,
  notes             text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id),
  check (
    (kind in ('purchase', 'transfer_in', 'production_in') and quantity > 0) or
    (kind in ('transfer_out', 'production_out', 'waste') and quantity < 0) or
    (kind = 'adjustment')
  )
);
create index if not exists stock_movements_lookup on public.stock_movements (restaurant_id, ingredient_id, occurred_at);

create table if not exists public.stock_counts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  counted_at        timestamptz not null default now(),
  notes             text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);

create table if not exists public.stock_count_lines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  count_id          uuid not null references public.stock_counts(id) on delete cascade,
  ingredient_id     uuid not null references public.ingredients(id),
  quantity          numeric(18,6) not null check (quantity >= 0),   -- unidad base
  unique (count_id, ingredient_id),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);

select public.uj_standard_table('sales_channels', array['accounting']);
select public.uj_standard_table('menu_items', array['kitchen', 'accounting']);
select public.uj_standard_table('channel_prices', array['accounting'], false);
select public.uj_standard_table('sales', array['accounting'], false);
select public.uj_standard_table('stock_movements', array['kitchen', 'purchasing'], false);
select public.uj_standard_table('stock_counts', array['kitchen', 'purchasing'], false);
select public.uj_standard_table('stock_count_lines', array['kitchen', 'purchasing'], false);

-- Las ventas importadas por CSV y las líneas de recuento no generan un evento por fila
drop trigger if exists sales_audit on public.sales;
drop trigger if exists sales_audit_ins on public.sales;
drop trigger if exists sales_audit_del on public.sales;
create trigger sales_audit_ins after insert or update on public.sales
  for each row when (new.source = 'manual') execute function public.audit_row();
create trigger sales_audit_del after delete on public.sales
  for each row when (old.source = 'manual') execute function public.audit_row();
drop trigger if exists stock_count_lines_audit on public.stock_count_lines;

-- Movimientos y precios históricos: no se modifican (se corrigen con un ajuste)
drop policy if exists stock_movements_update on public.stock_movements;
drop policy if exists stock_movements_delete on public.stock_movements;
drop policy if exists channel_prices_update on public.channel_prices;
drop policy if exists channel_prices_delete on public.channel_prices;

-- Referencias del mismo restaurante
create or replace function public.check_same_restaurant_refs()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ok boolean;
begin
  if tg_table_name = 'menu_items' then
    if new.recipe_id is not null then
      select restaurant_id = new.restaurant_id and kind = 'dish' into v_ok from public.recipes where id = new.recipe_id;
      if not coalesce(v_ok, false) then raise exception 'El plato debe enlazar con una receta de plato del mismo restaurante'; end if;
    end if;
  elsif tg_table_name = 'channel_prices' then
    select restaurant_id = new.restaurant_id into v_ok from public.menu_items where id = new.menu_item_id;
    if not coalesce(v_ok, false) then raise exception 'Plato de otro restaurante'; end if;
    select restaurant_id = new.restaurant_id into v_ok from public.sales_channels where id = new.channel_id;
    if not coalesce(v_ok, false) then raise exception 'Canal de otro restaurante'; end if;
  elsif tg_table_name = 'sales' then
    select restaurant_id = new.restaurant_id into v_ok from public.menu_items where id = new.menu_item_id;
    if not coalesce(v_ok, false) then raise exception 'Plato de otro restaurante'; end if;
    if new.channel_id is not null then
      select restaurant_id = new.restaurant_id into v_ok from public.sales_channels where id = new.channel_id;
      if not coalesce(v_ok, false) then raise exception 'Canal de otro restaurante'; end if;
    end if;
  elsif tg_table_name in ('stock_movements', 'stock_count_lines') then
    select (organization_id = new.organization_id and (restaurant_id is null or restaurant_id = new.restaurant_id))
      into v_ok from public.ingredients where id = new.ingredient_id;
    if not coalesce(v_ok, false) then raise exception 'Ingrediente de otro restaurante'; end if;
    if tg_table_name = 'stock_count_lines' then
      select restaurant_id = new.restaurant_id into v_ok from public.stock_counts where id = new.count_id;
      if not coalesce(v_ok, false) then raise exception 'Recuento de otro restaurante'; end if;
    end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['menu_items', 'channel_prices', 'sales', 'stock_movements', 'stock_count_lines']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_refs', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.check_same_restaurant_refs()', t || '_refs', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Registrar factura: transaccional e idempotente. Aplica precios e inventario.
-- Si algo falla no se aplica nada (no hay aplicación parcial).
-- ---------------------------------------------------------------------------
create or replace function public.post_purchase_invoice(p_invoice uuid)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  inv record;
  l record;
  v_lines integer := 0;
  v_ingredients uuid[] := '{}';
begin
  select * into inv from public.purchase_invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'Factura no encontrada'; end if;
  if inv.status = 'posted' then raise exception 'Esta factura ya está registrada' using errcode = 'P0002'; end if;
  if inv.status <> 'validated' then raise exception 'Valida la factura antes de registrarla'; end if;

  for l in select * from public.purchase_lines where invoice_id = p_invoice order by position loop
    if l.price_per_base_unit is null or l.base_quantity is null or l.ingredient_id is null then
      raise exception 'La línea «%» no está calculada. Vuelve a validar.', l.description;
    end if;
    insert into public.ingredient_prices (restaurant_id, ingredient_id, price_per_base_unit, source, quality, valid_from, notes)
    values (inv.restaurant_id, l.ingredient_id, l.price_per_base_unit, 'invoice', 'measured',
            inv.invoice_date::timestamptz,
            format('Factura %s · %s', inv.number, l.description));
    insert into public.stock_movements (restaurant_id, ingredient_id, kind, quantity, occurred_at, unit_cost, invoice_id, reference)
    values (inv.restaurant_id, l.ingredient_id, 'purchase', l.base_quantity, inv.invoice_date::timestamptz, l.price_per_base_unit, p_invoice,
            format('Factura %s', inv.number));
    if l.supplier_product_id is not null then
      update public.supplier_products set last_price = l.pack_price, last_price_date = inv.invoice_date where id = l.supplier_product_id;
    end if;
    v_lines := v_lines + 1;
    v_ingredients := array_append(v_ingredients, l.ingredient_id);
  end loop;

  perform set_config('uj.posting', 'on', true);
  update public.purchase_invoices set status = 'posted', posted_at = now(), posted_by = auth.uid() where id = p_invoice;
  perform set_config('uj.posting', 'off', true);
  return jsonb_build_object('lines', v_lines, 'ingredients', to_jsonb(v_ingredients));
end;
$$;
grant execute on function public.post_purchase_invoice(uuid) to authenticated;

-- Existencias teóricas por ingrediente a una fecha (último recuento + movimientos posteriores)
create or replace function public.stock_on_hand(p_restaurant uuid, p_at timestamptz default now())
returns table (ingredient_id uuid, quantity numeric, last_count_at timestamptz)
language sql stable security invoker set search_path = public
as $$
  with ult as (
    select distinct on (l.ingredient_id) l.ingredient_id, l.quantity, c.counted_at
    from public.stock_count_lines l join public.stock_counts c on c.id = l.count_id
    where c.restaurant_id = p_restaurant and c.counted_at <= p_at
    order by l.ingredient_id, c.counted_at desc
  ),
  ings as (
    select ingredient_id from ult
    union select ingredient_id from public.stock_movements where restaurant_id = p_restaurant and occurred_at <= p_at
  )
  select i.ingredient_id,
         coalesce(u.quantity, 0) + coalesce((
           select sum(m.quantity) from public.stock_movements m
           where m.restaurant_id = p_restaurant and m.ingredient_id = i.ingredient_id
             and m.occurred_at <= p_at and (u.counted_at is null or m.occurred_at > u.counted_at)
         ), 0),
         u.counted_at
  from ings i left join ult u on u.ingredient_id = i.ingredient_id;
$$;
grant execute on function public.stock_on_hand(uuid, timestamptz) to authenticated;

-- =======================================================================
-- 20261104000008_economia.sql
-- =======================================================================
-- Universo Jindama · Fase 5 · Control económico, periodos e importación de archivos

do $$ begin
  create type public.entry_kind as enum ('revenue', 'purchase', 'labor', 'expense');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.entry_nature as enum ('operating', 'financing', 'investment');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Periodos mensuales abiertos/cerrados
-- ---------------------------------------------------------------------------
create table if not exists public.financial_periods (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  year              smallint not null check (year between 2000 and 2100),
  month             smallint not null check (month between 1 and 12),
  status            text not null default 'open' check (status in ('open', 'closed')),
  closed_at         timestamptz,
  closed_by         uuid,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  unique (restaurant_id, year, month),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);

-- ---------------------------------------------------------------------------
-- Importaciones: archivo, hoja, celda, dato original, transformación y errores
-- ---------------------------------------------------------------------------
create table if not exists public.import_jobs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id),
  kind              text not null default 'analitica_excel',
  file_name         text not null,
  file_hash         text not null,
  year              smallint,
  status            text not null default 'preview' check (status in ('preview', 'applied', 'reverted', 'failed')),
  mapping           jsonb not null default '{}'::jsonb,   -- bloque → restaurante
  summary           jsonb not null default '{}'::jsonb,
  rows_total        integer not null default 0,
  rows_error        integer not null default 0,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  applied_at        timestamptz,
  applied_by        uuid
);

create table if not exists public.import_rows (
  id                bigint generated always as identity primary key,
  job_id            uuid not null references public.import_jobs(id) on delete cascade,
  block             smallint not null,           -- posición del bloque en la hoja (1, 2, 3…)
  sheet             text not null,
  cell              text not null,               -- p. ej. «H14»
  original          text,
  entry_date        date,
  kind              public.entry_kind,
  nature            public.entry_nature,
  category          text,
  counterparty      text,
  channel           text,
  amount            numeric(14,2),
  status            text not null default 'ok' check (status in ('ok', 'error', 'skipped')),
  error             text
);
create index if not exists import_rows_job on public.import_rows (job_id, block);

-- ---------------------------------------------------------------------------
-- Movimientos económicos: ingresos, compras, personal y gastos
-- ---------------------------------------------------------------------------
create table if not exists public.financial_entries (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  entry_date        date not null,
  kind              public.entry_kind not null,
  nature            public.entry_nature not null default 'operating',
  category          text not null,
  counterparty      text,
  channel           text,
  amount            numeric(14,2) not null,
  quality           text not null default 'real' check (quality in ('real', 'estimated')),
  source            text not null default 'manual' check (source in ('manual', 'excel')),
  import_job_id     uuid references public.import_jobs(id),
  import_row_id     bigint references public.import_rows(id) on delete set null,
  notes             text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
create index if not exists financial_entries_period on public.financial_entries (restaurant_id, entry_date);
create index if not exists financial_entries_job on public.financial_entries (import_job_id);

select public.uj_standard_table('financial_periods', array['accounting']);
select public.uj_standard_table('financial_entries', array['accounting'], false);

-- Auditoría: los movimientos manuales uno a uno; los importados, como una sola importación
drop trigger if exists financial_entries_audit on public.financial_entries;
drop trigger if exists financial_entries_audit_ins on public.financial_entries;
drop trigger if exists financial_entries_audit_del on public.financial_entries;
create trigger financial_entries_audit_ins after insert or update on public.financial_entries
  for each row when (new.source = 'manual') execute function public.audit_row();
create trigger financial_entries_audit_del after delete on public.financial_entries
  for each row when (old.source = 'manual') execute function public.audit_row();
drop trigger if exists import_jobs_audit on public.import_jobs;
create trigger import_jobs_audit after update on public.import_jobs
  for each row when (new.status is distinct from old.status) execute function public.audit_row();

alter table public.import_jobs enable row level security;
alter table public.import_rows enable row level security;
drop policy if exists import_jobs_select on public.import_jobs;
drop policy if exists import_jobs_write on public.import_jobs;
create policy import_jobs_select on public.import_jobs for select to authenticated
  using (public.has_org_role(organization_id, array['admin', 'accounting']::public.app_role[]));
create policy import_jobs_write on public.import_jobs for all to authenticated
  using (public.has_org_role(organization_id, array['admin', 'accounting']::public.app_role[]))
  with check (public.has_org_role(organization_id, array['admin', 'accounting']::public.app_role[]));
drop policy if exists import_rows_select on public.import_rows;
drop policy if exists import_rows_write on public.import_rows;
create policy import_rows_select on public.import_rows for select to authenticated
  using (exists (select 1 from public.import_jobs j where j.id = job_id and public.has_org_role(j.organization_id, array['admin', 'accounting']::public.app_role[])));
create policy import_rows_write on public.import_rows for insert to authenticated
  with check (exists (select 1 from public.import_jobs j where j.id = job_id and j.status = 'preview' and public.has_org_role(j.organization_id, array['admin', 'accounting']::public.app_role[])));

-- Los periodos cerrados no admiten cambios
create or replace function public.check_period_open()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r record := coalesce(new, old);
  v_closed boolean;
begin
  select true into v_closed from public.financial_periods
   where restaurant_id = r.restaurant_id and year = extract(year from r.entry_date) and month = extract(month from r.entry_date) and status = 'closed';
  if coalesce(v_closed, false) then
    raise exception 'El periodo %/% está cerrado. Reábrelo para hacer cambios.', extract(month from r.entry_date), extract(year from r.entry_date);
  end if;
  if tg_op = 'UPDATE' then
    select true into v_closed from public.financial_periods
     where restaurant_id = old.restaurant_id and year = extract(year from old.entry_date) and month = extract(month from old.entry_date) and status = 'closed';
    if coalesce(v_closed, false) then raise exception 'El periodo original está cerrado.'; end if;
  end if;
  return r;
end;
$$;
drop trigger if exists financial_entries_period on public.financial_entries;
create trigger financial_entries_period before insert or update or delete on public.financial_entries
  for each row execute function public.check_period_open();

-- Cerrar / reabrir periodo
create or replace function public.set_period_status(p_restaurant uuid, p_year int, p_month int, p_status text)
returns void
language plpgsql security invoker set search_path = public
as $$
begin
  if p_status not in ('open', 'closed') then raise exception 'Estado no válido'; end if;
  insert into public.financial_periods (restaurant_id, year, month, status, closed_at, closed_by)
  values (p_restaurant, p_year, p_month, p_status, case when p_status = 'closed' then now() end, case when p_status = 'closed' then auth.uid() end)
  on conflict (restaurant_id, year, month) do update
    set status = excluded.status, closed_at = excluded.closed_at, closed_by = excluded.closed_by;
end;
$$;
grant execute on function public.set_period_status(uuid, int, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Aplicar una importación: sustituye lo importado antes desde Excel en esos
-- restaurantes y meses (así reimportar un Excel actualizado no duplica).
--   p_mapping: { "1": "<restaurant uuid>", "2": "…", "3": null }  (null = no importar)
-- ---------------------------------------------------------------------------
create or replace function public.apply_import(p_job uuid, p_mapping jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  j record;
  b record;
  v_rest uuid;
  v_inserted integer := 0;
  v_deleted integer := 0;
  v_n integer;
begin
  select * into j from public.import_jobs where id = p_job for update;
  if j.id is null then raise exception 'Importación no encontrada'; end if;
  if j.status <> 'preview' then raise exception 'Esta importación ya se aplicó o se descartó'; end if;

  for b in select distinct block from public.import_rows where job_id = p_job and status = 'ok' loop
    v_rest := nullif(p_mapping->>(b.block::text), '')::uuid;
    continue when v_rest is null;
    if not exists (select 1 from public.restaurants where id = v_rest and organization_id = j.organization_id) then
      raise exception 'Restaurante no válido para el bloque %', b.block;
    end if;
    -- borrar lo importado antes desde Excel en los meses que trae este bloque
    delete from public.financial_entries fe
     where fe.restaurant_id = v_rest and fe.source = 'excel'
       and date_trunc('month', fe.entry_date) in (
         select distinct date_trunc('month', entry_date) from public.import_rows where job_id = p_job and block = b.block and status = 'ok'
       );
    get diagnostics v_n = row_count; v_deleted := v_deleted + v_n;

    insert into public.financial_entries (restaurant_id, entry_date, kind, nature, category, counterparty, channel, amount, source, import_job_id, import_row_id, notes)
    select v_rest, r.entry_date, r.kind, coalesce(r.nature, 'operating'), r.category, r.counterparty, r.channel, r.amount, 'excel', p_job, r.id,
           format('%s!%s', r.sheet, r.cell)
    from public.import_rows r
    where r.job_id = p_job and r.block = b.block and r.status = 'ok' and r.amount is not null and r.amount <> 0;
    get diagnostics v_n = row_count; v_inserted := v_inserted + v_n;
  end loop;

  update public.import_jobs set status = 'applied', mapping = p_mapping, applied_at = now(), applied_by = auth.uid() where id = p_job;
  return jsonb_build_object('inserted', v_inserted, 'replaced', v_deleted);
end;
$$;

create or replace function public.revert_import(p_job uuid)
returns integer
language plpgsql security invoker set search_path = public
as $$
declare v_n integer;
begin
  delete from public.financial_entries where import_job_id = p_job;
  get diagnostics v_n = row_count;
  update public.import_jobs set status = 'reverted' where id = p_job and status = 'applied';
  if not found then raise exception 'Solo se puede deshacer una importación aplicada'; end if;
  return v_n;
end;
$$;

grant execute on function public.apply_import(uuid, jsonb) to authenticated;
grant execute on function public.revert_import(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Resúmenes agregados (para cuentas de resultados y gráficas)
-- ---------------------------------------------------------------------------
create or replace function public.monthly_summary(p_restaurants uuid[], p_from date, p_to date)
returns table (restaurant_id uuid, month date, kind public.entry_kind, nature public.entry_nature, total numeric)
language sql stable security invoker set search_path = public
as $$
  select fe.restaurant_id, date_trunc('month', fe.entry_date)::date, fe.kind, fe.nature, sum(fe.amount)
  from public.financial_entries fe
  where fe.restaurant_id = any (p_restaurants) and fe.entry_date between p_from and p_to
  group by 1, 2, 3, 4
  order by 2;
$$;

create or replace function public.category_summary(p_restaurants uuid[], p_from date, p_to date)
returns table (kind public.entry_kind, nature public.entry_nature, category text, total numeric, entries bigint)
language sql stable security invoker set search_path = public
as $$
  select fe.kind, fe.nature, fe.category, sum(fe.amount), count(*)
  from public.financial_entries fe
  where fe.restaurant_id = any (p_restaurants) and fe.entry_date between p_from and p_to
  group by 1, 2, 3
  order by 1, 4 desc;
$$;

create or replace function public.sales_summary(p_restaurants uuid[], p_from date, p_to date)
returns table (restaurant_id uuid, month date, menu_item_id uuid, channel_id uuid, quantity numeric, gross numeric)
language sql stable security invoker set search_path = public
as $$
  select s.restaurant_id, date_trunc('month', s.sale_date)::date, s.menu_item_id, s.channel_id, sum(s.quantity), sum(s.gross_amount)
  from public.sales s
  where s.restaurant_id = any (p_restaurants) and s.sale_date between p_from and p_to
  group by 1, 2, 3, 4;
$$;

grant execute on function public.monthly_summary(uuid[], date, date) to authenticated;
grant execute on function public.category_summary(uuid[], date, date) to authenticated;
grant execute on function public.sales_summary(uuid[], date, date) to authenticated;

create or replace function public.counterparty_summary(p_restaurants uuid[], p_from date, p_to date, p_kind public.entry_kind)
returns table (counterparty text, total numeric)
language sql stable security invoker set search_path = public
as $$
  select coalesce(fe.counterparty, 'Sin proveedor'), sum(fe.amount)
  from public.financial_entries fe
  where fe.restaurant_id = any (p_restaurants) and fe.entry_date between p_from and p_to and fe.kind = p_kind
  group by 1
  order by 2 desc;
$$;
grant execute on function public.counterparty_summary(uuid[], date, date, public.entry_kind) to authenticated;
