-- Universo Jindama · Fase 1 · Ingredientes y ajustes reutilizables
-- Los ajustes se crean una vez y se seleccionan después en los platos.
-- Los cambios conservan histórico y fecha de vigencia.

create type public.base_unit as enum ('g', 'ml', 'unit');
create type public.data_quality as enum ('measured', 'manufacturer', 'estimated');
create type public.energy_source as enum ('electricity', 'gas', 'water');
create type public.tax_kind as enum ('purchase', 'sale');
create type public.imputation_unit as enum ('portion', 'batch', 'minute', 'order', 'percent');

-- ---------------------------------------------------------------------------
-- Impuestos con vigencia
-- ---------------------------------------------------------------------------
create table public.tax_rates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  restaurant_id    uuid not null,
  name             text not null check (length(trim(name)) > 0),
  kind             public.tax_kind not null,
  rate             numeric(7,6) not null check (rate >= 0 and rate < 1),   -- 10 % = 0.10
  recoverable      boolean not null default true,
  valid_from       date not null default current_date,
  valid_to         date,
  status           public.record_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id),
  check (valid_to is null or valid_to >= valid_from)
);

-- ---------------------------------------------------------------------------
-- Tarifas de energía con vigencia (electricidad, gas, agua)
-- ---------------------------------------------------------------------------
create table public.energy_tariffs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  restaurant_id    uuid not null,
  name             text not null check (length(trim(name)) > 0),
  source           public.energy_source not null,
  unit             text not null check (unit in ('kWh', 'm3', 'l')),
  price_per_unit   numeric(18,8) not null check (price_per_unit >= 0),
  includes_taxes   boolean not null default false,
  valid_from       date not null default current_date,
  valid_to         date,
  notes            text,
  status           public.record_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id),
  check (valid_to is null or valid_to >= valid_from),
  check (source <> 'electricity' or unit = 'kWh'),
  check (source <> 'water' or unit in ('m3', 'l'))
);

-- ---------------------------------------------------------------------------
-- Ingredientes. restaurant_id NULL = catálogo compartido de la organización.
-- El precio NO vive aquí: cada restaurante conserva sus precios en
-- ingredient_prices, con histórico.
-- ---------------------------------------------------------------------------
create table public.ingredients (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id),
  restaurant_id     uuid,
  name              text not null check (length(trim(name)) > 0),
  category          text,
  base_unit         public.base_unit not null,
  -- rendimiento aprovechable tras limpieza/preparación: 80 % = 0.80.
  -- La merma de preparación es 1 - yield_ratio; no se guarda por separado
  -- para que no pueda aplicarse dos veces.
  yield_ratio       numeric(7,6) not null default 1 check (yield_ratio > 0 and yield_ratio <= 1),
  density_g_per_ml  numeric(12,6) check (density_g_per_ml > 0),
  unit_weight_g     numeric(12,4) check (unit_weight_g > 0),
  unit_volume_ml    numeric(12,4) check (unit_volume_ml > 0),
  storage           text,
  allergens         text[] not null default '{}',
  source            text,
  status            public.record_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
create index ingredients_restaurant on public.ingredients (organization_id, restaurant_id, name);

-- Histórico de precios por restaurante, en unidad base del ingrediente.
-- Nunca se edita: un precio nuevo es una fila nueva.
create table public.ingredient_prices (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  restaurant_id        uuid not null,
  ingredient_id        uuid not null references public.ingredients(id) on delete restrict,
  price_per_base_unit  numeric(18,8) not null check (price_per_base_unit >= 0),
  currency             char(3) not null default 'EUR',
  -- se registra el precio de compra sin impuestos recuperables
  includes_recoverable_tax boolean not null default false,
  source               text not null default 'manual' check (source in ('manual', 'invoice', 'import')),
  quality              public.data_quality not null default 'measured',
  valid_from           timestamptz not null default now(),
  notes                text,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);
create index ingredient_prices_lookup on public.ingredient_prices (restaurant_id, ingredient_id, valid_from desc);

