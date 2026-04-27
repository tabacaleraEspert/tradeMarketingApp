# Changelog

Todas las modificaciones relevantes al proyecto se documentan en este archivo.

---

## [Unreleased] - 2026-04-23

### Categorización de Puntos de Venta (doc v1.0)

#### Tipos de PDV (canales y subcanales)

**Backend**
- Agregado campo `Description` (String 300, nullable) a los modelos `Channel` y `SubChannel`.
- Schemas de create/update/response actualizados para exponer `Description`.
- Endpoints `POST /channels`, `PATCH /channels/:id`, `POST /subchannels`, `PATCH /subchannels/:id` aceptan y persisten descripción.
- Migración `0007_channel_description`: agrega columna `Description` a tablas `Channel` y `SubChannel`.
- Seed data actualizado con las 5 categorías del documento oficial:
  - **Convenience** — Quiosco, Quiosco ventana, Maxiquiosco
  - **Grocery** — Almacén / Despensa, Autoservicio / Supermercado independiente
  - **Especializado** — Tabaquería, Growshop
  - **Estación de Servicio** — Independiente, De bandera
  - **Cadenas de Proximidad** — Chica (<10 PDVs), Mediana (11-30), Grande (>30)
- Cada canal y subcanal incluye la descripción textual del PDF como dato semilla.

**Frontend**
- Tipo `Channel` y `SubChannel` actualizado con `Description: string | null`.
- API services `channelsApi` y `subchannelsApi` aceptan `Description` en create/update.
- **Alta de PDV (`NewPointOfSale`)**: al seleccionar canal o subcanal se muestra un icono de info con tooltip y un texto descriptivo debajo del selector.
- **Admin de canales (`ChannelManagement`)**: campo textarea de descripción en modales de crear/editar canal y subcanal; descripción visible en el listado.

#### Categorización por volumen de venta

**Backend**
- Nuevo campo `MonthlyVolume` (Integer, nullable) en el modelo `PDV` para registrar atados de cigarrillos estimados por mes.
- Campo `Category` ampliado de `String(1)` a `String(10)` para almacenar "Chico" / "Mediano" / "Grande".
- Función `volume_to_category()` deriva automáticamente la categoría:
  - **Chico**: 0 – 800 atados/mes
  - **Mediano**: 801 – 1.500 atados/mes
  - **Grande**: > 1.500 atados/mes
- `POST /pdvs` y `PATCH /pdvs/:id` aceptan `MonthlyVolume`; `Category` se calcula automáticamente al crear o actualizar.
- Respuestas de la API incluyen `MonthlyVolume` y `Category`.
- Migración `0008_pdv_volume_category`: agrega `MonthlyVolume`, amplía `Category`.

**Frontend**
- Tipo `Pdv` actualizado con `MonthlyVolume: number | null` y `Category: string | null`.
- **Alta de PDV (`NewPointOfSale`)**: input numérico de volumen con tooltip explicativo y badge que muestra en tiempo real la categoría resultante (Chico/Mediano/Grande).
- **Detalle de PDV (`PointOfSaleDetail`)**: sección de volumen con badge coloreado (verde = Grande, ámbar = Mediano, gris = Chico).
- **Modal de edición de PDV**: input de volumen con preview de categoría.

#### Tests

- `TestVolumeCategory` (9 tests): create Chico/Mediano/Grande, boundaries (0, 800, 1500, 1501), null, update recalcula categoría.
- `TestChannelDescription` (5 tests): create/update channel y subchannel con y sin descripción.
- `test_crud.py`: test adicional para channel con descripción.
- Total: **188 tests passing**.

### Paso a Paso del TNR (doc v1.5) — Pasos 9, 10, 11

#### Catálogo de productos (master data)

**Backend**
- Nuevo modelo `Product` con campos: `Name`, `Category`, `Manufacturer`, `IsOwn`, `IsActive`, `SortOrder`.
- Categorías de producto: Cigarrillos, Tabacos, Vapers, Pouches de nicotina, Papelillos, Accesorios.
- Endpoints CRUD: `GET /products` (filtro por categoría, activos), `GET /products/:id`, `POST`, `PATCH`, `DELETE` (soft delete).
- Seed con **54 productos** del catálogo completo del PDF (todas las tabacaleras: Espert, Real Tabacalera, Massalin, BAT, Tabacalera Sarandí, Todo Tabaco, etc.).

