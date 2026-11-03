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
  create table auth.users (id uuid primary key, email text);
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
await db.exec(`insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com'),('${C}','c@x.com')`);
console.log((await db.query(`select public.grant_owner('A@x.com','grupo-jindama') r`)).rows[0].r);
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
});

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
  check('no ve auditoría', (await db.query('select * from audit_events')).rows.length === 0);
  check('no puede darse rol', !(await tryQ(`insert into memberships (organization_id, user_id, role) values ('${jaleo.organization_id}','${B}','owner')`)).ok);
  const upd = await db.query(`update restaurants set name='Hack' where slug='jindama' returning id`);
  check('no modifica Jindama', upd.rows.length === 0);
});

console.log('Sin pertenencia (C)');
await as(C, async () => {
  check('no ve restaurantes', (await db.query('select * from restaurants')).rows.length === 0);
  check('no ve organizaciones', (await db.query('select * from organizations')).rows.length === 0);
  check('no ve ingredientes', (await db.query('select * from ingredients')).rows.length === 0);
});

console.log(fails ? `${fails} fallos` : 'Todo correcto');
process.exit(fails ? 1 : 0);
