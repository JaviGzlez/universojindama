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
