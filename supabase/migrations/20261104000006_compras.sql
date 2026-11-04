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
