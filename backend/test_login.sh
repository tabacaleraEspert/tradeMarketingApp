#!/bin/bash
# Prueba el endpoint de login
echo "Probando POST /auth/login..."
curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"Admin123!"}' | python3 -m json.tool
echo ""
echo "Si ves datos del usuario, el login funciona."
