# Spec: Proveedor con vendedores (fase 1) — contrato backend ↔ frontend

Decisiones: proveedor **por zona**; vendedor = nombre obligatorio + teléfono opcional; PDV se vincula a proveedor (principal) + vendedor (opcional); tipo y productos son **del proveedor**; editar/unificar/borrar proveedores = **solo admin**; "Espert" permitido. `Distributor` NO se toca en esta fase.

## Modelos (SQLAlchemy + migración alembic `0026_supplier_sellers`, down_revision `0025_route_campaign`)

`Supplier`
- SupplierId PK autoinc · ZoneId FK Zone nullable index · Name String(120) not null · SupplierTypeId FK SupplierType nullable · Products String(500) nullable (JSON array, igual que PdvSupplier) · IsActive bool default True · CreatedByUserId FK User nullable · CreatedAt / UpdatedAt (server_default now).

`SupplierSeller`
- SupplierSellerId PK · SupplierId FK Supplier ondelete CASCADE not null index · Name String(120) not null · Phone String(40) nullable · IsActive bool default True · CreatedAt.

`PdvSupplier` (existente = vínculo PDV↔proveedor): agregar `SupplierId` FK Supplier nullable index y `SupplierSellerId` FK SupplierSeller nullable. NO alterar columnas existentes (prod no está trackeado por alembic; DDL se aplica a mano). Al vincular, rellenar las columnas legacy: Name = nombre proveedor, Phone = teléfono del vendedor o "" , ZoneId = zona del proveedor, SupplierTypeId/Products = los del proveedor.

Normalización de nombre (helper compartido backend, `app/services/supplier_names.py`): `normalize_name(s)` = minúsculas, sin tildes, colapsar espacios, trim. Usado para evitar duplicados (mismo proveedor en la zona / mismo vendedor dentro del proveedor).

## API

Esquema de salida `SupplierOut`:
```
{ SupplierId, ZoneId, ZoneName, Name, SupplierTypeId, SupplierTypeName, Products: string[] | null,
  IsActive, PdvCount, Sellers: [{ SupplierSellerId, Name, Phone | null, IsActive }] }
```
(Sellers solo activos salvo `include_inactive=true` para admin.)

Router nuevo `app/routers/suppliers.py`, prefijo `/suppliers`:
- `GET /suppliers?zone_id=&q=&include_inactive=` → `SupplierOut[]` ordenado por Name. No-admin: SIEMPRE filtrado a su ZoneId (si no tiene zona → lista vacía) y solo activos. Admin: todos, filtro opcional zone_id. `q` filtra por nombre de proveedor o de vendedor o teléfono (contains, case-insensitive). Sin límite (zona grande ~100 proveedores).
- `POST /suppliers` (admin) body `{ZoneId, Name, SupplierTypeId?, Products?}` → SupplierOut. 409 si ya existe activo con mismo nombre normalizado en la zona.
- `PATCH /suppliers/{id}` (admin) `{Name?, ZoneId?, SupplierTypeId?, Products?, IsActive?}` → SupplierOut; propaga Name/SupplierTypeId/Products/ZoneId a las filas PdvSupplier vinculadas (columnas legacy).
- `POST /suppliers/{id}/sellers` (cualquier usuario autenticado; no-admin solo si el proveedor es de su zona) `{Name, Phone?}` → SupplierOut. Si ya existe vendedor activo con mismo nombre normalizado, lo reusa (y completa Phone si estaba vacío).
- `PATCH /suppliers/{id}/sellers/{seller_id}` (admin) `{Name?, Phone?, IsActive?}` → SupplierOut.
- `POST /suppliers/{id}/merge` (admin) `{SourceSupplierIds: int[]}` → SupplierOut del destino. Mueve vendedores (dedup por nombre normalizado; si colisiona, conserva el del destino y re-apunta vínculos), re-apunta PdvSupplier.SupplierId (si el PDV ya tenía el destino, desactiva la fila duplicada), desactiva los origen. Todo en una transacción.

