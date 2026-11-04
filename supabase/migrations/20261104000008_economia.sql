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
