"""Semántica del censo de 3 estados: corte histórico y marca inferida.
Ver docstring de app/services/coverage_semantics.py."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import AppSetting as AppSettingModel
from app.services.coverage_semantics import (
    COVERAGE_CUTOFF_SETTING, brand_of, get_coverage_cutoff, row_is_known,
)

CUT = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)


@pytest.fixture()
def db():
    s = sessionmaker(bind=engine)()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


def test_works_true_siempre_es_dato():
    assert row_is_known(True, CUT - timedelta(days=100), CUT)
    assert row_is_known(True, None, CUT)


def test_sin_corte_toda_fila_cuenta():
    assert row_is_known(False, CUT - timedelta(days=100), None)


def test_no_anterior_al_corte_es_sin_dato():
    assert not row_is_known(False, CUT - timedelta(seconds=1), CUT)


def test_no_posterior_al_corte_es_dato():
    assert row_is_known(False, CUT, CUT)
    assert row_is_known(False, CUT + timedelta(days=1), CUT)


def test_naive_se_asume_utc():
    # SQLite devuelve naive; Azure SQL aware. Misma regla.
    assert row_is_known(False, datetime(2026, 9, 25), CUT)
    assert not row_is_known(False, datetime(2026, 9, 23), CUT)


def test_no_sin_created_at_es_sin_dato_con_corte():
    assert not row_is_known(False, None, CUT)


def test_get_cutoff_lee_el_setting(db):
    db.query(AppSettingModel).filter(AppSettingModel.Key == COVERAGE_CUTOFF_SETTING).delete()
    db.commit()
    assert get_coverage_cutoff(db) is None
    db.add(AppSettingModel(Key=COVERAGE_CUTOFF_SETTING, Value="2026-09-24T12:00:00+00:00"))
    db.commit()
    assert get_coverage_cutoff(db) == CUT
    db.query(AppSettingModel).filter(AppSettingModel.Key == COVERAGE_CUTOFF_SETTING).delete()
    db.commit()


def test_get_cutoff_valor_invalido_es_none(db):
    db.query(AppSettingModel).filter(AppSettingModel.Key == COVERAGE_CUTOFF_SETTING).delete()
    db.add(AppSettingModel(Key=COVERAGE_CUTOFF_SETTING, Value="ayer"))
    db.commit()
    assert get_coverage_cutoff(db) is None
    db.query(AppSettingModel).filter(AppSettingModel.Key == COVERAGE_CUTOFF_SETTING).delete()
    db.commit()


def test_brand_of_prefijos_y_fallback():
    assert brand_of("Marlboro Craft Coral") == "Marlboro"
    assert brand_of("Philip Morris Red Select") == "Philip Morris"
    assert brand_of("Lucky LS Origen Caps") == "Lucky Strike"
    assert brand_of("Luckies Red") == "Lucky Strike"
    assert brand_of("Red Point ON") == "Red Point"
    assert brand_of("Van Kiff") == "Van Kiff"
    assert brand_of("Milenio Icergy") == "Milenio"
    assert brand_of("Mill Explosion") == "Mill"
    assert brand_of("Millenium Gold") == "Millenium"  # "Mill" no matchea a mitad de palabra
    assert brand_of("Bold") == "Bold"
    assert brand_of("4 Leguas") == "4 Leguas"
    assert brand_of("") == ""