-- Precio vigente (último validado) por ingrediente y restaurante
create view public.current_ingredient_prices
with (security_invoker = true) as
select distinct on (p.restaurant_id, p.ingredient_id)
  p.restaurant_id, p.ingredient_id, p.price_per_base_unit, p.currency, p.quality, p.valid_from, p.id as price_id
from public.ingredient_prices p
where p.valid_from <= now()
order by p.restaurant_id, p.ingredient_id, p.valid_from desc, p.created_at desc;

-- ---------------------------------------------------------------------------
-- Equipos
-- ---------------------------------------------------------------------------
create table public.equipment (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null,
  restaurant_id          uuid not null,
  name                   text not null check (length(trim(name)) > 0),
  energy_source          public.energy_source not null default 'electricity',
  nominal_power_w        numeric(12,2) check (nominal_power_w >= 0),
  power_quality          public.data_quality not null default 'manufacturer',
  -- consumo medido opcional en unidades de la tarifa por hora de uso
  measured_consumption_per_hour numeric(14,6) check (measured_consumption_per_hour >= 0),
  -- fracción del tiempo en que el equipo consume a potencia nominal
  duty_factor            numeric(7,6) not null default 1 check (duty_factor > 0 and duty_factor <= 1),
  duty_factor_quality    public.data_quality not null default 'estimated',
  preheat_minutes        numeric(8,2) not null default 0 check (preheat_minutes >= 0),
  batch_capacity         numeric(10,2) check (batch_capacity > 0),
  energy_tariff_id       uuid references public.energy_tariffs(id),
  notes                  text,
  status                 public.record_status not null default 'active',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                integer not null default 1,
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);

-- ---------------------------------------------------------------------------
-- Perfiles laborales (sin datos personales)
-- coste_hora = coste total del periodo para la empresa / horas productivas
-- ---------------------------------------------------------------------------
create table public.labor_profiles (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  name              text not null check (length(trim(name)) > 0),
  period_label      text not null default 'mensual',
  period_cost       numeric(14,2) not null check (period_cost >= 0),     -- coste empresa, no salario neto
  productive_hours  numeric(10,2) not null check (productive_hours > 0),
  cost_per_hour     numeric(18,8) generated always as (period_cost / productive_hours) stored,
  includes          text,          -- qué incluye el coste (SS empresa, pagas, etc.)
  status            public.record_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);

-- ---------------------------------------------------------------------------
-- Otros conceptos: envases, consumibles, limpieza, comisiones...
-- ---------------------------------------------------------------------------
create table public.consumables (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  restaurant_id     uuid not null,
  name              text not null check (length(trim(name)) > 0),
  imputation_unit   public.imputation_unit not null,
  amount            numeric(18,8) not null check (amount >= 0),  -- importe o % según unidad
  rule              text,          -- base y regla de aplicación documentada
  status            public.record_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (restaurant_id, organization_id) references public.restaurants(id, organization_id)
);

-- ---------------------------------------------------------------------------
-- Triggers comunes
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tax_rates', 'energy_tariffs', 'ingredients', 'equipment', 'labor_profiles', 'consumables']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_row()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

create trigger ingredient_prices_audit after insert or update or delete on public.ingredient_prices
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- RLS
-- Lectura: cualquier miembro con acceso al restaurante.
-- Escritura: owner/admin siempre + el rol funcional correspondiente.
-- Los catálogos no se borran: se archivan (status = 'archived').
-- ---------------------------------------------------------------------------
alter table public.tax_rates         enable row level security;
alter table public.energy_tariffs    enable row level security;
alter table public.ingredients       enable row level security;
alter table public.ingredient_prices enable row level security;
alter table public.equipment         enable row level security;
alter table public.labor_profiles    enable row level security;
alter table public.consumables       enable row level security;

