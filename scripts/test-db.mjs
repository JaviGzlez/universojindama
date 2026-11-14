// Prueba las migraciones y las políticas RLS sobre Postgres (PGlite) con un
// entorno mínimo que imita a Supabase (esquema auth, roles y auth.uid()).
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const db = new PGlite();

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`);

for (const f of fs.readdirSync(dir).sort()) {
  try { await db.exec(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { console.error(f, e.message, e.position); process.exit(1); }
  console.log('migración ok:', f);
}
await db.exec(`
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage on all sequences in schema public to authenticated;
`);

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${A}','a@x.com','{"display_name":"Javi"}'),('${B}','b@x.com','{"display_name":"María"}'),('${C}','c@x.com','{}')`);
// las migraciones a partir de la 4 deben poder repetirse
for (const f of fs.readdirSync(dir).sort().slice(3)) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
console.log((await db.query(`select public.grant_owner('A@x.com','grupo-jindama') r`)).rows[0].r);
await db.exec(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ad','admin@usuarios.universojindama.com')`);
console.log('por usuario:', (await db.query(`select public.grant_owner('Admin','grupo-jindama') r`)).rows[0].r);
const jaleo = (await db.query(`select id, organization_id from restaurants where slug='jaleo'`)).rows[0];
const jindama = (await db.query(`select id from restaurants where slug='jindama'`)).rows[0];
await db.exec(`insert into memberships (organization_id, restaurant_id, user_id, role) values ('${jaleo.organization_id}','${jaleo.id}','${B}','kitchen')`);

let fails = 0;
const check = (name, cond) => { console.log(cond ? '  ✓' : '  ✗', name); if (!cond) fails++; };

async function as(user, fn) {
  await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${user}', true);`);
  try { return await fn(); } finally { await db.exec('rollback'); }
}
async function tryQ(sql) {
  try { await db.exec('savepoint s'); const r = await db.query(sql); await db.exec('release savepoint s'); return { ok: true, r }; }
  catch (e) { await db.exec('rollback to savepoint s'); return { ok: false, e: e.message }; }
}

console.log('Perfiles');
check('perfil creado con nombre', (await db.query(`select display_name from profiles where user_id='${A}'`)).rows[0]?.display_name === 'Javi');
check('perfil sin nombre usa el correo', (await db.query(`select display_name from profiles where user_id='${C}'`)).rows[0]?.display_name === 'c');

console.log('Propietario (A)');
await as(A, async () => {
  check('ve 3 restaurantes', (await db.query('select * from restaurants')).rows.length === 3);
  check('ve ajustes por defecto', (await db.query('select * from restaurant_settings')).rows.length === 3);
  const t = await tryQ(`insert into energy_tariffs (restaurant_id, name, source, unit, price_per_unit) values ('${jindama.id}','Luz','electricity','kWh',0.2) returning id`);
  check('crea tarifa', t.ok);
  const e = await tryQ(`insert into equipment (restaurant_id, name, nominal_power_w, energy_tariff_id) values ('${jindama.id}','Horno',3000,'${t.r.rows[0].id}') returning id, organization_id, version`);
  check('crea equipo con tarifa y org rellenada', e.ok && e.r.rows[0].organization_id === jaleo.organization_id);
  const bad = await tryQ(`insert into equipment (restaurant_id, name, energy_source, energy_tariff_id) values ('${jindama.id}','Fogón','gas','${t.r.rows[0].id}')`);
  check('rechaza tarifa de otra fuente', !bad.ok);
  const u = await db.query(`update equipment set name='Horno mixto' where id='${e.r.rows[0].id}' returning version`);
  check('update incrementa versión', u.rows[0].version === 2);
  const lp = await db.query(`insert into labor_profiles (restaurant_id, name, period_cost, productive_hours) values ('${jindama.id}','Cocinero',2400,150) returning cost_per_hour`);
  check('coste hora = 16', Number(lp.rows[0].cost_per_hour) === 16);
  check('ve auditoría', (await db.query('select * from audit_events')).rows.length > 0);
  check('no puede llamar grant_owner', !(await tryQ(`select public.grant_owner('c@x.com','grupo-jindama')`)).ok);
  const shared = await tryQ(`insert into ingredients (organization_id, name, base_unit) values ('${jaleo.organization_id}','Sal','g')`);
  check('crea ingrediente compartido', shared.ok);
  check('asigna acceso a C en Jindama', (await tryQ(`select public.set_member_access('${jaleo.organization_id}','${C}','viewer',array['${jindama.id}']::uuid[])`)).ok);
  check('rechaza apartado desconocido', !(await tryQ(`select public.set_member_access('${jaleo.organization_id}','${C}','viewer',null,'{"cohetes":"write"}'::jsonb)`)).ok);
  check('C queda con 1 acceso', (await db.query(`select * from memberships where user_id='${C}'`)).rows.length === 1);
  check('cambia a todo el grupo', (await tryQ(`select public.set_member_access('${jaleo.organization_id}','${C}','kitchen',null)`)).ok
    && (await db.query(`select restaurant_id from memberships where user_id='${C}'`)).rows[0].restaurant_id === null);
  check('no puede asignar propietario', !(await tryQ(`select public.set_member_access('${jaleo.organization_id}','${C}','owner',null)`)).ok);
  check('no se cambia a sí mismo', !(await tryQ(`select public.set_member_access('${jaleo.organization_id}','${A}','viewer',null)`)).ok);
  check('quita acceso', (await tryQ(`select public.remove_member('${jaleo.organization_id}','${C}')`)).ok
    && (await db.query(`select * from memberships where user_id='${C}'`)).rows.length === 0);
  check('cambia el nombre de un miembro', (await db.query(`update profiles set display_name='María G.' where user_id='${B}' returning 1`)).rows.length === 1);
});

// actividad persistente en Jindama (como A, confirmada)
await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${A}', true);
  insert into equipment (restaurant_id, name) values ('${jindama.id}','Freidora'); commit;`);

console.log('Cocina en Jaleo (B)');
await as(B, async () => {
  const rs = (await db.query('select slug from restaurants')).rows;
  check('solo ve Jaleo', rs.length === 1 && rs[0].slug === 'jaleo');
  const i = await tryQ(`insert into ingredients (organization_id, restaurant_id, name, base_unit, yield_ratio) values ('${jaleo.organization_id}','${jaleo.id}','Aceite de oliva','ml',1) returning id`);
  check('crea ingrediente en Jaleo', i.ok);
  check('registra precio', (await tryQ(`insert into ingredient_prices (restaurant_id, ingredient_id, price_per_base_unit) values ('${jaleo.id}','${i.r.rows[0].id}',0.0065)`)).ok);
  check('ve precio vigente', (await db.query('select * from current_ingredient_prices')).rows.length === 1);
  check('no crea en Jindama', !(await tryQ(`insert into ingredients (organization_id, restaurant_id, name, base_unit) values ('${jaleo.organization_id}','${jindama.id}','X','g')`)).ok);
  check('no crea precio en Jindama', !(await tryQ(`insert into ingredient_prices (restaurant_id, ingredient_id, price_per_base_unit) values ('${jindama.id}','${i.r.rows[0].id}',1)`)).ok);
  check('no crea impuestos (rol administración)', !(await tryQ(`insert into tax_rates (restaurant_id, name, kind, rate) values ('${jaleo.id}','IVA','sale',0.1)`)).ok);
  check('no ve el registro de actividad (solo propietario)', (await db.query('select * from audit_events')).rows.length === 0);
  check('ve el nombre de Javi', (await db.query(`select display_name from profiles where user_id='${A}'`)).rows.length === 1);
  check('no ve el perfil de C', (await db.query(`select * from profiles where user_id='${C}'`)).rows.length === 0);
  check('no cambia el nombre de Javi', (await db.query(`update profiles set display_name='X' where user_id='${A}' returning 1`)).rows.length === 0);
  check('no gestiona accesos', !(await tryQ(`select public.set_member_access('${jaleo.organization_id}','${C}','viewer',null)`)).ok);
  check('cambia su propio nombre', (await db.query(`update profiles set display_name='Mari' where user_id='${B}' returning 1`)).rows.length === 1);
  check('no puede darse rol', !(await tryQ(`insert into memberships (organization_id, user_id, role) values ('${jaleo.organization_id}','${B}','owner')`)).ok);
  const upd = await db.query(`update restaurants set name='Hack' where slug='jindama' returning id`);
  check('no modifica Jindama', upd.rows.length === 0);
});

console.log('Sin pertenencia (C)');
await as(C, async () => {
  check('no ve restaurantes', (await db.query('select * from restaurants')).rows.length === 0);
  check('no ve organizaciones', (await db.query('select * from organizations')).rows.length === 0);
  check('no ve actividad', (await db.query('select * from audit_events')).rows.length === 0);
  check('no ve ingredientes', (await db.query('select * from ingredients')).rows.length === 0);
});

console.log('Fases 2–5 (propietario)');
await as(A, async () => {
  const one = async (sql) => (await db.query(sql)).rows[0];
  const R = jindama.id;
  const ing = await one(`insert into ingredients (organization_id, restaurant_id, name, base_unit) values ('${jaleo.organization_id}','${R}','Tomate','g') returning id`);
  const prep = await one(`insert into recipes (restaurant_id, name, kind) values ('${R}','Salsa','preparation') returning id`);
  const vPrep = await one(`select public.new_recipe_version('${prep.id}') v`);
  await db.exec(`update recipe_versions set yield_quantity=1000, yield_unit='g' where id='${vPrep.v}'`);
  await db.exec(`insert into recipe_ingredients (restaurant_id, version_id, ingredient_id, quantity, unit) values ('${R}','${vPrep.v}','${ing.id}',1200,'g')`);
  check('activa elaboración', (await tryQ(`select public.activate_recipe_version('${vPrep.v}')`)).ok);
  check('no edita líneas de versión activa', !(await tryQ(`update recipe_ingredients set quantity=1 where version_id='${vPrep.v}'`)).ok);
  const plato = await one(`insert into recipes (restaurant_id, name, kind) values ('${R}','Pasta','dish') returning id`);
  const vPl = await one(`select public.new_recipe_version('${plato.id}') v`);
  await db.exec(`update recipe_versions set portions=4 where id='${vPl.v}'`);
  check('plato usa elaboración', (await tryQ(`insert into recipe_ingredients (restaurant_id, version_id, sub_recipe_id, quantity, unit) values ('${R}','${vPl.v}','${prep.id}',300,'g')`)).ok);
  check('no usa un plato como subreceta', !(await tryQ(`insert into recipe_ingredients (restaurant_id, version_id, sub_recipe_id, quantity, unit) values ('${R}','${vPl.v}','${plato.id}',1,'unit')`)).ok);
  check('activa plato', (await tryQ(`select public.activate_recipe_version('${vPl.v}')`)).ok);
  const vPrep2 = await one(`select public.new_recipe_version('${prep.id}') v`);
  const ver2 = await one(`select version from recipe_versions where id='${vPrep2.v}'`);
  const sv = await tryQ(`select public.save_recipe_draft('${vPrep2.v}', ${ver2.version}, '{"yield_quantity":"900","yield_unit":"g","ingredientes":[{"ingredient_id":"${ing.id}","quantity":"1000","unit":"g"}]}'::jsonb) n`);
  check('guarda borrador completo', sv.ok && Number((await one(`select quantity from recipe_ingredients where version_id='${vPrep2.v}'`)).quantity) === 1000);
  const ver3 = await one(`select version from recipe_versions where id='${vPrep2.v}'`);
  const sv2 = await tryQ(`select public.save_recipe_draft('${vPrep2.v}', ${ver3.version}, '{"yield_quantity":"900","yield_unit":"g","cook_minutes":"45","shelf_life_hours":"72","storage":"Cámara 0–4 °C","extra_allergens":["sulfitos"],"ingredientes":[{"ingredient_id":"${ing.id}","quantity":"1000","unit":"g"}],"pasos":[{"description":"Sofreír","minutes":"10","temperature_c":"120","is_critical":false},{"description":"Abatir","minutes":"90","temperature_c":"3","is_critical":true}]}'::jsonb)`);
  check('guarda ficha y pasos', sv2.ok && Number((await one(`select count(*) n from recipe_steps where version_id='${vPrep2.v}'`)).n) === 2
    && (await one(`select extra_allergens from recipe_versions where id='${vPrep2.v}'`)).extra_allergens[0] === 'sulfitos');
  check('rechaza versión desfasada', !(await tryQ(`select public.save_recipe_draft('${vPrep2.v}', ${ver2.version}, '{}'::jsonb)`)).ok);
  check('nueva versión copia líneas', Number((await one(`select count(*) n from recipe_ingredients where version_id='${vPrep2.v}'`)).n) === 1);
  const prep2 = await one(`insert into recipes (restaurant_id, name, kind) values ('${R}','Base','preparation') returning id`);
  const vB = await one(`select public.new_recipe_version('${prep2.id}') v`);
  await db.exec(`insert into recipe_ingredients (restaurant_id, version_id, sub_recipe_id, quantity, unit) values ('${R}','${vB.v}','${prep.id}',10,'g')`);
  check('bloquea referencia circular', !(await tryQ(`insert into recipe_ingredients (restaurant_id, version_id, sub_recipe_id, quantity, unit) values ('${R}','${vPrep2.v}','${prep2.id}',10,'g')`)).ok);
  const afect = (await db.query(`select * from public.recipes_using_ingredients('${R}', array['${ing.id}']::uuid[])`)).rows.map((r) => r.recipe_id);
  check('detecta dependencias (elaboración y plato)', afect.includes(prep.id) && afect.includes(plato.id));

  // compras
  const sup = await one(`insert into suppliers (restaurant_id, name) values ('${R}','Makro') returning id`);
  const inv = await one(`insert into purchase_invoices (restaurant_id, supplier_id, number, invoice_date) values ('${R}','${sup.id}','F-1','2026-11-01') returning id, version`);
  check('detecta factura duplicada', !(await tryQ(`insert into purchase_invoices (restaurant_id, supplier_id, number, invoice_date) values ('${R}','${sup.id}',' f-1 ','2026-11-02')`)).ok);
  const line = await one(`insert into purchase_lines (restaurant_id, invoice_id, ingredient_id, description, packs, pack_quantity, pack_unit, pack_price) values ('${R}','${inv.id}','${ing.id}','Caja 5 kg',2,5,'kg',10) returning id`);
  check('no registra sin validar', !(await tryQ(`select public.post_purchase_invoice('${inv.id}')`)).ok);
  check('no se valida a mano', !(await tryQ(`update purchase_invoices set status='validated' where id='${inv.id}'`)).ok);
  check('valida', (await tryQ(`select public.validate_purchase_invoice('${inv.id}', ${inv.version}, '[{"id":"${line.id}","base_quantity":"10000","price_per_base_unit":"0.002","line_net":"20"}]'::jsonb)`)).ok);
  check('líneas bloqueadas tras validar', !(await tryQ(`update purchase_lines set packs=3 where id='${line.id}'`)).ok);
  const post = await tryQ(`select public.post_purchase_invoice('${inv.id}')`); if (!post.ok) console.log(post.e);
  check('registra', post.ok);
  check('no registra dos veces', !(await tryQ(`select public.post_purchase_invoice('${inv.id}')`)).ok);
  check('precio aplicado', Number((await one(`select price_per_base_unit p from ingredient_prices where ingredient_id='${ing.id}' and source='invoice'`)).p) === 0.002);
  check('entrada en inventario', Number((await one(`select quantity q from public.stock_on_hand('${R}') where ingredient_id='${ing.id}'`)).q) === 10000);

  // carta y ventas
  const ch = await one(`insert into sales_channels (restaurant_id, name, kind, commission_pct) values ('${R}','Glovo','platform',0.3) returning id`);
  const mi = await one(`insert into menu_items (restaurant_id, name, recipe_id) values ('${R}','Pasta','${plato.id}') returning id`);
  check('precio por canal', (await tryQ(`insert into channel_prices (restaurant_id, menu_item_id, channel_id, pvp, tax_rate) values ('${R}','${mi.id}','${ch.id}',12,0.1)`)).ok);
  check('venta CSV sin duplicar', (await tryQ(`insert into sales (restaurant_id, sale_date, menu_item_id, channel_id, quantity, source, import_key) values ('${R}','2026-11-01','${mi.id}','${ch.id}',3,'csv','k1')`)).ok
    && !(await tryQ(`insert into sales (restaurant_id, sale_date, menu_item_id, channel_id, quantity, source, import_key) values ('${R}','2026-11-01','${mi.id}','${ch.id}',3,'csv','k1')`)).ok);
  check('reimportar con on conflict no falla', (await tryQ(`insert into sales (restaurant_id, sale_date, menu_item_id, channel_id, quantity, source, import_key) values ('${R}','2026-11-01','${mi.id}','${ch.id}',3,'csv','k1') on conflict (restaurant_id, import_key) do nothing`)).ok);
  check('recuento y merma', (await tryQ(`with c as (insert into stock_counts (restaurant_id) values ('${R}') returning id) insert into stock_count_lines (restaurant_id, count_id, ingredient_id, quantity) select '${R}', id, '${ing.id}', 9000 from c`)).ok
    && (await tryQ(`insert into stock_movements (restaurant_id, ingredient_id, kind, quantity) values ('${R}','${ing.id}','waste',-100)`)).ok);
  check('merma debe ser negativa', !(await tryQ(`insert into stock_movements (restaurant_id, ingredient_id, kind, quantity) values ('${R}','${ing.id}','waste',100)`)).ok);

  // economía
  check('gasto manual', (await tryQ(`insert into financial_entries (restaurant_id, entry_date, kind, category, amount) values ('${R}','2026-10-05','expense','Luz',100)`)).ok);
  check('cierra periodo', (await tryQ(`select public.set_period_status('${R}', 2026, 10, 'closed')`)).ok);
  check('periodo cerrado bloquea', !(await tryQ(`insert into financial_entries (restaurant_id, entry_date, kind, category, amount) values ('${R}','2026-10-06','expense','Luz',1)`)).ok);
  check('reabre periodo', (await tryQ(`select public.set_period_status('${R}', 2026, 10, 'open')`)).ok);
  const job = await one(`insert into import_jobs (organization_id, file_name, file_hash, year) values ('${jaleo.organization_id}','a.xlsx','h',2026) returning id`);
  await db.exec(`insert into import_rows (job_id, block, sheet, cell, entry_date, kind, category, amount) values
    ('${job.id}',1,'OCTUBRE','H10','2026-10-01','purchase','Compras',50),('${job.id}',1,'OCTUBRE','AI10','2026-10-01','revenue','Ingresos',300),('${job.id}',2,'OCTUBRE','H56','2026-10-01','purchase','Compras',70)`);
  const ap = await tryQ(`select public.apply_import('${job.id}', '{"1":"${R}","2":null}'::jsonb) r`);
  check('aplica importación (solo bloques asignados)', ap.ok && ap.r.rows[0].r.inserted === 2);
  const job2 = await one(`insert into import_jobs (organization_id, file_name, file_hash, year) values ('${jaleo.organization_id}','a.xlsx','h2',2026) returning id`);
  await db.exec(`insert into import_rows (job_id, block, sheet, cell, entry_date, kind, category, amount) values ('${job2.id}',1,'OCTUBRE','H10','2026-10-01','purchase','Compras',55)`);
  await db.exec(`select public.apply_import('${job2.id}', '{"1":"${R}"}'::jsonb)`);
  check('reimportar sustituye, no duplica', Number((await one(`select count(*) n from financial_entries where restaurant_id='${R}' and source='excel'`)).n) === 1);
  check('deshace importación', (await tryQ(`select public.revert_import('${job2.id}')`)).ok
    && Number((await one(`select count(*) n from financial_entries where restaurant_id='${R}' and source='excel'`)).n) === 0);
});

console.log('Cocina en Jaleo (B), fases 2–5');
await as(B, async () => {
  check('crea receta en Jaleo', (await tryQ(`insert into recipes (restaurant_id, name, kind) values ('${jaleo.id}','Croquetas','dish')`)).ok);
  check('no crea proveedores (rol compras)', !(await tryQ(`insert into suppliers (restaurant_id, name) values ('${jaleo.id}','X')`)).ok);
  check('no crea gastos (rol administración)', !(await tryQ(`insert into financial_entries (restaurant_id, entry_date, kind, category, amount) values ('${jaleo.id}','2026-10-05','expense','Luz',1)`)).ok);
  check('no ve importaciones', (await db.query('select * from import_jobs')).rows.length === 0);
  check('no crea recetas en Jindama', !(await tryQ(`insert into recipes (restaurant_id, name, kind) values ('${jindama.id}','X','dish')`)).ok);
});

console.log('Permisos con casillas (C: solo Jaleo, recetas editar, compras ver, resto no)');
await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${A}', true);
  select public.set_member_access('${jaleo.organization_id}','${C}','viewer',array['${jaleo.id}']::uuid[],
    '{"recetas":"write","compras":"read","materias":"none","equipos":"none","inventario":"none","carta":"none","ventas":"none","economia":"none","personal":"none","ajustes":"none"}'::jsonb);
  insert into suppliers (restaurant_id, name) values ('${jaleo.id}','Proveedor Jaleo');
  insert into financial_entries (restaurant_id, entry_date, kind, category, amount) values ('${jaleo.id}','2026-11-02','expense','Luz',10);
  commit;`);