#### Paso 9 — Categorías trabajadas en el PDV

**Backend**
- Nuevo modelo `PdvProductCategory`: registra qué categorías de producto trabaja cada PDV.
- 6 categorías válidas: Cigarrillos, Tabacos, Vapers, Pouches de nicotina, Papelillos, Accesorios.
- 4 estados: `trabaja`, `no_trabaja`, `trabajaba`, `dejo_de_trabajar`.
- Endpoints: `GET /pdvs/:id/product-categories`, `PUT` (bulk upsert), `PATCH /:categoryId`.

#### Paso 10 — Formulario de cobertura y precios

**Backend**
- Nuevo modelo `VisitCoverage`: registra por visita y por producto si lo trabaja, precio, disponibilidad.
- Endpoint `PUT /visits/:id/coverage` (bulk save, reemplaza datos anteriores).
- Endpoint `GET /visits/:id/coverage/diff` — compara automáticamente con la visita anterior al mismo PDV (pre-carga + detección de cambios de precio/disponibilidad).
- Precio y disponibilidad se limpian automáticamente si `Works=false`.

#### Paso 11 — Censo de materiales POP

**Backend**
- Nuevo modelo `VisitPOPItem`: tipos primario y secundario con empresa, presencia, y si tiene precio.
- Materiales primarios: Cigarrera aérea, Cigarrera de espalda, Pantalla/Display, Otro.
- Materiales secundarios: Móvil/Colgante, Stopper, Escalerita, Exhibidor, Afiche, Otro.
- Endpoint `PUT /visits/:id/pop` (bulk save), `GET /visits/:id/pop`.

#### Migración y seed

- Migración `0009_products_coverage_pop`: crea tablas `Product`, `PdvProductCategory`, `VisitCoverage`, `VisitPOPItem` con índices.
- Seed actualizado con 54 productos del catálogo oficial.

#### Tests

- `TestProducts` (7 tests): CRUD, filtro por categoría, soft delete, get by id.
- `TestPdvProductCategories` (6 tests): bulk upsert, update existing, list, update single, validaciones de categoría y status inválidos.
- `TestVisitCoverage` (6 tests): bulk save, replace, list, auto-clear price, closed visit rejection, diff con visita anterior.
- `TestVisitPOP` (6 tests): bulk save, replace, list, invalid type rejection, closed visit rejection, all fields check.
- Total: **213 tests passing**.

### Paso a Paso del TNR (doc v1.5) — Pasos 12, 14, 16, 18

#### Paso 12 — Relevamiento de venta de sueltos

**Backend**
- Nuevo modelo `VisitLooseSurvey`: registra si el PDV vende sueltos, productos (JSON, máx 3) y datos del programa de canje Espert (capsulado/no capsulado, modalidad, tipo negociación).
- Endpoints: `GET /visits/:id/loose-survey`, `PUT` (create or replace).
- Si `SellsLoose=false`, se limpian automáticamente `ProductsJson` y `ExchangeJson`.
- Migración `0010_visit_loose_survey`.

#### Paso 14 — Acciones de ejecución

**Backend** (usa `VisitAction` existente con `DetailsJson` tipado por ActionType)
- **14a Canje de sueltos** (`canje_sueltos`): DetailsJson con modalidad (5+1/10+1), tipo negociación, vacíos por marca, llenos a entregar, marca entregada.
- **14b Colocación POP** (`pop`): tipo material, ubicación.
- **14c Activación de promociones** (`promo`): DetailsJson con promoType (prueba_producto/rotacion/volumen/promo_cobertura), producto, regalo, cantidad.
- **14d Juegos lúdicos** (`juego_ludico`): DetailsJson con gameType (ruleta/raspadita/otro), premio, condiciones.
- **14e Otras acciones** (`otra`): descripción libre.
- Todas las acciones soportan `PhotoRequired` / `PhotoTaken` y status `PENDING` → `DONE` → `BACKLOG`.

#### Paso 16 — Indicadores de visita

