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
