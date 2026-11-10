-- Universo Jindama · Actualización permisos por áreas y fichas técnicas (migraciones 9 y 10 juntas)
-- Ejecutar DESPUÉS de actualizar-fases-2-a-5.sql. Pegar entero en Supabase → SQL Editor → Run. Se puede repetir sin peligro.

-- =======================================================================
-- 20261110000009_permisos.sql
-- =======================================================================
-- Universo Jindama · Permisos por apartado y registro de actividad solo para el propietario
-- Cada acceso puede llevar casillas por apartado: none (no), read (ver) o write (editar).
-- Sin casillas, se aplican las del perfil (Cocina, Compras, Administración, Consulta).
-- Propietario y Administrador pueden editar todo. Se puede repetir sin peligro.

alter table public.memberships add column if not exists permissions jsonb;

-- Apartados: recetas, materias, equipos, compras, inventario, carta, ventas, economia, personal, ajustes
create or replace function public.role_area_default(p_role public.app_role, p_area text)
returns text
language sql immutable
as $$
  select case
    when p_role in ('owner', 'admin') then 'write'
    when p_role = 'kitchen' then
      case when p_area in ('recetas', 'materias', 'equipos', 'inventario') then 'write'
           when p_area in ('carta', 'personal', 'ajustes') then 'read' else 'none' end
    when p_role = 'purchasing' then
      case when p_area in ('materias', 'compras', 'inventario') then 'write'
           when p_area in ('recetas', 'equipos', 'personal', 'ajustes') then 'read' else 'none' end
    when p_role = 'accounting' then
      case when p_area in ('economia', 'ventas', 'carta', 'personal', 'ajustes') then 'write'
           when p_area in ('compras', 'recetas', 'inventario', 'materias', 'equipos') then 'read' else 'none' end
    else 'read'  -- consulta
  end;
$$;

-- Nivel del usuario actual en un apartado de un restaurante: 0 = no, 1 = ver, 2 = editar
create or replace function public.area_level(p_restaurant uuid, p_area text)
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(max(
    case
      when m.role in ('owner', 'admin') then 2
      else case coalesce(m.permissions->>p_area, public.role_area_default(m.role, p_area))
             when 'write' then 2 when 'read' then 1 else 0 end
    end), 0)
  from public.restaurants r
  join public.memberships m on m.organization_id = r.organization_id
  where r.id = p_restaurant and m.user_id = auth.uid()
    and (m.restaurant_id is null or m.restaurant_id = r.id);
$$;

create or replace function public.can_read(p_restaurant uuid, p_area text)
returns boolean language sql stable security definer set search_path = public
as $$ select public.area_level(p_restaurant, p_area) >= 1; $$;

create or replace function public.can_write(p_restaurant uuid, p_area text)
returns boolean language sql stable security definer set search_path = public
as $$ select public.area_level(p_restaurant, p_area) >= 2; $$;

-- ¿Puede editar algún apartado? (avisos, fotografías de coste)
create or replace function public.can_write_any(p_restaurant uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from unnest(array['recetas','materias','equipos','compras','inventario','carta','ventas','economia','personal','ajustes']) a
    where public.area_level(p_restaurant, a) >= 2
  );
$$;

-- ---------------------------------------------------------------------------
-- Políticas por apartado
-- ---------------------------------------------------------------------------
create or replace function public.uj_area_policies(p_table text, p_area text, p_restrict_read boolean, p_allow_update boolean default true, p_allow_delete boolean default true)
returns void
language plpgsql
as $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = p_table loop
    execute format('drop policy %I on public.%I', pol.policyname, p_table);
  end loop;
  execute format('alter table public.%I enable row level security', p_table);
  if p_restrict_read then
    execute format('create policy %I on public.%I for select to authenticated using (public.can_read(restaurant_id, %L))', p_table || '_select', p_table, p_area);
  else
    execute format('create policy %I on public.%I for select to authenticated using (public.has_restaurant_access(restaurant_id))', p_table || '_select', p_table);
  end if;
  execute format('create policy %I on public.%I for insert to authenticated with check (public.can_write(restaurant_id, %L))', p_table || '_insert', p_table, p_area);
  if p_allow_update then
    execute format('create policy %I on public.%I for update to authenticated using (public.can_write(restaurant_id, %L)) with check (public.can_write(restaurant_id, %L))', p_table || '_update', p_table, p_area, p_area);
  end if;
  if p_allow_delete then
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_write(restaurant_id, %L))', p_table || '_delete', p_table, p_area);
  end if;
