# API v1

Base: `/api/v1` · JSON · cada respuesta lleva la cabecera `x-request-id`.

## Autenticación

- Desde el navegador: cookie de sesión de Supabase (automática al iniciar sesión).
- Desde integraciones: `Authorization: Bearer <access_token de Supabase>`.

La autorización la aplica Postgres (RLS) con la identidad del usuario: la API no puede ver ni modificar nada que el usuario no pueda.

## Errores

```json
{ "error": { "code": "forbidden", "message": "No tienes permiso para esta operación." }, "request_id": "…" }
```

| HTTP | code |
|---|---|
| 400 | `invalid_json` |
| 401 | `unauthenticated` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 409 | `conflict` |
| 412 | `precondition_failed` (la versión de `If-Match` ya no es la actual) |
| 422 | `validation_failed`, `constraint_violation` |
| 428 | `precondition_required` (falta `If-Match`) |
| 503 | `not_configured` |

## Concurrencia

Los `GET` de recursos individuales devuelven `ETag: "<version>"`. Para modificar, envía `If-Match: "<version>"`.

## Paginación

`?limit=50&cursor=<id>` → `{ "data": [...], "next_cursor": "<id>" | null }`

## Operaciones

| Método | Ruta | Notas |
|---|---|---|
| GET | `/me` | Usuario y pertenencias |
| GET | `/organizations` | |
| GET | `/organizations/{id}/restaurants` | |
| POST | `/organizations/{id}/restaurants` | Solo propietario |
| GET / PATCH | `/restaurants/{id}/settings` | PATCH con `If-Match` |
| GET / POST | `/restaurants/{id}/ingredients` | Incluye los compartidos del grupo. POST acepta `"shared": true` |
| GET / POST | `/restaurants/{id}/equipment` | |
| GET / POST | `/restaurants/{id}/labor-profiles` | `cost_per_hour` se calcula en BD |
| GET / POST | `/restaurants/{id}/energy-tariffs` | |
| GET / POST | `/restaurants/{id}/tax-rates` | `rate`: 10 % = `0.10` |
| GET / POST | `/restaurants/{id}/consumables` | |
| GET / PATCH | `/ingredients/{id}` | PATCH con `If-Match`; archivar con `{"status":"archived"}` |
| GET / POST | `/ingredients/{id}/prices` | Histórico; un precio nuevo es siempre una fila nueva |
| POST | `/calculate` | Motor sin estado (ver abajo) |

Los listados aceptan `?status=active|archived|all` (por defecto `active`).

## POST /calculate

Recibe datos ya resueltos y devuelve el contrato de cálculo: `status`, `coverage`, `costs`, `profitability`, `lines` (con fórmula, calidad del dato y naturaleza fija/variable, directa/indirecta), `missing_inputs` con códigos estables, `assumptions` y `calculation_version`. Los importes se serializan como cadenas con 6 decimales.

```json
{
  "valuationDate": "2026-11-03",
  "portions": 10,
  "ingredients": [
    { "ingredient": { "id": "x", "name": "Patata", "baseUnit": "g", "yieldRatio": "0.80", "pricePerBaseUnit": "0.0012" },
      "quantity": 2000, "unit": "g", "quantityType": "net" }
  ],
  "equipment": [
    { "name": "Horno", "source": "electricity", "minutes": 30, "nominalPowerW": 3000, "dutyFactor": 1, "tariffPricePerUnit": "0.20" }
  ],
  "labor": [{ "name": "Cocinero", "activeMinutes": 20, "costPerHour": "16" }],
  "channel": { "name": "Sala", "pvp": "12", "pvpIncludesTax": true, "taxRate": "0.10" }
}
```

Códigos de `missing_inputs`: `PORTIONS_INVALID`, `INVALID_QUANTITY`, `INVALID_YIELD`, `INGREDIENT_PRICE_MISSING`, `UNIT_CONVERSION_DENSITY_MISSING`, `UNIT_CONVERSION_UNIT_WEIGHT_MISSING`, `UNIT_CONVERSION_UNIT_VOLUME_MISSING`, `ENERGY_TARIFF_MISSING`, `ENERGY_POWER_MISSING`, `ENERGY_NON_ELECTRIC_REQUIRES_MEASURED`, `INVALID_SHARE`, `LABOR_COST_MISSING`, `CONSUMABLE_AMOUNT_MISSING`, `OVERHEADS_NOT_CONFIGURED`, `SALE_PRICE_MISSING`, `SALE_TAX_MISSING`, `PORTIONS_PER_ORDER_INVALID`.
