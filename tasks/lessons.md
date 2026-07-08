# Lessons

## 2026-07-08 — pytest colectó un script que corre contra PROD
- **Qué pasó**: corrí `pytest -q` sin path en `backend/`; colectó `test_prod_integration.py` (raíz de backend/), que a nivel módulo se loguea a prod y crea datos TEST_*. Crasheó a mitad (paginación de /pdvs) → sin cleanup → basura en prod (se limpió a mano; también había restos de 4 corridas previas).
- **Regla**: antes de correr un runner de tests "a secas" en un repo nuevo/área nueva, correr `--collect-only` y mirar QUÉ colecta. Cualquier archivo `test_*.py` fuera de `tests/` es sospechoso de ser un script, no un test.
- **Fix permanente**: `backend/pytest.ini` con `testpaths = tests`.
- **Regla general**: piped output (`| tail`) esconde el traceback y el exit code; ante un error de colección/ejecución raro, recuperar el output completo antes de seguir.
