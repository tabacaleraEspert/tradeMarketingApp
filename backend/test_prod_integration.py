#!/usr/bin/env python3
"""
Tests integrales contra producción.
Crea datos de prueba con nombres únicos, verifica flujos, y limpia todo al final.

Uso:
    .venv/bin/python test_prod_integration.py
"""
import sys
import uuid
import requests

API = "https://espert-trade-api.azurewebsites.net"
UID = uuid.uuid4().hex[:6]  # Unique suffix to avoid collisions


# Login as admin to get fresh token
print("=== Login admin ===")
r = requests.post(f"{API}/auth/login", json={"email": "juampi@espert.com.ar", "password": "Espert2026!"})
assert r.status_code == 200, f"Login failed: {r.text}"
TOKEN = r.json()["access_token"]
ADMIN_ID = r.json()["UserId"]
H = {"Authorization": f"Bearer {TOKEN}"}
print("  PASS: login OK\n")

# Track created resources for cleanup
cleanup = []
passed = 0
failed = 0


def check(label, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS: {label}")
    else:
        failed += 1
        detail_str = f" — {detail[:120]}" if detail else ""
        print(f"  FAIL: {label}{detail_str}")


def api(method, path, **kwargs):
    return getattr(requests, method)(f"{API}{path}", headers=H, **kwargs)


def safe(r, key):
    """Safely extract a key from response, return None on error."""
    try:
        return r.json().get(key)
    except Exception:
        return None


# =====================================================================
# 1. ZONES
# =====================================================================
print("=== Test: Zonas ===")
r = api("post", "/zones", json={"Name": f"TEST_Zona_{UID}"})
check("Crear zona", r.status_code == 201, r.text)
zone_id = safe(r, "ZoneId")
if zone_id:
    cleanup.append(("delete", f"/zones/{zone_id}"))

    r = api("get", f"/zones/{zone_id}")
    check("Get zona", r.status_code == 200)

    r = api("patch", f"/zones/{zone_id}", json={"Name": f"TEST_Zona_R_{UID}"})
    check("Update zona", r.status_code == 200, r.text)

r = api("get", "/zones")
check("Listar zonas", r.status_code == 200 and isinstance(r.json(), list))
print()

# =====================================================================
# 2. DISTRIBUTORS
# =====================================================================
print("=== Test: Distribuidores ===")
r = api("post", "/distributors", json={"Name": f"TEST_Dist_{UID}"})
check("Crear distribuidor", r.status_code == 201, r.text)
dist_id = safe(r, "DistributorId")
if dist_id:
    cleanup.append(("delete", f"/distributors/{dist_id}"))
    r = api("patch", f"/distributors/{dist_id}", json={"Name": f"TEST_Dist_R_{UID}"})
    check("Update distribuidor", r.status_code == 200, r.text)
print()

# =====================================================================
# 3. CHANNELS + SUBCHANNELS
# =====================================================================
print("=== Test: Canales y Subcanales ===")
r = api("post", "/channels", json={"Name": f"TEST_Ch_{UID}", "Description": "Canal de test"})
check("Crear canal", r.status_code == 201, r.text)
ch_id = safe(r, "ChannelId")
if ch_id:
    cleanup.append(("delete", f"/channels/{ch_id}"))
    r = api("get", f"/channels/{ch_id}")
    check("Get canal", r.status_code == 200 and r.json().get("Description") == "Canal de test")

    r = api("post", "/subchannels", json={"ChannelId": ch_id, "Name": f"TEST_Sub_{UID}"})
    check("Crear subcanal", r.status_code == 201, r.text)
    sc_id = safe(r, "SubChannelId")
    if sc_id:
        cleanup.append(("delete", f"/subchannels/{sc_id}"))
        r = api("get", f"/subchannels?channel_id={ch_id}")
        check("Listar subcanales filtrado", r.status_code == 200 and len(r.json()) >= 1)
        r = api("patch", f"/subchannels/{sc_id}", json={"Name": f"TEST_Sub_R_{UID}"})
        check("Update subcanal", r.status_code == 200, r.text)
    else:
        sc_id = None
else:
    ch_id = 8  # Fallback to existing Kiosco channel
    sc_id = None
print()

# =====================================================================
# 4. USERS
# =====================================================================
print("=== Test: Usuarios ===")
user_email = f"test_{UID}@espert.com.ar"
r = api("post", "/users", json={
    "Email": user_email,
    "DisplayName": f"Test User {UID}",
    "Password": "TestPass123!",
    "ZoneId": zone_id,
})
check("Crear usuario", r.status_code == 201, r.text)
user_id = safe(r, "UserId")
if user_id:
    cleanup.append(("delete", f"/users/{user_id}"))
    r = api("get", f"/users/{user_id}")
    check("Get usuario", r.status_code == 200)
    r = api("patch", f"/users/{user_id}", json={"DisplayName": f"Test Renamed {UID}"})
    check("Update usuario", r.status_code == 200, r.text)

r = api("get", "/users")
check("Listar usuarios", r.status_code == 200 and isinstance(r.json(), list))

r = requests.post(f"{API}/auth/login", json={"email": user_email, "password": "TestPass123!"})
check("Login nuevo usuario", r.status_code == 200 and "access_token" in r.json(), r.text)
print()

# =====================================================================
# 5. PDV FULL LIFECYCLE
# =====================================================================
print("=== Test: PDV ciclo completo ===")
pdv_payload = {
    "Name": f"TEST_PDV_{UID}",
    "ChannelId": ch_id,
    "Address": "Av. Sáenz 1302",
    "City": "Buenos Aires",
    "ZoneId": zone_id,
    "Lat": -34.6505,
    "Lon": -58.3948,
    "OpeningTime": "08:00",
    "ClosingTime": "18:00",
    "VisitDay": 1,
    "MonthlyVolume": 500,
    "BusinessName": "Test Kiosco SRL",
    "Contacts": [
        {"ContactName": "Juan Test", "ContactPhone": "11-0000-0000", "ContactRole": "dueño"},
        {"ContactName": "Maria Test", "ContactRole": "empleado"},
    ],
}
if sc_id:
    pdv_payload["SubChannelId"] = sc_id
if dist_id:
    pdv_payload["DistributorIds"] = [dist_id]

r = api("post", "/pdvs", json=pdv_payload)
check("Crear PDV completo", r.status_code == 201, r.text)
pdv = r.json() if r.status_code == 201 else {}
pdv_id = pdv.get("PdvId")
if pdv_id:
    cleanup.append(("delete", f"/pdvs/{pdv_id}"))

check("PDV categoría Chico", pdv.get("Category") == "Chico")
check("PDV 2 contactos", len(pdv.get("Contacts", [])) == 2)
check("PDV código autogenerado", pdv.get("Code", "").startswith("PDV-"))

if pdv_id:
    # Update
    r = api("patch", f"/pdvs/{pdv_id}", json={
        "MonthlyVolume": 2000,
        "Address": "Av. Sáenz 987",
        "Contacts": [{"ContactName": "Pedro Nuevo", "ContactRole": "encargado"}],
        "DistributorIds": [],
    })
    check("Update PDV", r.status_code == 200, r.text)
    upd = r.json() if r.status_code == 200 else {}
    check("Categoría → Grande", upd.get("Category") == "Grande")
    check("Contactos reemplazados", len(upd.get("Contacts", [])) == 1)
    check("BusinessName intacto", upd.get("BusinessName") == "Test Kiosco SRL")

    # Deactivate → Reactivate
    r = api("patch", f"/pdvs/{pdv_id}", json={"IsActive": False, "InactiveReason": "Test baja"})
    check("Desactivar PDV", r.status_code == 200 and r.json().get("IsActive") is False)
    check("ReactivateOn auto", r.json().get("ReactivateOn") is not None)

    r = api("patch", f"/pdvs/{pdv_id}", json={"IsActive": True})
    check("Reactivar PDV", r.status_code == 200 and r.json().get("IsActive") is True)
    check("Campos inactivo limpiados", r.json().get("InactiveReason") is None and r.json().get("ReactivateOn") is None)

    # Duplicate
    r = api("post", "/pdvs", json={"Name": f"TEST_PDV_{UID}", "ChannelId": ch_id, "ZoneId": zone_id})
    check("Duplicado rechazado (409)", r.status_code == 409)

    r = api("get", f"/pdvs?zone_id={zone_id}")
    check("Listar PDVs por zona", r.status_code == 200 and any(p["PdvId"] == pdv_id for p in r.json()))
print()

# =====================================================================
# 6. FORMS + QUESTIONS + OPTIONS
# =====================================================================
print("=== Test: Formularios ===")
r = api("post", "/forms", json={"Name": f"TEST_Form_{UID}", "Version": 1})
check("Crear formulario", r.status_code == 201, r.text)
form_id = safe(r, "FormId")
if form_id:
    cleanup.append(("delete", f"/forms/{form_id}"))

    r = api("post", f"/forms/{form_id}/questions", json={
        "Label": "¿Tiene exhibidor?",
        "KeyName": f"exhibidor_{UID}",
        "QType": "boolean",
        "SortOrder": 1,
        "IsRequired": True,
    })
    check("Crear pregunta boolean", r.status_code == 201, r.text)
    q1_id = safe(r, "QuestionId")

    r = api("post", f"/forms/{form_id}/questions", json={
        "Label": "¿Qué marca vende más?",
        "KeyName": f"marca_{UID}",
        "QType": "single_choice",
        "SortOrder": 2,
        "IsRequired": False,
    })
    check("Crear pregunta single_choice", r.status_code == 201, r.text)
    q2_id = safe(r, "QuestionId")

    if q2_id:
        r = api("post", f"/forms/questions/{q2_id}/options", json={"QuestionId": q2_id, "Label": "Marca A", "Value": "marca_a", "SortOrder": 1})
        check("Crear opción 1", r.status_code == 201, r.text)
        r = api("post", f"/forms/questions/{q2_id}/options", json={"QuestionId": q2_id, "Label": "Marca B", "Value": "marca_b", "SortOrder": 2})
        check("Crear opción 2", r.status_code == 201, r.text)
        r = api("get", f"/forms/questions/{q2_id}/options")
        check("Listar opciones", r.status_code == 200 and len(r.json()) == 2)

    r = api("get", f"/forms/{form_id}/questions")
    check("Listar preguntas", r.status_code == 200 and len(r.json()) == 2, r.text)

    if q1_id:
        r = api("patch", f"/forms/questions/{q1_id}", json={"Label": "¿Tiene exhibidor actualizado?"})
        check("Update pregunta", r.status_code == 200, r.text)

    r = api("patch", f"/forms/{form_id}", json={"Name": f"TEST_Form_R_{UID}"})
    check("Update formulario", r.status_code == 200, r.text)
print()

# =====================================================================
# 7. ROUTES + ROUTE DAYS
# =====================================================================
print("=== Test: Rutas ===")
route_payload = {
    "Name": f"TEST_Ruta_{UID}",
    "FrequencyType": "weekly",
}
if zone_id:
    route_payload["ZoneId"] = zone_id
if user_id:
    route_payload["AssignedUserId"] = user_id

r = api("post", "/routes", json=route_payload)
check("Crear ruta", r.status_code == 201, r.text)
route_id = safe(r, "RouteId")
if route_id:
    cleanup.append(("delete", f"/routes/{route_id}"))
    r = api("get", f"/routes/{route_id}")
    check("Get ruta", r.status_code == 200)
    r = api("patch", f"/routes/{route_id}", json={"Name": f"TEST_Ruta_R_{UID}"})
    check("Update ruta", r.status_code == 200, r.text)

    if form_id:
        r = api("post", f"/routes/{route_id}/forms", json={"FormId": form_id, "SortOrder": 1})
        check("Asociar form a ruta", r.status_code in (200, 201), r.text)
        r = api("get", f"/routes/{route_id}/forms")
        check("Listar forms de ruta", r.status_code == 200 and len(r.json()) >= 1)

    # Route day
    day_payload = {"WorkDate": "2026-04-28"}
    if user_id:
        day_payload["AssignedUserId"] = user_id
    r = api("post", f"/routes/{route_id}/days", json=day_payload)
    check("Crear route day", r.status_code == 201, r.text)
    day_id = safe(r, "RouteDayId")

    if day_id:
        r = api("get", f"/routes/{route_id}/days")
        check("Listar route days", r.status_code == 200 and len(r.json()) >= 1)

        if pdv_id:
            r = api("post", f"/routes/days/{day_id}/pdvs", json={
                "RouteDayId": day_id,
                "PdvId": pdv_id,
                "PlannedOrder": 1,
            })
            check("Agregar PDV a route day", r.status_code in (200, 201), r.text)
            r = api("get", f"/routes/days/{day_id}/pdvs")
            check("Listar PDVs del día", r.status_code == 200 and len(r.json()) >= 1)
else:
    day_id = None
print()

# =====================================================================
# 8. VISITS
# =====================================================================
print("=== Test: Visitas ===")
visit_id = None
if pdv_id and user_id:
    visit_payload = {"PdvId": pdv_id, "UserId": user_id}
    if day_id:
        visit_payload["RouteDayId"] = day_id
    r = api("post", "/visits", json=visit_payload)
    check("Crear visita", r.status_code == 201, r.text)
    visit_id = safe(r, "VisitId")
    if visit_id:
        cleanup.append(("delete", f"/visits/{visit_id}"))
        r = api("get", f"/visits/{visit_id}")
        check("Get visita", r.status_code == 200 and r.json().get("PdvId") == pdv_id)
        r = api("patch", f"/visits/{visit_id}", json={"Notes": "Test notes"})
        check("Update visita", r.status_code == 200, r.text)

        r = api("post", f"/visits/{visit_id}/actions", json={
            "ActionType": "reposition",
            "Description": "Reposición test",
        })
        check("Crear acción de visita", r.status_code == 201, r.text)

        r = api("post", f"/visits/{visit_id}/market-news", json={
            "Tags": "competencia",
            "Notes": "Competidor lanzó promo 2x1",
        })
        check("Crear market news", r.status_code == 201, r.text)

r = api("get", "/visits")
check("Listar visitas", r.status_code == 200 and isinstance(r.json(), list))
print()

# =====================================================================
# 9. INCIDENTS
# =====================================================================
print("=== Test: Incidentes ===")
if pdv_id:
    r = api("post", "/incidents", json={
        "PdvId": pdv_id,
        "Type": "exhibidor",
        "Notes": "TEST - Exhibidor roto",
        "Priority": 1,
    })
    check("Crear incidente", r.status_code == 201, r.text)
    inc_id = safe(r, "IncidentId")
    if inc_id:
        cleanup.append(("delete", f"/incidents/{inc_id}"))
        r = api("patch", f"/incidents/{inc_id}", json={"Status": "en_proceso"})
        check("Update incidente", r.status_code == 200, r.text)

r = api("get", "/incidents")
check("Listar incidentes", r.status_code == 200 and isinstance(r.json(), list))
print()

# =====================================================================
# 10. NOTIFICATIONS
# =====================================================================
print("=== Test: Notificaciones ===")
notif_target = user_id or ADMIN_ID
r = api("post", "/notifications", json={
    "UserId": notif_target,
    "Title": f"TEST_Notif_{UID}",
    "Message": "Contenido de test",
    "Type": "info",
})
check("Crear notificación", r.status_code == 201, r.text)
notif_id = safe(r, "NotificationId")
if notif_id:
    cleanup.append(("delete", f"/notifications/{notif_id}"))
r = api("get", f"/notifications?user_id={notif_target}")
check("Listar notificaciones", r.status_code == 200)
print()

# =====================================================================
# 11. PRODUCTS
# =====================================================================
print("=== Test: Productos ===")
r = api("post", "/products", json={
    "Name": f"TEST_Prod_{UID}",
    "Category": "cigarrillos",
    "Manufacturer": "Test Mfr",
    "IsOwn": True,
})
check("Crear producto", r.status_code == 201, r.text)
prod_id = safe(r, "ProductId")
if prod_id:
    cleanup.append(("delete", f"/products/{prod_id}"))
    r = api("patch", f"/products/{prod_id}", json={"Name": f"TEST_Prod_R_{UID}"})
    check("Update producto", r.status_code == 200, r.text)
r = api("get", "/products")
check("Listar productos", r.status_code == 200 and isinstance(r.json(), list))
print()

# =====================================================================
# 12. HOLIDAYS
# =====================================================================
print("=== Test: Feriados ===")
r = api("post", "/holidays", json={"Name": f"TEST_Fer_{UID}", "Date": "2026-12-25"})
check("Crear feriado", r.status_code == 201, r.text)
hol_id = safe(r, "HolidayId")
if hol_id:
    cleanup.append(("delete", f"/holidays/{hol_id}"))
r = api("get", "/holidays")
check("Listar feriados", r.status_code == 200)
print()

# =====================================================================
# 13. MANDATORY ACTIVITIES
# =====================================================================
print("=== Test: Actividades obligatorias ===")
r = api("post", "/mandatory-activities", json={
    "Name": f"TEST_MA_{UID}",
    "Description": "Actividad de test",
})
check("Crear actividad obligatoria", r.status_code == 201, r.text)
ma_id = safe(r, "MandatoryActivityId")
if ma_id:
    cleanup.append(("delete", f"/mandatory-activities/{ma_id}"))
    r = api("patch", f"/mandatory-activities/{ma_id}", json={"Description": "Actualizada"})
    check("Update actividad", r.status_code == 200, r.text)
r = api("get", "/mandatory-activities")
check("Listar actividades", r.status_code == 200)
print()

# =====================================================================
# 14. REPORTS
# =====================================================================
print("=== Test: Reportes ===")
r = api("get", "/reports/summary")
check("Reporte summary", r.status_code == 200, r.text)
r = api("get", "/reports/channel-coverage")
check("Reporte channel-coverage", r.status_code == 200, r.text)
r = api("get", "/reports/vendor-ranking")
check("Reporte vendor-ranking", r.status_code == 200, r.text)
print()

# =====================================================================
# 15. SETTINGS
# =====================================================================
print("=== Test: Settings ===")
r = api("put", f"/settings/TEST_{UID}", json={"Value": "test_value", "Description": "Test"})
check("Crear/update setting", r.status_code == 200, r.text)
r = api("get", f"/settings/TEST_{UID}")
check("Get setting", r.status_code == 200 and r.json().get("Value") == "test_value")
print()

# =====================================================================
# 16. HEALTH
# =====================================================================
print("=== Test: Health ===")
r = requests.get(f"{API}/health")
check("Health check", r.status_code == 200 and r.json().get("status") == "ok")
d = r.json().get("checks", {})
check("DB check ok", d.get("db") == "ok")
check("Storage check ok", "storage" in d)
print()

# =====================================================================
# CLEANUP
# =====================================================================
print("=== CLEANUP ===")
order = ["/visits/", "/incidents/", "/notifications/", "/mandatory-activities/",
         "/routes/", "/pdvs/", "/forms/", "/products/", "/holidays/",
         "/users/", "/subchannels/", "/channels/", "/distributors/", "/zones/"]

def sort_key(item):
    _, path = item
    for i, prefix in enumerate(order):
        if prefix in path:
            return i
    return len(order)

for action, path in sorted(cleanup, key=sort_key):
    if action == "delete_setting":
        print(f"  skip: setting {path}")
        continue
    if "/None" in path:
        print(f"  skip: {path}")
        continue
    r = api("delete", path)
    if r.status_code in (200, 204):
        print(f"  OK: DELETE {path}")
    else:
        print(f"  WARN({r.status_code}): DELETE {path}")

print()
print("=" * 60)
print(f"RESULTADO: {passed} passed, {failed} failed de {passed + failed} tests")
if failed:
    sys.exit(1)
else:
    print("ALL TESTS PASSED")
