"""Censo de cobertura en 3 estados (Sí / No / Sin dato) en los endpoints:
diff de visita, detalle de visita y product-analytics.

El corte histórico (`AppSetting coverage_explicit_no_since`) convierte los
`Works=False` anteriores en "sin dato". Ver app/services/coverage_semantics.py.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import AppSetting as AppSettingModel
from app.models.visit_coverage import VisitCoverage as CoverageModel
from app.services.coverage_semantics import COVERAGE_CUTOFF_SETTING

CUT = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)
BEFORE = CUT - timedelta(days=30)
AFTER = CUT + timedelta(days=1)


def _uid():
    return uuid.uuid4().hex[:8]


@pytest.fixture()
def db():
    s = sessionmaker(bind=engine)()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


@pytest.fixture()
def cutoff(db):
    """Setea el corte y lo limpia al terminar (la DB de tests es compartida)."""
    db.query(AppSettingModel).filter(AppSettingModel.Key == COVERAGE_CUTOFF_SETTING).delete()
    db.add(AppSettingModel(Key=COVERAGE_CUTOFF_SETTING, Value=CUT.isoformat()))
    db.commit()
    yield CUT
    db.query(AppSettingModel).filter(AppSettingModel.Key == COVERAGE_CUTOFF_SETTING).delete()
    db.commit()


def _set_created_at(db, visit_id: int, when: datetime):
    """Simula filas cargadas antes/después del corte (CreatedAt es server_default)."""
    db.query(CoverageModel).filter(CoverageModel.VisitId == visit_id).update({"CreatedAt": when})
    db.commit()


def _pdv(client):
    ch = client.post("/channels", json={"Name": f"Ch_{_uid()}"}).json()
    return client.post("/pdvs", json={"Name": f"PDV_{_uid()}", "ChannelId": ch["ChannelId"]}).json()


def _user(client):
    email = f"u_{_uid()}@test.com"
    return client.post("/users", json={"Email": email, "DisplayName": email, "Password": "Pass123!"}).json()


def _visit(client, pdv_id, user_id):
    return client.post("/visits", json={"PdvId": pdv_id, "UserId": user_id, "Status": "OPEN"}).json()


def _product(client, name, brand=None, category="Cigarrillos"):
    body = {"Name": name, "Category": category}
    if brand:
        body["Brand"] = brand
    return client.post("/products", json=body).json()


def _closed_visit_with(client, pdv_id, user_id, items):
    v = _visit(client, pdv_id, user_id)
    assert client.put(f"/visits/{v['VisitId']}/coverage", json={"items": items}).status_code == 200
    client.patch(f"/visits/{v['VisitId']}", json={"Status": "CLOSED"})
    return v


# ---------------------------------------------------------------------------
# GET /visits/{id}/coverage/diff
# ---------------------------------------------------------------------------

def test_diff_oculta_no_anterior_al_corte(client, db, cutoff):
    pdv, user = _pdv(client), _user(client)
    p_yes = _product(client, f"Marlboro Box {_uid()}")
    p_no = _product(client, f"Milenio Box {_uid()}")
    v1 = _closed_visit_with(client, pdv["PdvId"], user["UserId"], [
        {"ProductId": p_yes["ProductId"], "Works": True, "Price": 1000},
        {"ProductId": p_no["ProductId"], "Works": False},
    ])
    _set_created_at(db, v1["VisitId"], BEFORE)

    v2 = _visit(client, pdv["PdvId"], user["UserId"])
    diffs = {d["ProductId"]: d for d in client.get(f"/visits/{v2['VisitId']}/coverage/diff").json()}
    # El Sí viejo sobrevive al corte
    assert diffs[p_yes["ProductId"]]["PrevWorks"] is True
    assert float(diffs[p_yes["ProductId"]]["PrevPrice"]) == 1000
    # El No viejo es "sin dato": ni siquiera aparece (fila tratada como ausente)
    assert p_no["ProductId"] not in diffs


def test_diff_muestra_no_posterior_al_corte(client, db, cutoff):
    pdv, user = _pdv(client), _user(client)
    p_no = _product(client, f"Milenio Box {_uid()}")
    v1 = _closed_visit_with(client, pdv["PdvId"], user["UserId"], [
        {"ProductId": p_no["ProductId"], "Works": False},
    ])
    _set_created_at(db, v1["VisitId"], AFTER)

    v2 = _visit(client, pdv["PdvId"], user["UserId"])
    diffs = {d["ProductId"]: d for d in client.get(f"/visits/{v2['VisitId']}/coverage/diff").json()}
    assert diffs[p_no["ProductId"]]["PrevWorks"] is False
    assert diffs[p_no["ProductId"]]["HasCurrentData"] is False


def test_diff_fila_actual_anterior_al_corte_es_sin_dato(client, db, cutoff):
    """Visita abierta con un No viejo: se ve como sin dato (HasCurrentData=False)."""
    pdv, user = _pdv(client), _user(client)
    p_no = _product(client, f"Milenio Box {_uid()}")
    p_yes = _product(client, f"Marlboro Box {_uid()}")
    v = _visit(client, pdv["PdvId"], user["UserId"])
    client.put(f"/visits/{v['VisitId']}/coverage", json={"items": [
        {"ProductId": p_no["ProductId"], "Works": False},
        {"ProductId": p_yes["ProductId"], "Works": True, "Price": 900},
    ]})
    _set_created_at(db, v["VisitId"], BEFORE)

    diffs = {d["ProductId"]: d for d in client.get(f"/visits/{v['VisitId']}/coverage/diff").json()}
    assert p_no["ProductId"] not in diffs
    assert diffs[p_yes["ProductId"]]["HasCurrentData"] is True
    assert diffs[p_yes["ProductId"]]["Works"] is True


def test_diff_sin_corte_todo_no_cuenta(client, db):
    """Sin setting = comportamiento anterior: el No viejo sigue siendo un No."""
    db.query(AppSettingModel).filter(AppSettingModel.Key == COVERAGE_CUTOFF_SETTING).delete()
    db.commit()
    pdv, user = _pdv(client), _user(client)
    p_no = _product(client, f"Milenio Box {_uid()}")
    v1 = _closed_visit_with(client, pdv["PdvId"], user["UserId"], [
        {"ProductId": p_no["ProductId"], "Works": False},
    ])
    _set_created_at(db, v1["VisitId"], BEFORE)
    v2 = _visit(client, pdv["PdvId"], user["UserId"])
    diffs = {d["ProductId"]: d for d in client.get(f"/visits/{v2['VisitId']}/coverage/diff").json()}
    assert diffs[p_no["ProductId"]]["PrevWorks"] is False


def test_diff_trae_brand_explicita_o_inferida(client):
    pdv, user = _pdv(client), _user(client)
    p_explicit = _product(client, f"Cualquier Nombre {_uid()}", brand="Lucky Strike")
    p_inferred = _product(client, f"Philip Morris Red {_uid()}")
    v = _visit(client, pdv["PdvId"], user["UserId"])
    client.put(f"/visits/{v['VisitId']}/coverage", json={"items": [
        {"ProductId": p_explicit["ProductId"], "Works": True},
        {"ProductId": p_inferred["ProductId"], "Works": False},
    ]})
    diffs = {d["ProductId"]: d for d in client.get(f"/visits/{v['VisitId']}/coverage/diff").json()}
    assert diffs[p_explicit["ProductId"]]["Brand"] == "Lucky Strike"
    assert diffs[p_inferred["ProductId"]]["Brand"] == "Philip Morris"
    # No explícito post-form: se persiste y se ve tal cual
    assert diffs[p_inferred["ProductId"]]["Works"] is False
    assert diffs[p_inferred["ProductId"]]["HasCurrentData"] is True


def test_bulk_save_persiste_no_explicito(client):
    pdv, user = _pdv(client), _user(client)
    p = _product(client, f"Milenio Box {_uid()}")
    v = _visit(client, pdv["PdvId"], user["UserId"])
    rows = client.put(f"/visits/{v['VisitId']}/coverage", json={"items": [
        {"ProductId": p["ProductId"], "Works": False},
    ]}).json()
    assert len(rows) == 1 and rows[0]["Works"] is False
    assert len(client.get(f"/visits/{v['VisitId']}/coverage").json()) == 1


# ---------------------------------------------------------------------------
# GET /visits/{id}/full — Brand por fila de cobertura
# ---------------------------------------------------------------------------

def test_visit_full_coverage_trae_brand(client):
    pdv, user = _pdv(client), _user(client)
    p = _product(client, f"Van Kiff Verde {_uid()}")
    v = _visit(client, pdv["PdvId"], user["UserId"])
    client.put(f"/visits/{v['VisitId']}/coverage", json={"items": [{"ProductId": p["ProductId"], "Works": True}]})
    full = client.get(f"/visits/{v['VisitId']}/full").json()
    assert full["coverage"][0]["Brand"] == "Van Kiff"


# ---------------------------------------------------------------------------
# GET /reports/product-analytics
# ---------------------------------------------------------------------------

def test_product_analytics_excluye_filas_sin_dato(client, db, cutoff):
    pdv, user = _pdv(client), _user(client)
    cat = f"Cat_{_uid()}"  # categoría única para aislar byCategory
    p_old_no = _product(client, f"Milenio Old {_uid()}", category=cat)
    p_old_yes = _product(client, f"Marlboro Old {_uid()}", category=cat)
    p_new_no = _product(client, f"Lucky New {_uid()}", category=cat)

    v1 = _closed_visit_with(client, pdv["PdvId"], user["UserId"], [
        {"ProductId": p_old_no["ProductId"], "Works": False},
        {"ProductId": p_old_yes["ProductId"], "Works": True, "Price": 1500, "Availability": "disponible"},
    ])
    _set_created_at(db, v1["VisitId"], BEFORE)
    # Visita más nueva: No ambiguo (pre-corte) sobre p_old_yes NO debe tapar el Sí viejo
    v2 = _closed_visit_with(client, pdv["PdvId"], user["UserId"], [
        {"ProductId": p_old_yes["ProductId"], "Works": False},
        {"ProductId": p_new_no["ProductId"], "Works": False},
    ])
    _set_created_at(db, v2["VisitId"], BEFORE)
    v3 = _closed_visit_with(client, pdv["PdvId"], user["UserId"], [
        {"ProductId": p_new_no["ProductId"], "Works": False},
    ])
    _set_created_at(db, v3["VisitId"], AFTER)

    data = client.get("/reports/product-analytics").json()
    by_prod = {bp["ProductId"]: bp for bp in data["byProduct"]}
    assert p_old_no["ProductId"] not in by_prod          # solo tenía un No pre-corte
    assert by_prod[p_old_yes["ProductId"]]["worksCount"] == 1   # el Sí viejo sobrevive
    assert by_prod[p_old_yes["ProductId"]]["pdvCount"] == 1
    assert by_prod[p_new_no["ProductId"]]["worksCount"] == 0    # No post-corte cuenta como No
    assert by_prod[p_new_no["ProductId"]]["pdvCount"] == 1

    by_cat = {c["Category"]: c for c in data["byCategory"]}
    # Denominador = PDVs con dato conocido en la categoría (1), no todos los activos
    assert by_cat[cat]["pdvCount"] == 1
    assert by_cat[cat]["avgCoverage"] == 100.0
    assert by_cat[cat]["productCount"] == 2

    assert data["coverageCutoff"] == CUT.isoformat()
    assert "pdvsSinDato" in data


def test_product_analytics_pdvs_sin_dato(client, db, cutoff):
    """PDV activo cuyo único censo es un No pre-corte cuenta como sin dato."""
    pdv, user = _pdv(client), _user(client)
    p = _product(client, f"Milenio Solo {_uid()}")
    v = _closed_visit_with(client, pdv["PdvId"], user["UserId"], [{"ProductId": p["ProductId"], "Works": False}])
    _set_created_at(db, v["VisitId"], BEFORE)
    before = client.get("/reports/product-analytics").json()["pdvsSinDato"]

    v2 = _closed_visit_with(client, pdv["PdvId"], user["UserId"], [{"ProductId": p["ProductId"], "Works": False}])
    _set_created_at(db, v2["VisitId"], AFTER)
    after = client.get("/reports/product-analytics").json()["pdvsSinDato"]
    assert after == before - 1


def test_categorias_no_trabaja_pre_corte_se_omiten(client, db, cutoff):
    """El form viejo grababa `no_trabaja` como default para toda categoría no
    abierta. Con corte, esas filas no son respuesta → no se listan (sin dato).
    `trabaja` siempre se lista."""
    from datetime import timedelta
    from app.models import PdvProductCategory as CatModel

    pdv = _pdv(client)
    client.put(f"/pdvs/{pdv['PdvId']}/product-categories", json={"categories": [
        {"Category": "Cigarrillos", "Status": "no_trabaja"},
        {"Category": "Tabacos", "Status": "trabaja"},
        {"Category": "Vapers", "Status": "no_trabaja"},
    ]})
    # Cigarrillos y Tabacos quedan "pre-corte"; Vapers es post-corte.
    for cat in ("Cigarrillos", "Tabacos"):
        db.query(CatModel).filter(CatModel.PdvId == pdv["PdvId"], CatModel.Category == cat).update(
            {"UpdatedAt": cutoff - timedelta(days=1)}
        )
    db.query(CatModel).filter(CatModel.PdvId == pdv["PdvId"], CatModel.Category == "Vapers").update(
        {"UpdatedAt": cutoff + timedelta(days=1)}
    )
    db.commit()

    listed = {r["Category"]: r["Status"] for r in client.get(f"/pdvs/{pdv['PdvId']}/product-categories").json()}
    assert "Cigarrillos" not in listed          # no_trabaja viejo = sin dato
    assert listed["Tabacos"] == "trabaja"       # trabaja siempre cuenta
    assert listed["Vapers"] == "no_trabaja"     # No explícito post-corte
