"""Consolidado de respuestas para Excel en Censos y Respuestas (2026-11-12)."""
from tests.test_route_campaign import _login, _pdv, _uid, _user
from tests.test_visits import _make_visit


def test_export_consolida_respuestas_y_respeta_jerarquia(client):
    manager = _user(client, "territory_manager")
    propio = _user(client, "vendedor", manager_id=manager["UserId"])
    ajeno = _user(client, "vendedor")
    form = client.post("/forms", json={"Name": f"Act_{_uid()}", "IsActive": True, "Version": 1}).json()
    qs = {}
    for i, (key, qtype) in enumerate((("atados", "number"), ("activo", "radio"))):
        r = client.post(f"/forms/{form['FormId']}/questions", json={"SortOrder": i, "KeyName": key, "Label": key.title(), "QType": qtype})
        assert r.status_code == 201, r.text
        qs[key] = r.json()["QuestionId"]
    r = client.post(f"/forms/questions/{qs['activo']}/options", json={"QuestionId": qs["activo"], "Value": "si", "Label": "Sí", "SortOrder": 0})
    assert r.status_code == 201, r.text

    visits = {}
    for u, atados in ((propio, 7), (ajeno, 3)):
        v = _make_visit(client, _pdv(client)["PdvId"], u["UserId"]).json()
        r = client.post(f"/visits/{v['VisitId']}/answers", json={"answers": [
            {"QuestionId": qs["atados"], "ValueNumber": atados},
            {"QuestionId": qs["activo"], "ValueText": "si"},
        ]})
        assert r.status_code == 201, r.text
        visits[u["UserId"]] = v["VisitId"]

    data = client.get("/visits/answers-export").json()
    cols = [c for c in data["questions"] if c["FormId"] == form["FormId"]]
    assert [c["Label"] for c in cols] == ["Atados", "Activo"]
    by_id = {v["VisitId"]: v for v in data["visits"]}
    row = by_id[visits[propio["UserId"]]]
    assert row["UserName"] == propio["DisplayName"]
    assert row["answers"][cols[0]["key"]]["ValueNumber"] == 7
    assert row["answers"][cols[1]["key"]]["ValueText"] == "si"
    assert cols[1]["Options"] == {"si": "Sí"} and cols[0]["Options"] == {}
    assert data["truncated"] is False

    # El manager solo ve las visitas de su equipo
    mine = client.get("/visits/answers-export", headers=_login(client, manager["Email"])).json()
    ids = {v["VisitId"] for v in mine["visits"]}
    assert visits[propio["UserId"]] in ids and visits[ajeno["UserId"]] not in ids

    assert client.get("/visits/answers-export", params={"date_from": "nope"}).status_code == 400
    assert client.get("/visits/answers-export", params={"date_from": "2099-01-01"}).json()["visits"] == []
