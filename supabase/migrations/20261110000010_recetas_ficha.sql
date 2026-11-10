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