Vínculo PDV (router existente `pdv_suppliers.py`, prefijo `/pdvs/{pdv_id}/suppliers`):
- NUEVO `POST /pdvs/{pdv_id}/suppliers/link` body:
  ```
  { SupplierId?: int, NewSupplier?: {Name, SupplierTypeId?, Products?},
    SupplierSellerId?: int, NewSeller?: {Name, Phone?} }
  ```
  Exactamente uno de SupplierId / NewSupplier. Vendedor opcional (a lo sumo uno de SupplierSellerId / NewSeller). Zona del proveedor nuevo = **zona del PDV** (fallback zona del usuario). Idempotente: NewSupplier con nombre normalizado ya existente activo en la zona → reusa; NewSeller igual dentro del proveedor; si el PDV ya tiene fila activa con ese SupplierId → actualiza vendedor en vez de duplicar. Respuesta: `PdvSupplier` extendido (ver abajo). Atómico (una transacción) — es lo que encola el modo offline.
- `GET /pdvs/{pdv_id}/suppliers` y `PATCH` / `DELETE` existentes se mantienen; la respuesta `PdvSupplier` suma: `SupplierId, SupplierSellerId, SellerName, SellerPhone` (y Name/SupplierTypeId/Products salen del Supplier si está vinculado).
- `GET /search-zone` se mantiene (compat con clientes viejos cacheados).

Auditoría: usar el mecanismo existente del repo (`AuditEvent`, ver cómo se audita ROUTE_CREATE en rutas) para SUPPLIER_CREATE / SUPPLIER_UPDATE / SUPPLIER_MERGE / SELLER_CREATE / SELLER_UPDATE / PDV_SUPPLIER_LINK con antes/después.

Agregaciones a migrar a SupplierId (fallback a la clave vieja teléfono/nombre si SupplierId es NULL):
- `app/services/intelligence.py` `build_suppliers` (~1056-1126) y perfil PDV (~1003-1010: sumar vendedor).
- `app/routers/reports.py` supplier-analytics (~1373-1436) topSuppliers.
- `app/routers/visits.py` detalle (~325-347): sumar SellerName/SellerPhone.

## Frontend

- `src/lib/api/types.ts`: `Supplier`, `SupplierSeller`; `PdvSupplier` + `SupplierId?, SupplierSellerId?, SellerName?, SellerPhone?`.
- `src/lib/api/services.ts`: `suppliersApi` (list, create, update, addSeller, updateSeller, merge) y `pdvSuppliersApi.link(pdvId, body)`.
- Censo `SupplierCensusPage.tsx` (flujo nuevo):
  1. Buscador "Proveedor" por nombre sobre los proveedores de la zona (cache `zone_suppliers_v2` para offline/PDV temporal). Lista completa filtrable, alto suficiente.
  2. Elegido el proveedor: chips/lista de sus vendedores + "Sin vendedor" + "+ Agregar vendedor" (Nombre obligatorio, Teléfono opcional).
  3. Si no existe: "+ Nuevo proveedor «texto»" → tipo + productos (como hoy) + vendedor opcional.
  4. Guardar → `executeOrEnqueue` kind nuevo `pdv_supplier_link` → POST link (soporta `_tempPdvId` como hoy). Mostrar optimista.
  5. La lista "Proveedores registrados" del PDV muestra "Proveedor · Vendedor (tel)".
  Teléfono ya NO es obligatorio en ningún lado.
- Offline: agregar kind `pdv_supplier_link` en `src/lib/offline/queue.ts` (y donde se mapean kinds → request/remap de pdv temporal, igual que `pdv_supplier_create`). `Home.tsx` prefetch: precargar `suppliersApi.list()` en `zone_suppliers_v2`.
- Admin: nueva página `/admin/suppliers` "Proveedores" (menú en AdminLayout junto a la config de proveedores existente): filtro por zona + buscador; tabla proveedor / tipo / #PDVs / vendedores; editar proveedor y vendedores; seleccionar 2+ y "Unificar" eligiendo el destino (confirmación). Seguir patrones visuales de las páginas admin existentes.
- Inteligencia `ProveedoresCard.tsx` y `VisitDataExplorer.tsx`: mostrar vendedor si viene.