await as(C, async () => {
  check('ve solo Jaleo', (await db.query('select slug from restaurants')).rows.map((r) => r.slug).join() === 'jaleo');
  check('crea receta (editar)', (await tryQ(`insert into recipes (restaurant_id, name, kind) values ('${jaleo.id}','Gazpacho','dish')`)).ok);
  check('ve proveedores (ver)', (await db.query('select * from suppliers')).rows.length >= 1);
  check('no crea proveedores (solo ver)', !(await tryQ(`insert into suppliers (restaurant_id, name) values ('${jaleo.id}','Y')`)).ok);
  check('no ve economía (no)', (await db.query('select * from financial_entries')).rows.length === 0);
  check('no crea materias primas (no)', !(await tryQ(`insert into ingredients (organization_id, restaurant_id, name, base_unit) values ('${jaleo.organization_id}','${jaleo.id}','Z','g')`)).ok);
  check('ve materias primas para escandallar', (await tryQ('select * from ingredients')).ok);
  check('no ve actividad', (await db.query('select * from audit_events')).rows.length === 0);
});

console.log('Tareas');
const org = jaleo.organization_id;
const D = '00000000-0000-0000-0000-00000000000d';
await db.exec(`insert into auth.users (id, email) values ('${D}','d@fuera.com')`);
await db.exec(`select set_config('request.jwt.claim.sub', '${A}', false)`);
const T1 = (await db.query(`insert into tasks (organization_id, title) values ('${org}','Revisar alérgenos de la carta') returning id`)).rows[0].id;
const T2 = (await db.query(`insert into tasks (organization_id, title, restaurant_ids) values ('${org}','Pedir aceite','{${jindama.id}}') returning id`)).rows[0].id;
const T3 = (await db.query(`insert into tasks (organization_id, title, restaurant_ids, assignee_ids) values ('${org}','Inventario de cámara','{${jaleo.id}}','{${B},${C}}') returning id, created_by`)).rows[0];
await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
check('creador rellenado', T3.created_by === A);
await as(A, async () => {
  check('rechaza responsable de fuera del grupo', !(await tryQ(`insert into tasks (organization_id, title, assignee_ids) values ('${org}','X','{${B},${D}}')`)).ok);
  check('rechaza restaurante inexistente', !(await tryQ(`insert into tasks (organization_id, title, restaurant_ids) values ('${org}','X','{00000000-0000-0000-0000-000000000999}')`)).ok);
});
await as(B, async () => {
  const vis = (await db.query('select id from tasks')).rows.map((r) => r.id);
  check('B ve la del grupo y la de Jaleo, no la de Jindama', vis.includes(T1) && vis.includes(T3.id) && !vis.includes(T2));
  check('B ve a las personas del grupo', (await db.query(`select * from public.org_people('${org}')`)).rows.length >= 3);
  check('B mueve su tarea a revisión', (await tryQ(`update tasks set status='review' where id='${T3.id}'`)).ok);
  const done = await db.query(`update tasks set status='done' where id='${T3.id}' returning completed_at, completed_by`);
  check('al completar guarda quién y cuándo', done.rows[0].completed_at !== null && done.rows[0].completed_by === B);
  check('B no puede asignar a otro una tarea libre', !(await tryQ(`update tasks set assignee_ids='{${C}}' where id='${T1}'`)).ok);
  check('B no puede cambiar el título de una tarea ajena', !(await tryQ(`update tasks set title='Otro' where id='${T1}'`)).ok);
  check('B no borra una tarea ajena', (await db.query(`delete from tasks where id='${T1}' returning id`)).rows.length === 0);
});
await as(C, async () => {
  const cl = await tryQ(`update tasks set assignee_ids='{${C}}', status='in_progress' where id='${T1}' returning version`);
  check('C, corresponsable, mueve la tarea compartida', (await tryQ(`update tasks set status='review' where id='${T3.id}'`)).ok);
  check('C ve la tarea compartida', (await db.query(`select id from tasks where id='${T3.id}'`)).rows.length === 1);
  check('C se queda una tarea libre y la empieza', cl.ok && cl.r.rows.length === 1);
  check('C comenta', (await tryQ(`insert into task_comments (task_id, body) values ('${T1}','Empiezo mañana')`)).ok);
  check('comentario con autor y grupo', (await db.query(`select author_id, organization_id from task_comments`)).rows.every((r) => r.author_id === C && r.organization_id === org));
});
await db.exec(`select set_config('request.jwt.claim.sub', '${A}', false); update tasks set assignee_ids='{${C}}' where id='${T1}'`);
await as(B, async () => {
  check('B no puede quitársela a quien la cogió', !(await tryQ(`update tasks set assignee_ids='{${B}}' where id='${T1}'`)).ok);
  check('B no puede apuntar a otra persona', !(await tryQ(`update tasks set assignee_ids='{${C},${A}}' where id='${T1}'`)).ok);
  check('B se apunta a la tarea de C', (await tryQ(`update tasks set assignee_ids='{${C},${B}}' where id='${T1}'`)).ok);
  check('apuntado, B ya puede moverla', (await tryQ(`update tasks set status='review' where id='${T1}'`)).ok);
});
await as(C, async () => {
  check('C la suelta y vuelve a quedar libre', (await tryQ(`update tasks set assignee_ids='{}', status='pending' where id='${T1}'`)).ok);
});
await as(A, async () => {
  check('el propietario ve todas', (await db.query('select * from tasks')).rows.length === 3);
  check('el propietario reasigna', (await tryQ(`update tasks set assignee_ids='{${B},${C}}' where id='${T2}'`)).ok);
  check('responsables sin duplicados', (await db.query(`update tasks set assignee_ids='{${B},${B},${C}}' where id='${T2}' returning assignee_ids`)).rows[0].assignee_ids.length === 2);
  check('el propietario borra', (await db.query(`delete from tasks where id='${T2}' returning id`)).rows.length === 1);
  check('tareas en el registro de actividad', (await db.query(`select * from audit_events where table_name='tasks'`)).rows.length >= 3);
});

console.log(fails ? `${fails} fallos` : 'Todo correcto');
process.exit(fails ? 1 : 0);
