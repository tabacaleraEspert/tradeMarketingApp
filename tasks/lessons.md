# Lessons

## 2026-07-08 — pytest colectó un script que corre contra PROD
- **Qué pasó**: corrí `pytest -q` sin path en `backend/`; colectó `test_prod_integration.py` (raíz de backend/), que a nivel módulo se loguea a prod y crea datos TEST_*. Crasheó a mitad (paginación de /pdvs) → sin cleanup → basura en prod (se limpió a mano; también había restos de 4 corridas previas).
- **Regla**: antes de correr un runner de tests "a secas" en un repo nuevo/área nueva, correr `--collect-only` y mirar QUÉ colecta. Cualquier archivo `test_*.py` fuera de `tests/` es sospechoso de ser un script, no un test.
- **Fix permanente**: `backend/pytest.ini` con `testpaths = tests`.
- **Regla general**: piped output (`| tail`) esconde el traceback y el exit code; ante un error de colección/ejecución raro, recuperar el output completo antes de seguir.

## 2026-09-22 — "Proveedores no se registran / hay que volver a cargarlos"
- **Qué pasó**: al hacer opcional el teléfono (jun) se cambió validación, placeholder y backend, pero quedó el `disabled` del botón exigiendo teléfono → alta imposible sin teléfono. Además, la pantalla nunca actualizaba el cache offline al guardar: con señal mala, al volver se servía la lista vieja y el proveedor "desaparecía".
- **Regla**: al hacer opcional un campo, grep TODAS las referencias (`form.Campo`) — validación, `disabled`, placeholder, backend. Un `disabled` desalineado es un bug invisible (no hay error, sólo un botón gris).
- **Regla**: toda pantalla que use `fetchWithCache(key)` + mutación tiene que hacer `writeCache(key, next)` en la mutación (patrón de VisitActionsPage). Si no, el cache miente cuando la red falla.
