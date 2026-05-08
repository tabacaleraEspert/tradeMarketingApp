"""Point of Sale (PDV) operation tests.

Strategy: `client` fixture is admin-authenticated. All data creation uses the
admin client directly (no token juggling needed for setup). Role-specific
assertions use explicit token overrides.

Covers:
- Create PDV with required / optional fields
- Duplicate name detection within a zone
- Get, update, delete PDV
- Active → Inactive transition (sets InactiveSince / ReactivateOn)
- Inactive → Active transition (clears dates)
- PDV contacts (create via payload, update, clear)
- List PDVs with zone filter and pagination
- Distributor association
- Delete PDV (admin only enforced)
"""
import uuid
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uid():
    return uuid.uuid4().hex[:8]


def _make_channel(client, name=None):
    name = name or f"Ch_{_uid()}"
    resp = client.post("/channels", json={"Name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_zone(client, name=None):
    name = name or f"Zone_{_uid()}"
    resp = client.post("/zones", json={"Name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_pdv(client, channel_id, name=None, **kwargs):
    name = name or f"PDV_{_uid()}"
    payload = {"Name": name, "ChannelId": channel_id, "IsActive": True, **kwargs}
    resp = client.post("/pdvs", json=payload)
    return resp


def _make_user(client):
    email = f"pdv_u_{_uid()}@test.com"
    resp = client.post("/users", json={"Email": email, "DisplayName": email, "Password": "Pass123!"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _login(client, email, password="Pass123!"):
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def channel(client):
    return _make_channel(client)


@pytest.fixture()
def zone(client):
    return _make_zone(client)


# ---------------------------------------------------------------------------
# Create PDV
# ---------------------------------------------------------------------------

class TestCreatePdv:
    def test_create_pdv_minimal(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"])
        assert resp.status_code == 201
        pdv = resp.json()
        assert pdv["PdvId"] > 0
        assert pdv["IsActive"] is True

    def test_create_pdv_with_location(self, client, channel):
        resp = _make_pdv(
            client, channel["ChannelId"],
            Lat=-34.6037, Lon=-58.3816, Address="Av. Corrientes 1234", City="Buenos Aires",
        )
        assert resp.status_code == 201
        pdv = resp.json()
        # Lat/Lon may be returned as string (Decimal) from SQLite; coerce to float for comparison
        assert abs(float(pdv["Lat"]) - (-34.6037)) < 0.0001
        assert abs(float(pdv["Lon"]) - (-58.3816)) < 0.0001
        assert pdv["Address"] == "Av. Corrientes 1234"

    def test_create_pdv_with_zone(self, client, channel, zone):
        resp = _make_pdv(client, channel["ChannelId"], ZoneId=zone["ZoneId"])
        assert resp.status_code == 201
        assert resp.json()["ZoneId"] == zone["ZoneId"]

    def test_create_pdv_with_contact(self, client, channel):
        resp = _make_pdv(
            client, channel["ChannelId"],
            Contacts=[{"ContactName": "Juan Perez", "ContactPhone": "11-1234-5678", "ContactRole": "dueño"}],
        )
        assert resp.status_code == 201
        pdv = resp.json()
        assert len(pdv["Contacts"]) == 1
        assert pdv["Contacts"][0]["ContactName"] == "Juan Perez"

    def test_create_pdv_with_invalid_channel_rejected(self, client):
        resp = _make_pdv(client, 999999)
        assert resp.status_code == 400

    def test_duplicate_name_same_zone_rejected(self, client, channel, zone):
        name = f"DupPDV_{_uid()}"
        _make_pdv(client, channel["ChannelId"], name=name, ZoneId=zone["ZoneId"])
        resp = _make_pdv(client, channel["ChannelId"], name=name, ZoneId=zone["ZoneId"])
        assert resp.status_code == 409

    def test_same_name_different_zone_allowed(self, client, channel, zone):
        zone2 = _make_zone(client)
        name = f"CrossZone_{_uid()}"
        _make_pdv(client, channel["ChannelId"], name=name, ZoneId=zone["ZoneId"])
        resp = _make_pdv(client, channel["ChannelId"], name=name, ZoneId=zone2["ZoneId"])
        assert resp.status_code == 201

    def test_create_pdv_sets_channel_name(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"])
        assert resp.json()["ChannelName"] == channel["Name"]

    def test_auto_generated_code_when_not_provided(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"])
        code = resp.json()["Code"]
        assert code is not None
        assert len(code) > 0

    def test_custom_code_preserved(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"], Code="MYCODE001")
        assert resp.json()["Code"] == "MYCODE001"

    def test_create_pdv_requires_auth(self, client, channel):
        resp = client.post(
            "/pdvs",
            json={"Name": f"NoAuth_{_uid()}", "ChannelId": channel["ChannelId"]},
            headers={"Authorization": ""},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Get PDV
# ---------------------------------------------------------------------------

class TestGetPdv:
    def test_get_pdv_by_id(self, client, channel):
        pdv = _make_pdv(client, channel["ChannelId"]).json()
        resp = client.get(f"/pdvs/{pdv['PdvId']}")
        assert resp.status_code == 200
        assert resp.json()["PdvId"] == pdv["PdvId"]

    def test_get_nonexistent_pdv_returns_404(self, client):
        resp = client.get("/pdvs/999999")
        assert resp.status_code == 404

    def test_get_pdv_includes_contacts_list(self, client, channel):
        pdv = _make_pdv(
            client, channel["ChannelId"],
            Contacts=[{"ContactName": "Maria"}],
        ).json()
        resp = client.get(f"/pdvs/{pdv['PdvId']}")
        assert resp.status_code == 200
        assert isinstance(resp.json()["Contacts"], list)

    def test_get_pdv_includes_distributors_list(self, client, channel):
        pdv = _make_pdv(client, channel["ChannelId"]).json()
        resp = client.get(f"/pdvs/{pdv['PdvId']}")
        assert isinstance(resp.json()["Distributors"], list)


# ---------------------------------------------------------------------------
# List PDVs
# ---------------------------------------------------------------------------

class TestListPdvs:
    def test_list_pdvs_returns_list(self, client, channel):
        _make_pdv(client, channel["ChannelId"])
        resp = client.get("/pdvs")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_list_pdvs_filter_by_zone(self, client, channel, zone):
        _make_pdv(client, channel["ChannelId"], ZoneId=zone["ZoneId"])
        resp = client.get("/pdvs", params={"zone_id": zone["ZoneId"]})
        assert resp.status_code == 200
        for pdv in resp.json():
            assert pdv["ZoneId"] == zone["ZoneId"]

    def test_list_pdvs_pagination_limit(self, client, channel):
        for _ in range(3):
            _make_pdv(client, channel["ChannelId"])
        resp = client.get("/pdvs", params={"limit": 2, "skip": 0})
        assert resp.status_code == 200
        assert len(resp.json()) <= 2

    def test_list_pdvs_requires_auth(self, client):
        resp = client.get("/pdvs", headers={"Authorization": ""})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Update PDV
# ---------------------------------------------------------------------------

class TestUpdatePdv:
    def test_update_pdv_name(self, client, channel):
        pdv = _make_pdv(client, channel["ChannelId"]).json()
        new_name = f"Updated_{_uid()}"
        resp = client.patch(f"/pdvs/{pdv['PdvId']}", json={"Name": new_name})
        assert resp.status_code == 200
        assert resp.json()["Name"] == new_name

    def test_update_pdv_address(self, client, channel):
        pdv = _make_pdv(client, channel["ChannelId"]).json()
        resp = client.patch(f"/pdvs/{pdv['PdvId']}", json={"Address": "Nueva Dirección 456"})
        assert resp.status_code == 200
        assert resp.json()["Address"] == "Nueva Dirección 456"

    def test_update_pdv_channel_name_reflects(self, client, channel):
        pdv = _make_pdv(client, channel["ChannelId"]).json()
        new_channel = _make_channel(client)
        resp = client.patch(f"/pdvs/{pdv['PdvId']}", json={"ChannelId": new_channel["ChannelId"]})
        assert resp.status_code == 200
        assert resp.json()["ChannelName"] == new_channel["Name"]

    def test_update_pdv_nonexistent_returns_404(self, client):
        resp = client.patch("/pdvs/999999", json={"Name": "X"})
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Active / Inactive transitions
# ---------------------------------------------------------------------------

class TestPdvActiveInactive:
    def test_deactivate_pdv_sets_inactive_reason(self, client, channel):
        pdv = _make_pdv(client, channel["ChannelId"]).json()
        resp = client.patch(
            f"/pdvs/{pdv['PdvId']}",
            json={"IsActive": False, "InactiveReason": "Cerrado por obras"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["IsActive"] is False
        assert data["InactiveReason"] == "Cerrado por obras"

    def test_deactivate_pdv_auto_sets_reactivate_on(self, client, channel):
        pdv = _make_pdv(client, channel["ChannelId"]).json()
        resp = client.patch(f"/pdvs/{pdv['PdvId']}", json={"IsActive": False})
        assert resp.json()["ReactivateOn"] is not None

    def test_reactivate_pdv_clears_inactive_fields(self, client, channel):
        pdv = _make_pdv(client, channel["ChannelId"]).json()
        client.patch(f"/pdvs/{pdv['PdvId']}", json={"IsActive": False})
        resp = client.patch(f"/pdvs/{pdv['PdvId']}", json={"IsActive": True})
        assert resp.status_code == 200
        data = resp.json()
        assert data["IsActive"] is True
        assert data["ReactivateOn"] is None


# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------

class TestPdvContacts:
    def test_update_contacts_replaces_all(self, client, channel):
        pdv = _make_pdv(
            client, channel["ChannelId"],
            Contacts=[{"ContactName": "Original", "ContactRole": "dueño"}],
        ).json()
        resp = client.patch(
            f"/pdvs/{pdv['PdvId']}",
            json={"Contacts": [
                {"ContactName": "Nuevo 1", "ContactRole": "empleado"},
                {"ContactName": "Nuevo 2", "ContactRole": "encargado"},
            ]},
        )
        assert resp.status_code == 200
        contacts = resp.json()["Contacts"]
        assert len(contacts) == 2
        names = {c["ContactName"] for c in contacts}
        assert names == {"Nuevo 1", "Nuevo 2"}

    def test_clear_contacts_on_update(self, client, channel):
        pdv = _make_pdv(
            client, channel["ChannelId"],
            Contacts=[{"ContactName": "To Remove"}],
        ).json()
        resp = client.patch(f"/pdvs/{pdv['PdvId']}", json={"Contacts": []})
        assert resp.status_code == 200
        assert resp.json()["Contacts"] == []

    def test_contact_has_expected_fields(self, client, channel):
        pdv = _make_pdv(
            client, channel["ChannelId"],
            Contacts=[{"ContactName": "Test Contact", "ContactPhone": "11-9999-9999", "ContactRole": "dueño"}],
        ).json()
        contact = pdv["Contacts"][0]
        assert "PdvContactId" in contact
        assert contact["ContactName"] == "Test Contact"
        assert contact["ContactPhone"] == "11-9999-9999"


# ---------------------------------------------------------------------------
# Delete PDV (admin only)
# ---------------------------------------------------------------------------

class TestDeletePdv:
    def test_admin_can_delete_pdv(self, client, channel):
        pdv = _make_pdv(client, channel["ChannelId"]).json()
        resp = client.delete(f"/pdvs/{pdv['PdvId']}")
        assert resp.status_code == 204

    def test_delete_nonexistent_pdv_returns_404(self, client):
        resp = client.delete("/pdvs/999999")
        assert resp.status_code == 404

    def test_vendedor_cannot_delete_pdv(self, client, channel):
        pdv = _make_pdv(client, channel["ChannelId"]).json()
        user = _make_user(client)
        token = _login(client, user["Email"])
        resp = client.delete(f"/pdvs/{pdv['PdvId']}", headers=_auth(token))
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Volume categorization
# ---------------------------------------------------------------------------

class TestVolumeCategory:
    """Verify MonthlyVolume ↔ Category derivation (Chico/Mediano/Grande)."""

    def test_create_pdv_chico(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"], MonthlyVolume=500)
        assert resp.status_code == 201
        pdv = resp.json()
        assert pdv["MonthlyVolume"] == 500
        assert pdv["Category"] == "Chico"

    def test_create_pdv_chico_boundary(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"], MonthlyVolume=800)
        assert resp.status_code == 201
        assert resp.json()["Category"] == "Chico"

    def test_create_pdv_mediano(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"], MonthlyVolume=1000)
        assert resp.status_code == 201
        pdv = resp.json()
        assert pdv["MonthlyVolume"] == 1000
        assert pdv["Category"] == "Mediano"

    def test_create_pdv_mediano_boundary(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"], MonthlyVolume=1500)
        assert resp.status_code == 201
        assert resp.json()["Category"] == "Mediano"

    def test_create_pdv_grande(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"], MonthlyVolume=2000)
        assert resp.status_code == 201
        pdv = resp.json()
        assert pdv["MonthlyVolume"] == 2000
        assert pdv["Category"] == "Grande"

    def test_create_pdv_grande_boundary(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"], MonthlyVolume=1501)
        assert resp.status_code == 201
        assert resp.json()["Category"] == "Grande"

    def test_create_pdv_zero_volume_is_chico(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"], MonthlyVolume=0)
        assert resp.status_code == 201
        assert resp.json()["Category"] == "Chico"

    def test_create_pdv_no_volume_no_category(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"])
        assert resp.status_code == 201
        pdv = resp.json()
        assert pdv["MonthlyVolume"] is None
        assert pdv["Category"] is None

    def test_update_pdv_volume_recalculates_category(self, client, channel):
        pdv = _make_pdv(client, channel["ChannelId"], MonthlyVolume=500).json()
        assert pdv["Category"] == "Chico"

        resp = client.patch(f"/pdvs/{pdv['PdvId']}", json={"MonthlyVolume": 1200})
        assert resp.status_code == 200
        assert resp.json()["Category"] == "Mediano"

        resp = client.patch(f"/pdvs/{pdv['PdvId']}", json={"MonthlyVolume": 2000})
        assert resp.status_code == 200
        assert resp.json()["Category"] == "Grande"


# ---------------------------------------------------------------------------
# Channel description
# ---------------------------------------------------------------------------

class TestChannelDescription:
    """Verify Description field on channels and subchannels."""

    def test_create_channel_with_description(self, client):
        resp = client.post("/channels", json={
            "Name": f"Ch_{_uid()}",
            "Description": "Canal de prueba para testing",
        })
        assert resp.status_code == 201
        ch = resp.json()
        assert ch["Description"] == "Canal de prueba para testing"

    def test_create_channel_without_description(self, client):
        resp = client.post("/channels", json={"Name": f"Ch_{_uid()}"})
        assert resp.status_code == 201
        assert resp.json()["Description"] is None

    def test_update_channel_description(self, client):
        ch = _make_channel(client)
        resp = client.patch(f"/channels/{ch['ChannelId']}", json={
            "Description": "Descripción actualizada",
        })
        assert resp.status_code == 200
        assert resp.json()["Description"] == "Descripción actualizada"

    def test_create_subchannel_with_description(self, client, channel):
        resp = client.post("/subchannels", json={
            "ChannelId": channel["ChannelId"],
            "Name": f"Sub_{_uid()}",
            "Description": "Subcanal de prueba",
        })
        assert resp.status_code == 201
        assert resp.json()["Description"] == "Subcanal de prueba"

    def test_update_subchannel_description(self, client, channel):
        sc = client.post("/subchannels", json={
            "ChannelId": channel["ChannelId"],
            "Name": f"Sub_{_uid()}",
        }).json()
        resp = client.patch(f"/subchannels/{sc['SubChannelId']}", json={
            "Description": "Nueva descripción",
        })
        assert resp.status_code == 200
        assert resp.json()["Description"] == "Nueva descripción"


# ---------------------------------------------------------------------------
# E2E: Alta → Modificación → Eliminación (flujo integral)
# ---------------------------------------------------------------------------

class TestPdvFullLifecycle:
    """Test integral: crea un PDV completo, lo modifica, y lo elimina."""

    def test_create_update_delete_flow(self, client, channel, zone):
        """Flujo completo: alta con todos los campos → update parcial → delete."""
        name = f"Integral_{_uid()}"
        # --- ALTA ---
        resp = _make_pdv(
            client, channel["ChannelId"],
            name=name,
            ZoneId=zone["ZoneId"],
            Address="Av. Sáenz 1302",
            City="Buenos Aires",
            Lat=-34.6505,
            Lon=-58.3948,
            OpeningTime="08:00",
            ClosingTime="18:00",
            VisitDay=1,
            MonthlyVolume=1200,
            BusinessName="Kiosco Don Juan SRL",
            Contacts=[
                {"ContactName": "Juan Pérez", "ContactPhone": "11-1111-1111", "ContactRole": "dueño"},
                {"ContactName": "María López", "ContactPhone": "11-2222-2222", "ContactRole": "empleado"},
            ],
        )
        assert resp.status_code == 201
        pdv = resp.json()
        pdv_id = pdv["PdvId"]
        assert pdv["Name"] == name
        assert pdv["Address"] == "Av. Sáenz 1302"
        assert pdv["ZoneId"] == zone["ZoneId"]
        assert pdv["Category"] == "Mediano"
        assert pdv["OpeningTime"] == "08:00"
        assert pdv["ClosingTime"] == "18:00"
        assert pdv["VisitDay"] == 1
        assert pdv["BusinessName"] == "Kiosco Don Juan SRL"
        assert len(pdv["Contacts"]) == 2
        assert pdv["IsActive"] is True

        # --- MODIFICACIÓN (cambio nombre, dirección, volumen, contactos) ---
        new_name = f"Modificado_{_uid()}"
        resp = client.patch(f"/pdvs/{pdv_id}", json={
            "Name": new_name,
            "Address": "Av. Sáenz 987",
            "MonthlyVolume": 2000,
            "OpeningTime": "09:00",
            "ClosingTime": "20:00",
            "Contacts": [
                {"ContactName": "Pedro García", "ContactRole": "encargado"},
            ],
        })
        assert resp.status_code == 200
        pdv = resp.json()
        assert pdv["Name"] == new_name
        assert pdv["Address"] == "Av. Sáenz 987"
        assert pdv["MonthlyVolume"] == 2000
        assert pdv["Category"] == "Grande"
        assert pdv["OpeningTime"] == "09:00"
        assert pdv["ClosingTime"] == "20:00"
        assert len(pdv["Contacts"]) == 1
        assert pdv["Contacts"][0]["ContactName"] == "Pedro García"
        # Campos no tocados se mantienen
        assert pdv["ZoneId"] == zone["ZoneId"]
        assert pdv["BusinessName"] == "Kiosco Don Juan SRL"

        # --- VERIFICAR con GET ---
        resp = client.get(f"/pdvs/{pdv_id}")
        assert resp.status_code == 200
        assert resp.json()["Name"] == new_name

        # --- ELIMINACIÓN ---
        resp = client.delete(f"/pdvs/{pdv_id}")
        assert resp.status_code == 204

        # --- VERIFICAR que no existe ---
        resp = client.get(f"/pdvs/{pdv_id}")
        assert resp.status_code == 404

    def test_create_deactivate_reactivate_delete(self, client, channel):
        """Alta → desactivar → reactivar → eliminar."""
        resp = _make_pdv(client, channel["ChannelId"])
        assert resp.status_code == 201
        pdv_id = resp.json()["PdvId"]

        # Desactivar
        resp = client.patch(f"/pdvs/{pdv_id}", json={
            "IsActive": False,
            "InactiveReason": "Cerrado temporalmente",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["IsActive"] is False
        assert data["InactiveReason"] == "Cerrado temporalmente"
        assert data["ReactivateOn"] is not None

        # Reactivar
        resp = client.patch(f"/pdvs/{pdv_id}", json={"IsActive": True})
        assert resp.status_code == 200
        data = resp.json()
        assert data["IsActive"] is True
        assert data["InactiveReason"] is None
        assert data["ReactivateOn"] is None

        # Eliminar
        resp = client.delete(f"/pdvs/{pdv_id}")
        assert resp.status_code == 204

    def test_create_with_subchannel_update_channel_delete(self, client):
        """Alta con canal+subcanal → cambio de canal → eliminar."""
        ch1 = _make_channel(client, f"Canal1_{_uid()}")
        ch2 = _make_channel(client, f"Canal2_{_uid()}")
        sc = client.post("/subchannels", json={
            "ChannelId": ch1["ChannelId"],
            "Name": f"Sub_{_uid()}",
        })
        assert sc.status_code == 201
        sc_id = sc.json()["SubChannelId"]

        # Alta con canal y subcanal
        resp = _make_pdv(
            client, ch1["ChannelId"],
            SubChannelId=sc_id,
        )
        assert resp.status_code == 201
        pdv = resp.json()
        pdv_id = pdv["PdvId"]
        assert pdv["ChannelName"] == ch1["Name"]
        assert pdv["SubChannelName"] == sc.json()["Name"]

        # Cambiar canal
        resp = client.patch(f"/pdvs/{pdv_id}", json={"ChannelId": ch2["ChannelId"]})
        assert resp.status_code == 200
        assert resp.json()["ChannelName"] == ch2["Name"]

        # Eliminar
        resp = client.delete(f"/pdvs/{pdv_id}")
        assert resp.status_code == 204

    def test_multiple_updates_preserve_unmodified_fields(self, client, channel, zone):
        """Varios updates parciales no borran campos no enviados."""
        resp = _make_pdv(
            client, channel["ChannelId"],
            ZoneId=zone["ZoneId"],
            Address="Original 100",
            City="CABA",
            MonthlyVolume=500,
            OpeningTime="08:00",
        )
        assert resp.status_code == 201
        pdv_id = resp.json()["PdvId"]

        # Update 1: solo nombre
        client.patch(f"/pdvs/{pdv_id}", json={"Name": f"Renamed_{_uid()}"})
        # Update 2: solo volumen
        client.patch(f"/pdvs/{pdv_id}", json={"MonthlyVolume": 900})
        # Update 3: solo ciudad
        resp = client.patch(f"/pdvs/{pdv_id}", json={"City": "Pompeya"})
        assert resp.status_code == 200
        pdv = resp.json()

        # Todo lo no tocado se mantiene
        assert pdv["Address"] == "Original 100"
        assert pdv["ZoneId"] == zone["ZoneId"]
        assert pdv["OpeningTime"] == "08:00"
        assert pdv["MonthlyVolume"] == 900
        assert pdv["Category"] == "Mediano"
        assert pdv["City"] == "Pompeya"


# ---------------------------------------------------------------------------
# E2E: Distributors en flujo completo
# ---------------------------------------------------------------------------

class TestPdvDistributorLifecycle:
    """Test integral de distribuidores asociados al PDV."""

    @pytest.fixture()
    def distributors(self, client):
        dists = []
        for i in range(3):
            resp = client.post("/distributors", json={"Name": f"Dist_{_uid()}"})
            assert resp.status_code == 201, resp.text
            dists.append(resp.json())
        return dists

    def test_create_with_distributors_update_delete(self, client, channel, distributors):
        """Alta con distribuidores → cambiar distribuidores → eliminar PDV."""
        dist_ids = [d["DistributorId"] for d in distributors[:2]]

        # Alta con 2 distribuidores
        resp = _make_pdv(
            client, channel["ChannelId"],
            DistributorIds=dist_ids,
        )
        assert resp.status_code == 201
        pdv = resp.json()
        pdv_id = pdv["PdvId"]
        assert len(pdv["Distributors"]) == 2

        # Cambiar a 1 solo distribuidor (el tercero)
        resp = client.patch(f"/pdvs/{pdv_id}", json={
            "DistributorIds": [distributors[2]["DistributorId"]],
        })
        assert resp.status_code == 200
        assert len(resp.json()["Distributors"]) == 1
        assert resp.json()["Distributors"][0]["DistributorId"] == distributors[2]["DistributorId"]

        # Quitar todos los distribuidores
        resp = client.patch(f"/pdvs/{pdv_id}", json={"DistributorIds": []})
        assert resp.status_code == 200
        assert resp.json()["Distributors"] == []

        # Eliminar PDV
        resp = client.delete(f"/pdvs/{pdv_id}")
        assert resp.status_code == 204


# ---------------------------------------------------------------------------
# Validation edge cases
# ---------------------------------------------------------------------------

class TestPdvValidation:
    """Validaciones de campos en alta y modificación."""

    def test_create_empty_name_rejected(self, client, channel):
        resp = client.post("/pdvs", json={"Name": "  ", "ChannelId": channel["ChannelId"]})
        assert resp.status_code == 422

    def test_create_without_name_rejected(self, client, channel):
        resp = client.post("/pdvs", json={"ChannelId": channel["ChannelId"]})
        assert resp.status_code == 422

    def test_create_without_channel_rejected(self, client):
        resp = client.post("/pdvs", json={"Name": f"NoChannel_{_uid()}"})
        assert resp.status_code == 422

    def test_invalid_visit_day_rejected(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"], VisitDay=7)
        assert resp.status_code == 422

    def test_negative_volume_rejected(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"], MonthlyVolume=-1)
        assert resp.status_code == 422

    def test_invalid_opening_time_rejected(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"], OpeningTime="25:00")
        assert resp.status_code == 422

    def test_lat_out_of_range_rejected(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"], Lat=91.0, Lon=0)
        assert resp.status_code == 422

    def test_lon_out_of_range_rejected(self, client, channel):
        resp = _make_pdv(client, channel["ChannelId"], Lat=0, Lon=181.0)
        assert resp.status_code == 422