end;
$$;
revoke execute on function public.uj_area_policies(text, text, boolean, boolean, boolean) from public, anon, authenticated;

-- Catálogos que necesita cualquier escandallo: se pueden ver siempre; editar según apartado
select public.uj_area_policies('equipment', 'equipos', false);
select public.uj_area_policies('consumables', 'equipos', false);
select public.uj_area_policies('labor_profiles', 'personal', false);
select public.uj_area_policies('energy_tariffs', 'ajustes', false);
select public.uj_area_policies('tax_rates', 'ajustes', false);

-- Apartados con lectura restringida
select public.uj_area_policies('recipes', 'recetas', true);
select public.uj_area_policies('recipe_versions', 'recetas', true);
select public.uj_area_policies('recipe_ingredients', 'recetas', true);
select public.uj_area_policies('recipe_equipment_usage', 'recetas', true);
select public.uj_area_policies('recipe_labor_usage', 'recetas', true);
select public.uj_area_policies('recipe_consumables', 'recetas', true);
select public.uj_area_policies('suppliers', 'compras', true);
select public.uj_area_policies('supplier_products', 'compras', true);
select public.uj_area_policies('purchase_invoices', 'compras', true, true, false);
select public.uj_area_policies('purchase_lines', 'compras', true);
select public.uj_area_policies('stock_movements', 'inventario', true, false, false);
select public.uj_area_policies('stock_counts', 'inventario', true);
select public.uj_area_policies('stock_count_lines', 'inventario', true);
select public.uj_area_policies('sales_channels', 'carta', true);
select public.uj_area_policies('menu_items', 'carta', true);
select public.uj_area_policies('channel_prices', 'carta', true, false, false);
select public.uj_area_policies('sales', 'ventas', true);
select public.uj_area_policies('financial_entries', 'economia', true);
select public.uj_area_policies('financial_periods', 'economia', true);

-- Facturas: solo se borran sin validar
create policy purchase_invoices_delete on public.purchase_invoices for delete to authenticated
  using (status in ('draft', 'review') and public.can_write(restaurant_id, 'compras'));

-- Ingredientes: locales por apartado; compartidos del grupo, solo propietario o administrador de todo el grupo
do $$ declare pol record; begin
  for pol in select policyname, tablename from pg_policies where schemaname = 'public' and tablename in ('ingredients', 'ingredient_prices') loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;
create policy ingredients_select on public.ingredients for select to authenticated
  using ((restaurant_id is null and public.is_org_member(organization_id)) or (restaurant_id is not null and public.has_restaurant_access(restaurant_id)));
create policy ingredients_insert on public.ingredients for insert to authenticated
  with check ((restaurant_id is null and public.has_org_role(organization_id, array['admin']::public.app_role[]))
           or (restaurant_id is not null and public.can_write(restaurant_id, 'materias')));
create policy ingredients_update on public.ingredients for update to authenticated
  using ((restaurant_id is null and public.has_org_role(organization_id, array['admin']::public.app_role[]))
      or (restaurant_id is not null and public.can_write(restaurant_id, 'materias')));
