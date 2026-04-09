"""
Inicia el servidor backend.
Usa import directo para garantizar que se carga el código correcto.
"""
import os
import sys

# Forzar directorio backend como raíz
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BACKEND_DIR)
sys.path.insert(0, BACKEND_DIR)

if __name__ == "__main__":
    import uvicorn
    from app.main import app

    port = int(os.environ.get("PORT", 8001))
    print(f"Iniciando servidor en http://localhost:{port}")
    print("Login: POST /auth/login")
    uvicorn.run(app, host="0.0.0.0", port=port)
