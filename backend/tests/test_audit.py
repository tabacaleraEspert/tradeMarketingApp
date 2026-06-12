"""Auditoría: consistencia entre /audit/active-users y /audit/user-timeline.

Bug histórico (jun 2026): user_timeline tenía un early-return cuando el usuario
no tenía visitas en el rango, que salteaba incidentes y notas de PDV. Un trade
sin visitas pero con notas mostraba menos eventos en el timeline que el conteo
de "trades con movimiento" (66 vs 51).
"""
import uuid


def _uid():
    return uuid.uuid4().hex[:8]


def _make_pdv(client, name=None):
    ch = client.post("/channels", json={"Name": f"Ch_{_uid()}"}).json()
    resp = client.post("/pdvs", json={"Name": name or f"PDV_{_uid()}", "ChannelId": ch["ChannelId"]})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _me(client):
    # El cliente de tests está autenticado como admin; sacamos su UserId de /users
    users = client.get("/users").json()
    items = users["items"] if isinstance(users, dict) and "items" in users else users
    return items[0]["UserId"] if isinstance(items, list) else items["UserId"]


class TestAuditConsistency:
    def test_timeline_includes_notes_without_visits(self, client):
        """Usuario sin visitas en el rango pero con alta de PDV + nota:
        el timeline debe incluir AMBOS eventos (no cortar en el early return)."""
        pdv = _make_pdv(client)
        # El alta quedó asignada al usuario actual (AssignedUserId)
        uid = client.get(f"/pdvs/{pdv['PdvId']}").json()["AssignedUserId"]
        assert uid
        note = client.post(
            f"/pdvs/{pdv['PdvId']}/notes",
            json={"Content": "nota de prueba auditoría", "CreatedByUserId": uid},
        )
        assert note.status_code == 201, note.text

        tl = client.get("/audit/user-timeline", params={"user_id": uid})
        assert tl.status_code == 200, tl.text
        types = [e["type"] for e in tl.json()["events"]]
        assert "pdv_created" in types
        assert "note" in types, "las notas deben aparecer aunque el usuario no tenga visitas"

    def test_active_users_count_matches_timeline(self, client):
        """El conteo de active-users (visitas + altas + incidentes + notas) debe
        coincidir con los eventos del timeline para un usuario sin visitas."""
        pdv = _make_pdv(client)
        uid = client.get(f"/pdvs/{pdv['PdvId']}").json()["AssignedUserId"]
        client.post(f"/pdvs/{pdv['PdvId']}/notes", json={"Content": "otra nota", "CreatedByUserId": uid})

        au = client.get("/audit/active-users").json()
        row = next((u for u in au["users"] if u["UserId"] == uid), None)
        assert row is not None

        tl = client.get("/audit/user-timeline", params={"user_id": uid}).json()
        # Sin visitas: cada movimiento contado en active-users = 1 evento del timeline
        visit_types = {"visit_open", "visit_close"}
        non_visit_events = [e for e in tl["events"] if e["type"] not in visit_types]
        assert len(non_visit_events) >= row["count"] or len(tl["events"]) == row["count"]