**Backend**
- Nuevo endpoint `GET /visits/:id/indicators` devuelve:
  - `effective` (bool): verdadero si ≥1 acción de ejecución completada Y cobertura completada.
  - `completeness` (float 0-1): porcentaje de pasos completados (6 pasos totales).
  - `steps[]`: lista de pasos con `name`, `label`, `done`, `mandatory`.
  - `missing_for_close[]`: lista legible de pasos obligatorios faltantes.
- 6 pasos tracked: distributor (obligatorio), coverage (obligatorio), pop (obligatorio), loose, actions, news.

#### Paso 18 — Checkout con validación mejorada

**Backend**
- Endpoint `POST /visits/:id/validate-close` mejorado con validaciones de pasos obligatorios:
  - Paso 6: Proveedor de cigarrillos asignado al PDV.
  - Paso 10: Cobertura y precios completada (≥1 item).
  - Paso 11: Censo POP completado (≥1 item).
- Se suman a las validaciones existentes (preguntas obligatorias de formularios + fotos de acciones).

#### Tests

- `TestLooseSurvey` (7 tests): save, not-selling clears, get, nonexistent, update replaces, closed visit, exchange JSON.
- `TestVisitActions` (5 tests): canje, promo, juego lúdico, otra acción, mark done.
- `TestVisitIndicators` (5 tests): empty visit, effective with coverage+action, completeness increases, missing mandatory, step structure.
- `TestValidateClose` (3 tests): missing coverage, missing POP, passes with all mandatory.
- Total: **233 tests passing**.

### Frontend — Flujo de visita completo

#### Nuevo flujo de navegación

```
CheckIn → Survey → Coverage → POP → Actions → Photos → Summary
```

Se agregan dos nuevas páginas al flujo de visita entre Survey y Actions.

#### CoverageFormPage (`/pos/:id/coverage`) — Paso 10

- Lista completa de 54 productos agrupados por categoría (Cigarrillos, Tabacos, Vapers, etc.)
- Switch de "Lo trabaja" por producto con animación
- Input de precio con símbolo `$` integrado
- Selector de disponibilidad: "Disponible" (verde) / "Quiebre" (rojo)
- **Pre-carga**: valores de la visita anterior via endpoint `/diff`
- **Detección de cambios de precio**: flecha verde/roja + precio anterior
- Borde dorado izquierdo para productos Espert propios
- Badge "ESPERT" en productos propios
- Filtro por categoría con pills scrolleables estilo gold
- Búsqueda por nombre o tabacalera
- Barra inferior fija: conteo de productos, quiebres, botón gold "Guardar y continuar"
- Diseño mobile-first con cards colapsables

#### POPCensusPage (`/pos/:id/pop`) — Paso 11

- Materiales primarios (4) y secundarios (6) pre-cargados
- Switch de "Presente en PDV" por material
- Al activar: selector de empresa (Espert/Massalin/BAT/TABSA/Otra) con pills gold
- Selector "Con precio" / "Sin precio"
- Borde verde izquierdo para materiales presentes
- Conteo de presentes por tipo en header
- Secciones separadas con heading + badge de conteo

#### VisitIndicatorsBar (componente reutilizable) — Paso 16

- Barra colapsable que muestra:
  - **Visita Efectiva / No Efectiva** con icono y color (verde/ámbar)
  - **Barra de completitud** con porcentaje
  - Al expandir: lista de 6 pasos con estado (check verde / X rojo)
  - Pasos obligatorios marcados con badge "Obligatorio"
  - Mensaje de qué falta para cerrar
- Se integra en el `VisitSummaryPage` antes de los pasos

#### Navegación actualizada

- `SurveyForm` → ahora navega a `/coverage` (antes iba directo a `/actions`)
- `CoverageFormPage` → navega a `/pop`
- `POPCensusPage` → navega a `/actions`
- `VisitActionsPage` → back button va a `/pop` (antes iba a `/survey`)
- Rutas registradas en `routes.tsx`

#### API Layer

- Nuevos services: `productsApi`, `pdvProductCategoriesApi`, `visitCoverageApi`, `visitPOPApi`, `visitLooseApi`, `visitIndicatorsApi`
- Nuevos types: `Product`, `PdvProductCategory`, `VisitCoverageItem`, `CoverageDiff`, `VisitPOPItem`, `VisitLooseSurvey`, `StepStatus`, `VisitIndicators`
