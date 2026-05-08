# Arquitectura de Base de Datos — TM Espert

## Resumen

La base de datos tiene **46 tablas** organizadas en 7 dominios funcionales. La entidad central es **Visit**, que conecta puntos de venta (PDV), usuarios (User), planificacion de rutas (RouteDay) y de la cual derivan todos los datos del censo de campo.

| Dominio | Tablas | Principales |
|---------|--------|-------------|
| Usuarios y roles | 11 | User, Role, UserRole, Zone, Device, DeviceState, SyncLog, Notification, UserVacation, Holiday, AppSetting |
| Canales y productos | 4 | Channel, SubChannel, Product, Distributor |
| Puntos de venta | 8 | PDV, PdvDistributor, PdvContact, PdvNote, PdvPhoto, PdvProductCategory, PdvAssignment, PdvKpiSnapshot |
| Archivos | 1 | File |
| Formularios | 3 | Form, FormQuestion, FormOption |
| Rutas y planificacion | 6 | Route, RouteForm, RoutePdv, RouteDay, RouteDayPdv, MandatoryActivity |
| Visitas y censo | 13 | Visit, VisitCheck, VisitAnswer, VisitPhoto, VisitAction, VisitCoverage, VisitPOPItem, VisitLooseSurvey, VisitFormTime, MarketNews, Incident, AuditEvent |

---

## Diagrama ER

El diagrama completo en formato Mermaid se encuentra en [`er-diagram.md`](./er-diagram.md).

---

## Flujo principal de datos

```
User → Route → RouteDay → RouteDayPdv
                              ↓
                PDV ←──── Visit (OPEN → CLOSED)
                              ├── VisitCheck (GPS check-in/out)
                              ├── VisitAnswer (relevamiento/formularios)
                              ├── VisitCoverage (cobertura de productos)
                              ├── VisitPOPItem (censo material POP)
                              ├── VisitAction (acciones de ejecucion)
                              ├── VisitPhoto (fotos)
                              ├── VisitLooseSurvey (sueltos)
                              ├── VisitFormTime (tiempos por formulario)
                              ├── MarketNews (novedades de mercado)
                              └── Incident (incidentes)
```

1. Un **User** tiene asignadas **Routes** con frecuencia definida
2. Cada dia se generan **RouteDays** con los **RouteDayPdv** a visitar
3. El TMR hace check-in en el **PDV** y se crea una **Visit**
4. Durante la visita se registran todos los datos del censo
5. Al cerrar la visita, se marca como CLOSED y se avanza al siguiente PDV

---

## Jerarquia de rutas (planificacion vs ejecucion)

```
Route (template)
  ├── RoutePdv (PDVs en la ruta, orden de visita)
  ├── RouteForm (formularios asignados)
  └── RouteDay (instancia para una fecha)
        └── RouteDayPdv (copia de PDVs con orden y estado de ejecucion)
```

- **Route + RoutePdv** = la definicion de la ruta (que PDVs, en que orden)
- **RouteDay + RouteDayPdv** = la ejecucion del dia (que se visito, en que estado)
- Al crear un RouteDay, se copian los RoutePdv como RouteDayPdv con su PlannedOrder
- El TMR puede reordenar sobre la marcha sin afectar el template

---

## Relaciones clave

### PDV (Punto de Venta)
- Pertenece a una **Zone**, **Channel**, **SubChannel**
- Tiene multiples **PdvContacts** (contactos del local)
- Tiene multiples **PdvDistributors** (distribuidores que lo abastecen)
- Tiene **PdvProductCategories** (que categorias trabaja/no trabaja)
- Tiene **PdvNotes** (notas entre visitas, recordatorios)
- Tiene **PdvPhotos** (fotos de fachada)
- Puede estar en multiples **Routes** via RoutePdv

### Visit (Visita)
- Siempre asociada a un **PDV** y un **User**
- Opcionalmente asociada a un **RouteDay** (puede ser visita suelta)
- Contiene todo el trabajo de campo como entidades hijas
- Tiene **VisitChecks** para GPS de entrada/salida

### Form (Formularios dinamicos)
- **Form** → **FormQuestion** → **FormOption** (jerarquia de config)
- Las respuestas se guardan en **VisitAnswer** vinculadas a Visit + Question
- Soporta tipos: text, number, date, select, radio, checkbox, coverage, scale