-- tablas por restaurante: (tabla, roles de escritura)
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('tax_rates',      array['accounting']),
      ('energy_tariffs', array['accounting']),
      ('equipment',      array['kitchen']),
      ('labor_profiles', array['accounting']),
      ('consumables',    array['kitchen', 'purchasing'])
    ) as v(tbl, roles)
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_restaurant_access(restaurant_id))',
      r.tbl || '_select', r.tbl);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_restaurant_role(restaurant_id, %L::public.app_role[]))',
      r.tbl || '_insert', r.tbl, r.roles);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_restaurant_role(restaurant_id, %L::public.app_role[])) with check (public.has_restaurant_role(restaurant_id, %L::public.app_role[]))',
      r.tbl || '_update', r.tbl, r.roles, r.roles);
  end loop;
end $$;

-- Ingredientes: locales o compartidos por la organización
create policy ingredients_select on public.ingredients
  for select to authenticated
  using (
    (restaurant_id is null and public.is_org_member(organization_id))
    or (restaurant_id is not null and public.has_restaurant_access(restaurant_id))
  );
create policy ingredients_insert on public.ingredients
  for insert to authenticated
  with check (
    (restaurant_id is null and public.has_org_role(organization_id, array['admin', 'kitchen']::public.app_role[]))
    or (restaurant_id is not null and public.has_restaurant_role(restaurant_id, array['kitchen', 'purchasing']::public.app_role[]))
  );
create policy ingredients_update on public.ingredients
  for update to authenticated
  using (
    (restaurant_id is null and public.has_org_role(organization_id, array['admin', 'kitchen']::public.app_role[]))
    or (restaurant_id is not null and public.has_restaurant_role(restaurant_id, array['kitchen', 'purchasing']::public.app_role[]))
  );

-- Precios: solo inserción (histórico inmutable)
create policy ingredient_prices_select on public.ingredient_prices
  for select to authenticated using (public.has_restaurant_access(restaurant_id));
create policy ingredient_prices_insert on public.ingredient_prices
  for insert to authenticated
  with check (public.has_restaurant_role(restaurant_id, array['kitchen', 'purchasing']::public.app_role[]));

-- Un precio solo puede referirse a un ingrediente visible desde ese restaurante
create or replace function public.check_price_ingredient()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ok boolean;
begin
  select (i.organization_id = new.organization_id and (i.restaurant_id is null or i.restaurant_id = new.restaurant_id))
    into v_ok
  from public.ingredients i where i.id = new.ingredient_id;
  if not coalesce(v_ok, false) then
    raise exception 'El ingrediente no pertenece a este restaurante u organización';
  end if;
  return new;
end;
$$;
create trigger ingredient_prices_check before insert on public.ingredient_prices
  for each row execute function public.check_price_ingredient();

-- Un equipo solo puede usar una tarifa del mismo restaurante y fuente
create or replace function public.check_equipment_tariff()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ok boolean;
begin
  if new.energy_tariff_id is null then return new; end if;
  select (t.restaurant_id = new.restaurant_id and t.source = new.energy_source)
    into v_ok
  from public.energy_tariffs t where t.id = new.energy_tariff_id;
  if not coalesce(v_ok, false) then
    raise exception 'La tarifa debe ser del mismo restaurante y de la misma fuente energética que el equipo';
  end if;
  return new;
end;
$$;
create trigger equipment_tariff_check before insert or update on public.equipment
  for each row execute function public.check_equipment_tariff();

-- Datos derivados de seguridad de la organización: organization_id se rellena
-- desde el restaurante para que el cliente no pueda declarar otro.
create or replace function public.fill_organization_from_restaurant()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.restaurant_id is not null then
    select organization_id into new.organization_id from public.restaurants where id = new.restaurant_id;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['tax_rates', 'energy_tariffs', 'ingredients', 'ingredient_prices', 'equipment', 'labor_profiles', 'consumables']
  loop
    -- los triggers BEFORE se ejecutan por orden alfabético: este debe ir primero
    execute format('create trigger %I before insert on public.%I for each row execute function public.fill_organization_from_restaurant()', 'a0_fill_org_' || t, t);
  end loop;
end $$;
