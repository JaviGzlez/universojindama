# Universo Jindama

Plataforma de costes y escandallos para restaurantes: cada local introduce sus datos una vez y obtiene costes actualizados, explicables y trazables desde un mismo punto.

**Incluye (fases 1 a 5):**

- **Universo:** portada de grupo con los tres mundos en movimiento; al tocar uno (o el grupo) se ven sus gráficas animadas de ingresos, resultado, compras, personal y gastos, KPIs y comparativa, Doble clic en un restaurante (o el botón «Entrar en…») abre su panel.
- **Acceso:** usuario y contraseña sin correo; el propietario crea las cuentas en **Administración**, elige a qué restaurantes accede cada persona y marca por áreas (recetas, compras y facturas, inventario, carta, ventas, economía…) si no ve, solo ve o edita. El **registro de actividad** con cada movimiento solo lo ve el propietario.
- **Recetas y elaboraciones:** composición y coste, proceso paso a paso (tiempos, temperatura, equipo, puntos críticos), conservación, vida útil, presentación, alérgenos derivados y ficha técnica imprimible. *Dónde se usa* conecta elaboraciones, platos y carta.
- **Tareas:** tablero Pendiente → En curso → En revisión → Completada. Cada tarea puede tener responsable, restaurantes, prioridad, fecha límite y comentarios. Las que no tienen responsable las coge quien pulse «Me la quedo». Cada persona ve las de todo el grupo y las de sus restaurantes.
- **Materias primas conectadas:** cada una tiene su ficha con evolución del precio, proveedores, últimas compras, recetas que la usan, existencias y mermas. Equipos y consumibles muestran coste por hora y en qué recetas se usan.
- **Cocina:** materias primas con histórico de precios, equipos, personal, tarifas, impuestos y consumibles; **recetas y elaboraciones** con versiones (borrador → activa → sustituida), elaboraciones dentro de recetas sin duplicar costes, bloqueo de referencias circulares, **histórico de costes** que nunca se reescribe y escandallo rápido.
- **Compras:** proveedores, productos de proveedor (formato y marca) y **facturas** borrador → validada → registrada; el registro es transaccional e idempotente, aplica precios e inventario y **recalcula las recetas afectadas** con avisos si el coste cambia más del umbral.
- **Sala:** canales (sala, recogida, reparto, plataformas) con comisiones y envases; carta con precio por canal y vigencia, margen de contribución y % de materia prima frente a objetivo; ventas por plato manuales o por CSV del TPV (sin duplicar).
- **Almacén:** existencias, mermas, ajustes, traspasos, recuentos y **consumo real frente a teórico** entre dos recuentos.
- **Economía:** cuenta de resultados mensual por restaurante o grupo, movimientos manuales, cierre y reapertura de periodos, gastos generales repartidos por ración, e **importador del Excel de analítica** con vista previa, mapeo de bloques, avisos de descuadres y trazabilidad hoja/celda.
- **API** `/api/v1` y motor de cálculo determinista con decimales exactos.

La IA (fase 6) queda para la siguiente tanda.

Stack: Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, RLS) · Vercel.

---

## Puesta en marcha

### 1. GitHub

```bash
cd universo-jindama
git init
git add .
git commit -m "Universo Jindama · fase 1"
git branch -M main
git remote add origin https://github.com/JaviGzlez/universojindama.git
git push -u origin main
```

### 2. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com) (región UE, p. ej. Frankfurt o París).
2. Abre **SQL Editor** y ejecuta, **en este orden**, el contenido de:
   1. `supabase/migrations/20261103000001_acceso.sql`
   2. `supabase/migrations/20261103000002_catalogos.sql`
   3. `supabase/migrations/20261103000003_datos_iniciales.sql` (crea *Grupo Jindama* con Jindama, Jaleo y Juye Burger)
   4. `supabase/migrations/20261104000004_usuarios_actividad.sql` (nombres de usuario, actividad y gestión de accesos)
   5. `supabase/migrations/20261104000005_recetas.sql`
   6. `supabase/migrations/20261104000006_compras.sql`
   7. `supabase/migrations/20261104000007_carta_ventas_inventario.sql`
   8. `supabase/migrations/20261104000008_economia.sql`
   9. `supabase/migrations/20261110000009_permisos.sql` (permisos por áreas; actividad solo para el propietario)
   10. `supabase/migrations/20261110000010_recetas_ficha.sql` (pasos de elaboración, tiempos, conservación)
   11. `supabase/migrations/20261114000011_tareas.sql` (tareas del equipo)

   Atajos para un proyecto ya creado: `supabase/actualizar-fases-2-a-5.sql` (migraciones 5–8), `supabase/actualizar-permisos-y-fichas.sql` (9–10) y `supabase/actualizar-tareas.sql` (11).

   Todas a partir de la 4 se pueden volver a ejecutar sin problema.

   Si prefieres la CLI: `npx supabase init` (si pregunta, responde que no), luego `npx supabase link --project-ref TU_REF` y `npx supabase db push`.
3. En **Project Settings → API** copia la *Project URL* y la *Publishable key* (o *anon key*).

### 3. Vercel