---

## Evaluacion y observaciones

### Fortalezas

1. **Esquema bien normalizado** — Cada concepto tiene su tabla, no hay datos duplicados innecesariamente. Las junction tables (PdvDistributor, UserRole, RouteForm, RoutePdv) estan donde corresponde.

2. **Visit como hub central** — Todo dato de campo cuelga de Visit. Esto simplifica queries de reportes ("dame todo lo que paso en esta visita") y permite reconstruir la actividad completa del TMR.

3. **Separacion planificacion/ejecucion** — La jerarquia Route/RoutePdv (template) → RouteDay/RouteDayPdv (instancia) permite que el template se modifique sin afectar dias ya ejecutados, y viceversa.

4. **Auditoría y trazabilidad** — AuditEvent registra cambios, VisitCheck captura GPS con precision y distancia al PDV, VisitFormTime mide productividad por formulario.

5. **Formularios dinamicos** — La estructura Form/FormQuestion/FormOption permite crear y modificar formularios de relevamiento sin cambiar codigo ni schema.

### Campos legacy a limpiar

Hay campos viejos que conviven con los nuevos. No generan bugs pero agregan confusion:

| Tabla | Campo legacy | Reemplazo actual |
|-------|-------------|-----------------|
| PDV | `Channel` (string) | `ChannelId` (FK a Channel) |
| PDV | `ContactName`, `ContactPhone` | Tabla `PdvContact` |
| PDV | `DistributorId` (FK directo) | Tabla `PdvDistributor` (M2M) |
| PDV | `VisitDay` (int) | Route.FrequencyType + config |

**Recomendacion**: Planificar un migration que copie datos de campos legacy a las tablas nuevas (si no se hizo ya), verificar que ningun endpoint los use como fuente primaria, y luego dropearlos. No es urgente pero simplifica el schema a futuro.

### Columnas JSON

Varias tablas usan campos string con JSON adentro:

| Tabla | Campo | Contenido |
|-------|-------|-----------|
| VisitAction | DetailsJson | Datos especificos por tipo de accion (canje, promo, etc.) |
| PDV | TimeSlotsJson | Franjas horarias del local |
| PDV | AllowsJson | Feature flags del PDV |
| Route | FrequencyConfig | Config de frecuencia (dia, intervalo) |
| FormQuestion | RulesJson | Reglas de visibilidad/validacion |
| VisitLooseSurvey | ProductsJson, ExchangeJson | Productos sueltos y canjes |
| MandatoryActivity | DetailsJson | Template de datos por tipo |

**Ventajas**: Flexibilidad, no requiere migraciones para agregar campos nuevos.
**Desventajas**: No se pueden hacer queries SQL directos sobre el contenido. Si algun campo JSON se consulta frecuentemente en reportes, conviene normalizarlo a tabla propia.

**Recomendacion**: No cambiar ahora. Monitorear cuales se necesitan en reportes y normalizar caso por caso.

### PDV es una tabla ancha

La tabla PDV tiene ~25 columnas. Como es la entidad mas importante del negocio, se justifica. Pero si sigue creciendo, considerar mover campos poco usados a una tabla `PdvMetadata` o `PdvConfig` con formato key-value.

### Soft-delete inconsistente

- Algunas tablas usan `IsActive` (PDV, User, Product, Route, Channel)
- Otras usan `Status` (Incident, Visit, RouteDay)
- PdvNote usa `IsResolved`
- Varias tablas no tienen ningun mecanismo de soft-delete

No es un problema operativo hoy, pero si alguna vez se necesita un "papelera de reciclaje" o "deshacer", habria que estandarizar.

---

## Metricas del schema

| Metrica | Valor |
|---------|-------|
| Total tablas | 46 |
| Tablas con FK | 38 |
| Junction tables (M2M) | 7 (UserRole, PdvDistributor, PdvAssignment, RoutePdv, RouteDayPdv, RouteForm, PdvPhoto) |
| Campos JSON | 9 |
| Tablas con IsActive | 9 |
| Tablas con CreatedAt | 32 |
| Tablas con auditoría temporal | 32 |

---

*Documento generado el 2026-05-08*