-- Precios: solo inserción (histórico). Los registra materias primas o compras.
create policy ingredient_prices_select on public.ingredient_prices for select to authenticated using (public.has_restaurant_access(restaurant_id));
create policy ingredient_prices_insert on public.ingredient_prices for insert to authenticated
  with check (public.can_write(restaurant_id, 'materias') or public.can_write(restaurant_id, 'compras'));

-- Fotografías de coste: las ve quien ve recetas o carta; las crea quien cambia recetas, precios o compras
do $$ declare pol record; begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'cost_snapshots' loop
    execute format('drop policy %I on public.cost_snapshots', pol.policyname);
  end loop;
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'alerts' loop
    execute format('drop policy %I on public.alerts', pol.policyname);
  end loop;
end $$;
create policy cost_snapshots_select on public.cost_snapshots for select to authenticated
  using (public.can_read(restaurant_id, 'recetas') or public.can_read(restaurant_id, 'carta'));
create policy cost_snapshots_insert on public.cost_snapshots for insert to authenticated
  with check (public.can_write(restaurant_id, 'recetas') or public.can_write(restaurant_id, 'materias') or public.can_write(restaurant_id, 'compras'));
create policy alerts_select on public.alerts for select to authenticated using (public.has_restaurant_access(restaurant_id));
create policy alerts_insert on public.alerts for insert to authenticated with check (public.can_write_any(restaurant_id));
create policy alerts_update on public.alerts for update to authenticated using (public.can_write_any(restaurant_id)) with check (public.can_write_any(restaurant_id));

-- Ajustes del restaurante
drop policy if exists settings_update on public.restaurant_settings;
create policy settings_update on public.restaurant_settings for update to authenticated
  using (public.can_write(restaurant_id, 'ajustes'));

-- Importaciones: propietario, administrador o quien edite Economía en todo el grupo
drop policy if exists import_jobs_select on public.import_jobs;
drop policy if exists import_jobs_write on public.import_jobs;
drop policy if exists import_rows_select on public.import_rows;
drop policy if exists import_rows_write on public.import_rows;
create or replace function public.can_import(p_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.restaurant_id is null
      and (m.role in ('owner', 'admin') or coalesce(m.permissions->>'economia', public.role_area_default(m.role, 'economia')) = 'write')
  );
$$;
create policy import_jobs_select on public.import_jobs for select to authenticated using (public.can_import(organization_id));
create policy import_jobs_write on public.import_jobs for all to authenticated using (public.can_import(organization_id)) with check (public.can_import(organization_id));
create policy import_rows_select on public.import_rows for select to authenticated
  using (exists (select 1 from public.import_jobs j where j.id = job_id and public.can_import(j.organization_id)));
create policy import_rows_write on public.import_rows for insert to authenticated
  with check (exists (select 1 from public.import_jobs j where j.id = job_id and j.status = 'preview' and public.can_import(j.organization_id)));

-- ---------------------------------------------------------------------------
-- Registro de actividad: solo el propietario
-- ---------------------------------------------------------------------------
drop policy if exists audit_select on public.audit_events;
create policy audit_select on public.audit_events for select to authenticated
  using (organization_id is not null and public.has_org_role(organization_id, array['owner']::public.app_role[]));

