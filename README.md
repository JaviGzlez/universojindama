# Universo Jindama

Plataforma de costes y escandallos para restaurantes: cada local introduce sus datos una vez y obtiene costes actualizados, explicables y trazables desde un mismo punto.

**Fase 1 (esta versión):** organizaciones, restaurantes, usuarios y roles; materias primas con histórico de precios; equipos, tarifas de energía, impuestos, perfiles de personal y consumibles; motor de cálculo determinista y escandallo simulado; API `/api/v1`.

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

3. Entra en `/acceso` con el usuario `admin`. En **Usuarios** crea al resto (nombre, usuario, contraseña, rol y restaurantes). Desde ahí también cambias contraseñas o retiras accesos.
4. Recomendado: en Supabase → **Authentication → Sign In / Providers**, desactiva **Allow new users to sign up** y **Confirm email**. El panel sigue pudiendo crear usuarios.

**Actividad:** todos los miembros ven lo que se hace en los restaurantes a los que tienen acceso (quién, qué y cuándo), en el apartado *Actividad* y en el Inicio.

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
| `npm test` | Pruebas del motor de cálculo y de la actividad (26) |
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
src/app/panel/[rid]/      Panel por restaurante: inicio, escandallo, materias primas,
                          equipos y consumibles, personal, energía e impuestos
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

## Próximas fases

2. Recetas y elaboraciones versionadas, escandallos guardados, simulaciones e histórico de costes (`cost_snapshots`).
3. Proveedores, facturas (borrador → validada → registrada) con idempotencia y actualización automática de precios.
4. Inventario, producción, ventas y desviaciones de consumo.
5. Control económico, importación del Excel de analítica y conciliación.
6. Extracción y asistencia IA sobre datos validados.