## Desvíos backend

Contrato respetado (nombres de campos y endpoints). Precisiones / agregados:

- `POST /suppliers`: `ZoneId` opcional (null = proveedor sin zona). `PATCH /suppliers/{id}` y `PATCH .../sellers/{id}` devuelven `Sellers` **incluyendo inactivos** (contexto admin); `POST .../sellers` y `merge` solo activos. 409 también al renombrar/mover/reactivar si choca con otro activo de la zona (y vendedor con otro activo del proveedor).
- `POST /pdvs/{pdv_id}/suppliers/link`:
  - 422 si no viene exactamente uno de SupplierId/NewSupplier o vienen SupplierSellerId y NewSeller juntos; 404 PDV / proveedor / vendedor que no es de ese proveedor; 409 si el proveedor está inactivo (p.ej. unificado mientras la cola offline esperaba); 403 no-admin con proveedor de zona distinta a la del PDV y a la suya.
  - Si el PDV ya tiene fila activa con ese SupplierId, el vendedor se **reemplaza por lo enviado** (sin vendedor → queda sin vendedor).
  - Si el PDV tiene una fila legacy (SupplierId NULL) con el mismo nombre normalizado, se **adopta** esa fila (se vincula) en vez de crear otra.
  - Respuesta 200 (no 201).
- `merge`: productos del destino = unión; tipo = el del destino o, si no tiene, el del origen. Destino inactivo → 409; origen inexistente → 404 (sin cambios). Ignora el propio destino si viene en SourceSupplierIds.
- Auditoría: tabla `AuditEvent` existente (como rutas), Entity = `Supplier` / `SupplierSeller` / `PdvSupplier`, Payload `{antes, despues}`.
- Campos extra en agregaciones (aditivos, no rompen):
  - Inteligencia `GET /intelligence/suppliers` items: `supplierId`, `vendedores: [{nombre, telefono}]` (agrupado por SupplierId; legacy sigue por teléfono/nombre; `telefono` = primero no vacío).
  - Inteligencia perfil PDV `proveedores[]`: `supplierId`, `vendedor`, `vendedorTelefono`.
  - `GET /reports/supplier-analytics` `topSuppliers[]`: `supplierId`, `sellers: string[]`.
  - Detalle de visita `suppliers[]`: `SupplierId`, `SellerName`, `SellerPhone`.
- Deploy: correr `backend/scripts/hotfix_supplier_sellers_prod_20261007.py` en prod **antes** del deploy backend (el modelo PdvSupplier hace SELECT de las columnas nuevas). Luego migración de datos con `backend/scripts/migrate_suppliers_sellers.py --propose` → revisión → `--apply` (backup JSON automático).
- Visibilidad cruzada: la zona del proveedor/vínculo = zona del PDV. `GET /pdvs/{id}/suppliers` (no-admin) muestra filas de su zona **o** de la zona del PDV. `GET /suppliers?pdv_id=` (no-admin) devuelve su zona ∪ la del PDV (sin `pdv_id`, solo su zona). El censo pasa `pdv_id` si el PDV es real y mergea con el cache `zone_suppliers_v2` (reemplaza las zonas cubiertas, conserva proveedores reales de otras zonas).
- `POST .../link` con `SupplierSellerId` inactivo o de otro proveedor → **409** (antes 404 para "de otro proveedor"). En la cola offline un 4xx queda con `lastError` visible (PendingSyncSheet / Sync) y tras 5 intentos pasa a "Operaciones Fallidas" (mecanismo existente, sin cambios).
- Aceptado: carrera en alta concurrente (`NewSupplier` con el mismo nombre en simultáneo) puede duplicar el proveedor (no hay unique por nombre normalizado); se corrige con "Unificar" del admin.
- `q` server-side de `GET /suppliers` es sensible a tildes en SQL Server (collation CI_AS); la UI filtra client-side con `normalizeName`.
- Nota preexistente: `alembic upgrade head` sobre SQLite vacío falla en 0002 (0001 hace create_all); 0026 se probó up/down sobre una DB en estado 0025 (stamp).