-- Las líneas de recuento también quedan registradas
drop trigger if exists stock_count_lines_audit on public.stock_count_lines;
create trigger stock_count_lines_audit after insert or update or delete on public.stock_count_lines
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Gestión de accesos con casillas
-- ---------------------------------------------------------------------------
drop function if exists public.set_member_access(uuid, uuid, public.app_role, uuid[]);
create or replace function public.set_member_access(p_org uuid, p_user uuid, p_role public.app_role, p_restaurants uuid[], p_permissions jsonb default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare k text;
begin
  if not public.has_org_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'Solo el propietario puede gestionar accesos' using errcode = '42501';
  end if;
  if p_role = 'owner' then raise exception 'El rol de propietario no se asigna desde el panel'; end if;
  if p_user = auth.uid() then raise exception 'No puedes cambiar tu propio acceso'; end if;
  if exists (select 1 from public.memberships where organization_id = p_org and user_id = p_user and role = 'owner') then
    raise exception 'No se puede modificar el acceso de otro propietario';
  end if;
  if p_restaurants is not null and cardinality(p_restaurants) = 0 then raise exception 'Elige al menos un restaurante'; end if;
  if p_restaurants is not null and exists (
    select 1 from unnest(p_restaurants) as r(id)
    where not exists (select 1 from public.restaurants x where x.id = r.id and x.organization_id = p_org)
  ) then raise exception 'Restaurante no válido'; end if;
  if p_permissions is not null then
    for k in select jsonb_object_keys(p_permissions) loop
      if k not in ('recetas','materias','equipos','compras','inventario','carta','ventas','economia','personal','ajustes') then
        raise exception 'Apartado desconocido: %', k;
      end if;
      if p_permissions->>k not in ('none', 'read', 'write') then raise exception 'Permiso no válido en %', k; end if;
    end loop;
  end if;

  delete from public.memberships where organization_id = p_org and user_id = p_user;
  if p_restaurants is null then
    insert into public.memberships (organization_id, restaurant_id, user_id, role, permissions)
    values (p_org, null, p_user, p_role, case when p_role = 'admin' then null else p_permissions end);
  else
    insert into public.memberships (organization_id, restaurant_id, user_id, role, permissions)
    select p_org, r.id, p_user, p_role, case when p_role = 'admin' then null else p_permissions end from unnest(p_restaurants) as r(id);
  end if;
end;
$$;
revoke execute on function public.set_member_access(uuid, uuid, public.app_role, uuid[], jsonb) from public, anon;
grant execute on function public.set_member_access(uuid, uuid, public.app_role, uuid[], jsonb) to authenticated;

-- =======================================================================
-- 20261110000010_recetas_ficha.sql
-- =======================================================================
-- Universo Jindama · Ficha técnica de recetas y elaboraciones
-- Proceso paso a paso (tiempo, temperatura, equipo, punto crítico), tiempos totales,
-- conservación, caducidad, presentación y alérgenos añadidos. Se puede repetir sin peligro.

alter table public.recipe_versions
  add column if not exists prep_minutes      numeric(8,2) check (prep_minutes >= 0),
  add column if not exists cook_minutes      numeric(8,2) check (cook_minutes >= 0),
  add column if not exists rest_minutes      numeric(8,2) check (rest_minutes >= 0),
  add column if not exists shelf_life_hours  numeric(8,2) check (shelf_life_hours >= 0),
  add column if not exists storage           text,      -- refrigeración 0–4 °C, congelado…
  add column if not exists serving           text,      -- presentación / emplatado
  add column if not exists portion_size      text,      -- «250 g», «1 ud»
  add column if not exists extra_allergens   text[] not null default '{}';  -- trazas o añadidos

create table if not exists public.recipe_steps (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  version_id        uuid not null references public.recipe_versions(id) on delete cascade,
  position          integer not null default 0,
  title             text,
  description       text not null,
  minutes           numeric(8,2) check (minutes >= 0),
  temperature_c     numeric(6,1),
  equipment_id      uuid references public.equipment(id),
  is_critical       boolean not null default false,   -- punto de control (APPCC)
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
create index if not exists recipe_steps_version on public.recipe_steps (version_id, position);

select public.uj_standard_table('recipe_steps', array['kitchen'], false);
select public.uj_area_policies('recipe_steps', 'recetas', true);
drop trigger if exists recipe_steps_draft on public.recipe_steps;
create trigger recipe_steps_draft before insert or update or delete on public.recipe_steps
  for each row execute function public.check_version_draft();
-- los pasos no generan un evento por fila en el registro (sí el guardado de la versión)
drop trigger if exists recipe_steps_audit on public.recipe_steps;

-- Una versión activa no cambia
create or replace function public.check_version_locked()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'draft' and (
       new.yield_quantity is distinct from old.yield_quantity or new.yield_unit is distinct from old.yield_unit
    or new.portions is distinct from old.portions or new.labor_is_variable is distinct from old.labor_is_variable
    or new.use_overheads is distinct from old.use_overheads or new.recipe_id is distinct from old.recipe_id
    or new.prep_minutes is distinct from old.prep_minutes or new.cook_minutes is distinct from old.cook_minutes
    or new.rest_minutes is distinct from old.rest_minutes or new.shelf_life_hours is distinct from old.shelf_life_hours
    or new.storage is distinct from old.storage or new.serving is distinct from old.serving
    or new.portion_size is distinct from old.portion_size or new.extra_allergens is distinct from old.extra_allergens
    or new.steps is distinct from old.steps) then
    raise exception 'Esta versión ya no es un borrador: crea una versión nueva para cambiarla';
  end if;
  return new;
end;
$$;

-- Nueva versión: copia todo, también la ficha y los pasos
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

  insert into public.recipe_versions (restaurant_id, recipe_id, number, yield_quantity, yield_unit, portions, labor_is_variable, use_overheads,
                                      steps, notes, prep_minutes, cook_minutes, rest_minutes, shelf_life_hours, storage, serving, portion_size, extra_allergens)
  select r.restaurant_id, r.id, v_num, v.yield_quantity, v.yield_unit, v.portions, coalesce(v.labor_is_variable, false), coalesce(v.use_overheads, true),
         v.steps, v.notes, v.prep_minutes, v.cook_minutes, v.rest_minutes, v.shelf_life_hours, v.storage, v.serving, v.portion_size, coalesce(v.extra_allergens, '{}')
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
    insert into public.recipe_steps (restaurant_id, version_id, position, title, description, minutes, temperature_c, equipment_id, is_critical)
      select restaurant_id, v_new, position, title, description, minutes, temperature_c, equipment_id, is_critical from public.recipe_steps where version_id = v_src;
  end if;
  return v_new;
end;
$$;

-- Guardar borrador completo (cabecera, ficha, líneas y pasos) de una vez
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
    notes = nullif(p_data->>'notes', ''),
    prep_minutes = nullif(p_data->>'prep_minutes', '')::numeric,
    cook_minutes = nullif(p_data->>'cook_minutes', '')::numeric,
    rest_minutes = nullif(p_data->>'rest_minutes', '')::numeric,
    shelf_life_hours = nullif(p_data->>'shelf_life_hours', '')::numeric,
    storage = nullif(p_data->>'storage', ''),
    serving = nullif(p_data->>'serving', ''),
    portion_size = nullif(p_data->>'portion_size', ''),
    extra_allergens = coalesce((select array_agg(x) from jsonb_array_elements_text(p_data->'extra_allergens') x), '{}')
  where id = p_version
  returning version into v_new;

  delete from public.recipe_ingredients where version_id = p_version;
  delete from public.recipe_equipment_usage where version_id = p_version;
  delete from public.recipe_labor_usage where version_id = p_version;
  delete from public.recipe_consumables where version_id = p_version;
  delete from public.recipe_steps where version_id = p_version;

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

  insert into public.recipe_steps (restaurant_id, version_id, position, title, description, minutes, temperature_c, equipment_id, is_critical)
  select v.restaurant_id, p_version, (x.ord - 1)::int, nullif(x.e->>'title', ''), x.e->>'description',
         nullif(x.e->>'minutes', '')::numeric, nullif(x.e->>'temperature_c', '')::numeric,
         nullif(x.e->>'equipment_id', '')::uuid, coalesce((x.e->>'is_critical')::boolean, false)
  from jsonb_array_elements(coalesce(p_data->'pasos', '[]'::jsonb)) with ordinality as x(e, ord)
  where coalesce(trim(x.e->>'description'), '') <> '';

  return v_new;
end;
$$;
