# Known Issues — Trade Marketing App

> **Fecha:** 2026-04-14
> **Contexto:** Piloto con 6 usuarios, lanzamiento target 28 mayo 2026
> **Criterio:** Estos issues NO bloquean el piloto. Están documentados para resolver post-lanzamiento.

---

## UX / Funcionalidad

### 1. Calendario con más info
- **Dónde:** Home → selector de fecha
- **Qué falta:** El calendario actual es básico. Se pidió uno que muestre más info (visitas del día, indicadores de actividad).
- **Impacto:** Cosmético. El calendario funciona.

### 2. Flujo de alertas (resolución)
- **Dónde:** Home → "X alertas activas"
- **Qué falta:** No hay flujo para que el admin o el TM marquen una alerta como resuelta. Las alertas son de lectura.
- **Impacto:** Bajo para piloto — las alertas se ven pero no se accionan.

### 3. Frecuencia genera días automáticamente
- **Dónde:** Admin → Rutas → Frecuencia
- **Qué falta:** La frecuencia (diaria, semanal, etc.) se configura pero NO genera automáticamente los RouteDays. El admin tiene que crearlos manualmente.
- **Impacto:** Medio — el admin tiene que planificar a mano. Funciona pero es tedioso.

### 4. Cambiar TM de ruta → días no se actualizan
- **Dónde:** Admin → Editar Ruta → cambiar AssignedUserId
- **Qué falta:** Si cambio el TM Rep asignado a una ruta, los RouteDays existentes siguen apuntando al TM anterior. Hay que borrarlos y recrearlos manualmente.
- **Impacto:** Bajo — rara vez se cambia un TM de ruta.

### 5. Cadenas / Sucursales
- **Feedback:** Poder diferenciar kioscos cadena de individuales, geolocalizar sucursales, agrupar por razón social.
- **Qué falta:** Modelo `ParentPdvId` o `PdvChain`. No implementado.
- **Impacto:** Feature nueva completa. 1-2 semanas.

### 6. Módulo de productos / SKUs
- **Feedback:** Avance de cobertura de mix por PDV, última compra de SKU, qué SKU buscar incorporar.
- **Qué falta:** Módulo completo de catálogo de productos + tracking de compras por PDV.
- **Impacto:** Feature nueva mayor. 2-3 semanas.

### 7. Geografía e0-e4 (jerarquía geográfica)
- **Feedback:** Definición de zona en niveles jerárquicos (e0 país, e1 región, etc.)
- **Qué falta:** Modelo de zonas jerárquicas. Hoy las zonas son planas.
- **Impacto:** Refactor estructural. 1 semana.

### 8. Reportes de evolución de zonas para Ejecutivo
- **Feedback:** El ejecutivo ve cuantitativamente cómo evolucionan sus zonas.
- **Qué falta:** Dashboards comparativos mes a mes por zona. Los datos existen, falta la visualización.
- **Impacto:** Feature nueva medio. 1 semana.

### 9. Objetivo Foco guiado por eventos anuales
- **Feedback:** Eventos anuales que guían los objetivos de cada visita (campañas, lanzamientos, etc.)
- **Qué falta:** Modelo de eventos + vinculación con rutas/visitas. No implementado.
- **Impacto:** Feature nueva. 1-2 semanas.

### 10. Stock de materiales
- **Feedback:** Entrega de unidades al TM Rep → trackear en qué PDV las usa → reposición con trazabilidad.
- **Qué falta:** Módulo completo de stock + movimientos + integración con acciones.
- **Impacto:** Feature nueva mayor. 2-3 semanas.

---

## Técnicos

### 11. Google Maps API key
- El mapa en "Buscar PDV" puede no cargar si la API key tiene restricciones de dominio o las APIs no están habilitadas.
- **Fix:** Verificar en Google Cloud Console que Maps JavaScript API y Places API están activas, y que el referer permite localhost/ngrok/dominio de prod.

### 12. Bundle size
- El bundle de JS es ~1.8 MB. Primera carga lenta en 3G.
- **Fix futuro:** Code splitting con `React.lazy()` por ruta + manualChunks en Vite.

### 13. Offline: visita offline + cerrar browser
- Si el usuario hace una visita offline, cierra el browser, y lo reabre horas después, las operaciones dependientes podrían fallar si el token JWT expiró.
- **Mitigación actual:** `visitIdMap` persistido en IndexedDB + "Reintentar todo" resetea los intentos.
- **Fix futuro:** El sync worker podría refreshear el token antes de reintentar.

### 14. Tests automatizados
- No hay unit tests ni e2e tests.
- **Fix futuro:** Agregar Vitest para unit + Playwright para e2e en los flujos críticos.

### 15. CI/CD
- Deploy es manual. No hay pipeline automatizado.
- **Fix futuro:** GitHub Actions con build + test + deploy a Azure.

---

## Feedback del cliente pendiente (Tier 3)

Estos ítems fueron explícitamente acordados como **post-piloto** con el usuario:

1. Evolución cuantitativa de zonas (#1)
2. Geografía e0-e4 (#7)
3. Zona con cobertura/proveedor/conocimiento (#8)
4. Mix de SKUs/productos (#6)
5. Objetivo Foco por eventos (#9)
6. Stock de materiales (#10)
7. Cadenas/sucursales (#5)

---

*Este documento se actualiza durante el QA y post-deploy. Cada issue resuelto se mueve a la sección "Resueltos" al final.*

## Resueltos

| Fecha | Issue | Cómo |
|---|---|---|
| | | |
