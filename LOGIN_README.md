# Sistema de Login - Trade Marketing

## Cómo iniciar

### 1. Backend
```bash
cd backend
python3 run.py
```

**Importante:** El nuevo `run.py` importa la app directamente (no usa string). Debes **detener** cualquier servidor anterior (Ctrl+C) antes de iniciar.

### 2. Frontend
```bash
cd frontend
npm run dev
```

### 3. Probar login
- **Desde el navegador:** http://localhost:5173/login
- **Desde terminal:** `cd backend && ./test_login.sh`
- **Curl manual:**
  ```bash
  curl -X POST http://localhost:8000/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@test.com","password":"Admin123!"}'
  ```

### Credenciales de prueba
- Email: `admin@test.com`
- Contraseña: `Admin123!`

### Si sigue dando 404
1. Verifica que no haya otro proceso en el puerto 8000: `lsof -i :8000`
2. Mata procesos viejos: `pkill -f "uvicorn\|run.py"`
3. Limpia caché: `find backend/app -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null`
4. Reinicia: `cd backend && python3 run.py`
