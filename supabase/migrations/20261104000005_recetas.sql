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