1. **Add New → Project** e importa el repo `universojindama`. Vercel detecta Next.js solo.
2. En **Environment Variables** añade:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (o `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - `SUPABASE_SECRET_KEY` — tipo **Secret**, solo servidor. Es la *secret key* (`sb_secret_…`) y se usa únicamente para crear usuarios y cambiar contraseñas desde el panel.
3. **Deploy**.

### 4. Conectar autenticación

En Supabase → **Authentication → URL Configuration**:

- **Site URL:** `https://TU-DOMINIO.vercel.app`
- **Redirect URLs:** `https://TU-DOMINIO.vercel.app/auth/callback` y, para desarrollo, `http://localhost:3000/auth/callback`

### 5. Usuario admin y equipo

Se entra con **usuario y contraseña**, sin correo ni confirmación. Supabase exige un email por cuenta, así que la web usa uno interno (`usuario@usuarios.universojindama.com`) que nadie ve ni recibe correo.

1. En Supabase → **Authentication → Users → Add user → Create new user**:
   - Email: `admin@usuarios.universojindama.com`
   - Password: la que quieras
   - Marca **Auto Confirm User**
2. En el SQL Editor:

   ```sql
   select public.grant_owner('admin', 'grupo-jindama');
   update public.profiles set display_name = 'Javi' where email = 'admin@usuarios.universojindama.com';
   ```

3. Entra en `/acceso` con el usuario `admin`. En **Administración** (arriba a la derecha) crea al resto: nombre, usuario, contraseña, perfil, restaurantes y casillas por área. Desde ahí también cambias contraseñas o retiras accesos.
4. Recomendado: en Supabase → **Authentication → Sign In / Providers**, desactiva **Allow new users to sign up** y **Confirm email**. El panel sigue pudiendo crear usuarios.

**Actividad:** cada movimiento (quién, qué y cuándo) queda registrado. Solo el propietario lo ve, en *Administración → Registro de actividad* y al final del menú de cada restaurante.

Roles: `owner` (propietario), `admin`, `kitchen` (cocina), `purchasing` (compras), `accounting` (administración), `viewer` (consulta). Con `restaurant_id` nulo, el rol aplica a todos los restaurantes de la organización.

---

## Desarrollo local

```bash
npm install
cp .env.example .env.local   # rellena las dos variables
npm run dev                  # http://localhost:3000
```

| Comando | Qué hace |
|---|---|
| `npm test` | Motor, recetas con elaboraciones, facturas, ventas CSV, inventario, importador del Excel y actividad (39) |
| `npm run test:db` | Ejecuta las migraciones sobre Postgres embebido y prueba los permisos RLS |
| `npm run typecheck` / `npm run lint` | Tipos y estilo |
| `npm run build` | Compilación de producción |

El workflow `.github/workflows/ci.yml` ejecuta todo lo anterior en cada push.

---

## Estructura

```
supabase/migrations/      Esquema, RLS, auditoría y datos iniciales
src/lib/engine/           Motor de cálculo (puro, sin BD ni IA) + tests
src/lib/api/              Utilidades de la API (errores, paginación, If-Match)
src/app/page.tsx          Portada
src/app/acceso/           Login y registro
src/app/panel/page.tsx    Universo: portada de grupo con gráficas
src/app/panel/[rid]/      Panel por restaurante: inicio, actividad, recetas, escandallo,
                          materias primas, equipos, compras, inventario, carta, ventas,
                          economía (resultados, movimientos, importar Excel), ajustes
src/app/panel/tareas/          Tablero de tareas del equipo
src/app/panel/administracion/  Equipo, permisos por áreas y registro de actividad (propietario)
src/lib/importar/         Lector del Excel de analítica (puro, probado)
src/app/api/v1/           API REST
docs/api.md               Referencia de la API
```

## Principios que respeta el código

- **Un dato desconocido no es cero.** El motor devuelve `null` y lo lista en `missing_inputs`; el estado es `complete`, `estimated` o `incomplete`.
- **Decimales exactos** (`decimal.js`); se redondea solo al mostrar.
- **La autorización vive en la base de datos.** Cada tabla tiene RLS por organización, restaurante y rol; la interfaz solo refleja esos permisos.
- **Histórico:** los precios son filas nuevas, nunca se reescriben; los catálogos se archivan, no se borran; los cambios sensibles quedan en `audit_events`.
- **Concurrencia:** columna `version` en cada registro; la API exige `If-Match` para modificar.
- **Guardado honesto:** la interfaz solo muestra «Guardado» cuando el servidor confirma la escritura.

## Importar el Excel de analítica

Economía → Importar Excel. Se sube el `.xlsx`, se revisa lo leído por bloque (Jindama, Jaleo, Juye), los avisos (columnas cuya fila TOTALES no coincide con sus celdas, días que no existen, títulos de bloque cambiados) y las celdas con error, se elige a qué restaurante va cada bloque y se aplica. Reimportar un Excel actualizado sustituye lo importado antes en esos meses (no duplica); los periodos cerrados no se tocan. Del personal solo se guardan los totales del mes, nunca nombres ni sueldos individuales.

## Próximas fases

6. Asistente IA: lectura de facturas, borradores de recetas y consultas sobre datos validados.
7. Integraciones con TPV, reservas y contabilidad; conciliación bancaria.
