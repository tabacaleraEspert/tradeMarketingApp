"""scripts/migrate_chains_20261119.py: funciones puras, guardas de los scripts y
apply_plan + rollback de punta a punta sobre una SQLite temporal (nunca prod)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import migrate_chains_20261119 as m  # noqa: E402
import review_chain_candidates_20261119 as rv  # noqa: E402
import chains_ops_20261119 as ops  # noqa: E402
import ddl_chains_20261119 as ddl  # noqa: E402
import rollback_chains_20261119 as rb  # noqa: E402


@pytest.mark.parametrize("sub,expected", [
    ("Tomyshop", "Tommy Shop"), ("Tommy's shop", "Tommy Shop"), ("TOMMY SHOP", "Tommy Shop"),
    ("Open25", "Open 25"), ("New Era", "SAM - New Era"), ("Oeste drugstore", "Oeste Drugstore"),
    ("the best", "The Best"), ("365", "365"),
    ("24/7", "24/7"), ("24.7 El Point", "24.7 El Point"),          # dudosos: quedan separados
    ("Drugstore Argentina", "Drugstore Argentina"),
    ("Chica (menos de 10 PDVs)", None), ("Grande (más de 30 PDVs)", None), ("Maxikiosco", None),
])
def test_canonical_for_subchannel(sub, expected):
    assert m.canonical_for_subchannel(sub) == expected


def test_chain_from_cad_name_and_patterns():
    known = {m.norm(n): n for n, *_ in m.KEY_ACCOUNT_CHAINS}
    known[m.norm("DIGUO")] = "DIGUO - Drugstores 24"
    assert m.chain_from_cad_name("SAM - New Era - ESMERALDA 899", known) == "SAM - New Era"
    assert m.chain_from_cad_name("365 - AV CORRIENTES 1200", known) == "365"
    assert m.chain_from_cad_name("Cartu7-24 - AV CORRIENTES 4237", known) == "Cartu7-24"
    assert m.chain_from_cad_name("DIGUO - Drugstores 24 - LAVALLE 1", known) == "DIGUO - Drugstores 24"
    assert m.chain_from_cad_name("La Piñata - Calle 1", known) == "La Piñata"
    assert m.chain_from_cad_name("Kiosco renombrado", known) is None
    assert m.chain_from_patterns('Maxikiosco "Tommy\'s shop" (Cadena)') == "Tommy Shop"
    assert m.chain_from_patterns("Marquet 24 (cadena)") == "K24"
    assert m.chain_from_patterns("Drugstores 24 (cadena)") == "DIGUO - Drugstores 24"
    assert m.chain_from_patterns("Kiosco Don José") is None


def test_every_reused_pdv_of_the_import_log_resolves_to_one_chain():
    import json
    log = json.loads(m.IMPORT_LOG.read_text())
    assert len(log["pdvs"]) == 371 and len(log["reused"]) == 82
    assert all(m.chain_from_patterns(r["Name"]) for r in log["reused"])
    known = {}
    for n, _c, _p, aliases in m.KEY_ACCOUNT_CHAINS:
        for label in [n] + [a for a in aliases.split(",") if a.strip()]:
            known[m.norm(label)] = n
    by_chain = {}
    for p in log["pdvs"]:
        chain = m.chain_from_cad_name(p["Name"], known)
        assert chain, p
        by_chain[chain] = by_chain.get(chain, 0) + 1
    assert len(by_chain) == 11 and by_chain["DIGUO - Drugstores 24"] == 6 and by_chain["SAM - New Era"] == 18


def _state():
    subs = [
        {"SubChannelId": 1, "ChannelId": 22, "Name": "Chica (menos de 10 PDVs)", "IsActive": True},
        {"SubChannelId": 2, "ChannelId": 22, "Name": "Tomyshop", "IsActive": True},
        {"SubChannelId": 3, "ChannelId": 22, "Name": "Tommy's shop", "IsActive": True},
        {"SubChannelId": 4, "ChannelId": 22, "Name": "Mckio", "IsActive": True},
        {"SubChannelId": 5, "ChannelId": 22, "Name": "Maxikiosco", "IsActive": True},
        {"SubChannelId": 62, "ChannelId": 9, "Name": "Key Accounts/Cuentas Claves", "IsActive": True},
    ]

    def pdv(i, name, ch, sub, code=None, active=True):
        return {"PdvId": i, "Code": code, "Name": name, "Channel": "x", "ChannelId": ch, "SubChannelId": sub,
                "ChainId": None, "IsActive": active}
    pdvs = [
        pdv(1, "Tomy 1", 22, 2), pdv(2, "Tommy 2", 22, 3), pdv(3, "Mckio 1", 22, 4), pdv(4, "Maxi", 22, 5),
        pdv(5, "365 - LAVALLE 1471", 9, 62, "CAD-01-012"), pdv(6, "Maxikiosco The Best (cadena)", 9, None),
        pdv(7, "Kiosco a mano", 9, 62), pdv(8, "Sin subcanal", 22, None),
    ]
    return {
        "ids": {"chain_channel": 22, "station_channel": 23, "legacy_ka_subchannel": 62, "account_manager": 149},
        "channel_names": {9: "Convenience", 22: "Cadenas de Proximidad", 23: "Estación de Servicio"},
        "subchannels": subs, "chains": [], "pdvs": pdvs,
    }


def test_build_plan():
    log = {"pdvs": [{"PdvId": 5}], "reused": [{"PdvId": 6, "Name": "The Best"}]}
    plan = m.build_plan(_state(), log)
    created = {c["Name"]: c for c in plan["chains_create"]}
    assert created["Tommy Shop"]["from_subchannels"] == ["Tomyshop", "Tommy's shop"]
    assert created["Tommy Shop"]["IsKeyAccount"] and created["Tommy Shop"]["AccountManagerUserId"] == 149
    assert created["Tommy Shop"]["StoreCount"] == 17 and "Tomyshop" in created["Tommy Shop"]["Aliases"]
    assert created["Open 25"]["StoreCount"] == 282 and created["Open 25"]["IsKeyAccount"] is False
    assert created["Mckio"]["IsKeyAccount"] is False and created["Mckio"]["StoreCount"] is None
    assert "Maxikiosco" not in created
    assert {c["Name"] for c in plan["chains_create"] if c["Kind"] == "bandera"} == set(m.BANDERAS)
    assert len([c for c in plan["chains_create"] if c["IsKeyAccount"]]) == 11

    ch = {c["PdvId"]: c for c in plan["pdv_changes"]}
    assert set(ch) == {1, 2, 3, 5, 6}                       # 4 (Maxikiosco), 7 y 8 no se tocan
    assert (ch[1]["chain"], ch[2]["chain"], ch[3]["chain"]) == ("Tommy Shop", "Tommy Shop", "Mckio")
    assert (ch[5]["chain"], ch[5]["origin"], ch[6]["chain"], ch[6]["origin"]) == ("365", "CAD-*", "The Best", "reusado")
    assert all(c["after"]["ChannelId"] == 22 and c["after"]["Channel"] == "Cadenas de Proximidad" for c in ch.values())
    assert (ch[1]["bucket"], ch[3]["bucket"], ch[5]["bucket"]) == ("mediana", "chica", "grande")
    assert ch[3]["after"]["SubChannelId"] == 1               # "Chica" ya existía
    assert {s["key"] for s in plan["subs_create"]} == {"mediana", "grande"}
    assert {s["Name"] for s in plan["subs_deactivate"]} == {"Tomyshop", "Tommy's shop", "Mckio"}
    assert [(s["Name"], s["pdvs_restantes"]) for s in plan["subs_blocked"]] == [("Key Accounts/Cuentas Claves", 1)]
    assert [p["PdvId"] for p in plan["no_chain_22"]] == [4, 8]
    assert m.has_changes(plan)


def test_possible_duplicates_are_listed_not_merged():
    pairs = m.possible_duplicates(["24/7", "24.7 El Point", "Mckio", "Tarzan", "Drugstore Argentina", "Oeste Drugstore"])
    assert ("24/7", "24.7 El Point") in pairs
    assert not any("Mckio" in p or "Tarzan" in p for p in pairs)


def test_review_suggestions():
    chains = [{"Name": "Tommy Shop", "Aliases": "Tomyshop, Tommy's shop"}, {"Name": "365", "Aliases": None},
              {"Name": "Mckio", "Aliases": None}]
    mt = rv.build_matchers(chains)
    pats = [(n, p) for n, _c, p, _a in m.KEY_ACCOUNT_CHAINS]
    assert rv.suggest("Kiosco Tommy's Shop Belgrano", mt, pats)[:2] == ("Tommy Shop", "alta")
    assert rv.suggest('Kiosco "MCKIO" (cadena)', mt, pats)[:2] == ("Mckio", "alta")
    assert rv.suggest("Drugstore 365 Palermo", mt, pats)[:2] == ("365", "media")
    assert rv.suggest("Av. Rivadavia 13650", mt, pats)[0] is None           # 365 dentro de otro número
    assert rv.suggest("Kiosco Pepe (cadena de kioscos)", mt, pats)[:2] == (None, "baja")
    assert rv.suggest("Almacén Encadenados", mt, pats) == (None, None, "")


# ── Regresiones de la revisión 2026-11-19 ────────────────────────────

def _mini_state(subs, pdvs, chains=()):
    return {"ids": {"chain_channel": 22, "station_channel": 4, "legacy_ka_subchannel": 62, "account_manager": 149},
            "channel_names": {9: "Convenience", 22: "Cadenas de Proximidad", 4: "Estación de Servicio"},
            "subchannels": subs, "chains": list(chains), "pdvs": pdvs}


def _p(i, name, ch, sub, code=None, chain=None):
    return {"PdvId": i, "Code": code, "Name": name, "Channel": "x", "ChannelId": ch, "SubChannelId": sub,
            "ChainId": chain, "IsActive": True}


def test_inactive_chain_subchannel_with_pdvs_creates_its_chain():
    """H2: subcanal INACTIVO con nombre de cadena y PDVs → la cadena se crea (antes: KeyError en --commit)."""
    st = _mini_state(
        [{"SubChannelId": 90, "ChannelId": 22, "Name": "Kiosco Pepe", "IsActive": False},
         {"SubChannelId": 91, "ChannelId": 22, "Name": "Cadena Fantasma", "IsActive": False}],   # sin PDVs
        [_p(1, "Pepe 1", 22, 90)])
    plan = m.build_plan(st, {"pdvs": [], "reused": []})
    created = {c["Name"] for c in plan["chains_create"]}
    assert "Kiosco Pepe" in created and "Cadena Fantasma" not in created
    assert [(c["PdvId"], c["chain"]) for c in plan["pdv_changes"]] == [(1, "Kiosco Pepe")]
    assert [(s["SubChannelId"], s["pdvs"]) for s in plan["inactive_subs_with_pdvs"]] == [(90, 1)]


def test_plan_invariant_fails_in_dry_run_not_in_commit():
    ok = [{"PdvId": 1, "chain": "Tommy Shop"}]
    m.check_assignments(ok, {m.norm("Tommy Shop")})
    with pytest.raises(m.PlanError, match="Kiosco Pepe"):
        m.check_assignments(ok + [{"PdvId": 2, "chain": "Kiosco Pepe"}], {m.norm("Tommy Shop")})


@pytest.mark.parametrize("name,expected", [
    ("Chica", "chica"), ("Chica (menos de 10 PDVs)", "chica"), ("Mediana(11 a 30)", "mediana"),
    ("GRANDE (más de 30 PDVs)", "grande"), ("Chicago Kiosco", None), ("Grande Almacen", None), ("Medianas", None),
])
def test_bucket_subchannel_is_matched_exactly(name, expected):
    """M2 — y la regla es la misma que usa el server."""
    from app.services import chains as svc
    assert m.is_bucket_subchannel(name) == expected == svc.bucket_key(name)


def test_lookalike_subchannels_are_chains_not_buckets():
    st = _mini_state(
        [{"SubChannelId": 70, "ChannelId": 22, "Name": "Chicago Kiosco", "IsActive": True},
         {"SubChannelId": 71, "ChannelId": 22, "Name": "Chica (menos de 10 PDVs)", "IsActive": True}],
        [_p(1, "Chicago 1", 22, 70)])
    plan = m.build_plan(st, {"pdvs": [], "reused": []})
    assert "Chicago Kiosco" in {c["Name"] for c in plan["chains_create"]}
    assert plan["bucket_subchannels"]["chica"]["SubChannelId"] == 71
    assert plan["bucket_subchannels"]["grande"]["estado"] == "SE CREA"
    assert plan["pdv_changes"][0]["after"]["SubChannelId"] == 71


def test_reused_pdv_conflict_subchannel_wins_and_is_reported():
    """M3: reusado cuyo subcanal dice Mckio y cuyo nombre matchea el regex de Tommy → gana el subcanal."""
    st = _mini_state(
        [{"SubChannelId": 4, "ChannelId": 22, "Name": "Mckio", "IsActive": True}],
        [_p(6, "Mckio ex Tommy shop", 22, 4), _p(7, "365 - LAVALLE 1", 22, 4, code="CAD-01-001")])
    plan = m.build_plan(st, {"pdvs": [{"PdvId": 7}], "reused": [{"PdvId": 6, "Name": "Tommy"}]})
    ch = {c["PdvId"]: c for c in plan["pdv_changes"]}
    assert (ch[6]["chain"], ch[6]["origin"]) == ("Mckio", "subcanal")
    assert (ch[7]["chain"], ch[7]["origin"]) == ("365", "CAD-*")          # CAD-*: gana el import
    conf = {c["PdvId"]: c for c in plan["conflicts"]}
    assert conf[6]["gana"] == "Mckio" and conf[6]["por_import"] == "Tommy Shop" and conf[6]["criterio"] == "subcanal"
    assert conf[7]["gana"] == "365" and conf[7]["criterio"] == "import"
    rows = rv.conflict_rows(plan["conflicts"])
    assert len(rows) == 2 and len(rows[0]) == len(rv.CONFLICT_COLUMNS)


class _Env:
    def __init__(self, **kw):
        self.database_url, self.use_sqlite, self.database_user, self.database_password = None, False, "", ""
        self.__dict__.update(kw)


def test_env_selection_must_be_unambiguous():
    """M4: una sola señal de qué base usar."""
    assert ops.env_problems(_Env()) == []
    assert ops.env_problems(_Env(database_url="sqlite:///x.db")) == []
    assert ops.env_problems(_Env(use_sqlite=True)) == []
    assert ops.env_problems(_Env(database_user="u", database_password="p")) == []
    assert ops.env_problems(_Env(use_sqlite=True, database_user="u", database_password="p"))
    assert ops.env_problems(_Env(database_url="sqlite:///x.db", database_user="u", database_password="p"))
    assert ops.env_problems(_Env(database_url="sqlite:///x.db", use_sqlite=True)) == []   # las dos dicen SQLite
    assert ops.env_problems(_Env(database_url="mssql+pymssql://u:p@srv/db", use_sqlite=True))
    assert ops.env_problems(_Env(database_user="u"))


def test_script_args_are_strict_and_dry_run_by_default(monkeypatch, capsys):
    assert ddl.parse_args([]).commit is False
    assert ddl.parse_args(["--commit", "--yes"]).commit is True
    for bad in (["--comit"], ["--commit", "--dry-run"], ["algo"]):
        with pytest.raises(SystemExit):
            ddl.parse_args(bad)
    assert m.parse_args([]).commit is False
    for bad in (["--comit"], ["--commit"], ["--commit", "--dry-run", "--plan-json", "x.json"]):
        with pytest.raises(SystemExit):   # --commit sin --plan-json no corre
            m.parse_args(bad)
    # el DDL no hace nada fuera de SQL Server (misma resolución de base que la migración)
    monkeypatch.setattr(ops, "resolve_target_or_exit",
                        lambda mode: {"kind": "sqlite", "server": "(archivo local)", "database": "x.db", "label": "sqlite"})
    assert ddl.main(["--commit", "--yes"]) == 2
    assert "solo para SQL Server" in capsys.readouterr().out


def test_set_lock_timeout_only_on_sql_server():
    class _Dialect:
        def __init__(self, name): self.name = name
    class _Conn:
        def __init__(self, name): self.dialect, self.sql = _Dialect(name), []
        def execute(self, stmt): self.sql.append(str(stmt))
    lite, ms = _Conn("sqlite"), _Conn("mssql")
    assert ops.set_lock_timeout(lite) is False and lite.sql == []
    assert ops.set_lock_timeout(ms) is True and ms.sql == [f"SET LOCK_TIMEOUT {ops.LOCK_TIMEOUT_MS}"]


def test_confirmation_needs_tty_or_yes(monkeypatch):
    target = {"kind": "mssql", "server": "s", "database": "trademktdb", "label": "x"}
    ops.confirm_or_exit(target, True, "x")                      # --yes
    monkeypatch.setattr(sys.stdin, "isatty", lambda: False, raising=False)
    with pytest.raises(SystemExit):
        ops.confirm_or_exit(target, False, "x")
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True, raising=False)
    monkeypatch.setattr("builtins.input", lambda _p: "otra")
    with pytest.raises(SystemExit):
        ops.confirm_or_exit(target, False, "x")
    monkeypatch.setattr("builtins.input", lambda _p: "trademktdb")
    ops.confirm_or_exit(target, False, "x")


# ── apply_plan + rollback de punta a punta (SQLite temporal) ──

@pytest.fixture()
def mig_db(tmp_path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.models  # noqa: F401  (registra todas las tablas)
    from app.database import Base
    from app.models import PDV, Channel, SubChannel, User
    from app.models.mandatory_activity import MandatoryActivity

    eng = create_engine(f"sqlite:///{tmp_path / 'mig.db'}")
    Base.metadata.create_all(eng)
    db = sessionmaker(bind=eng, autoflush=False)()
    db.add_all([Channel(ChannelId=9, Name="Convenience"), Channel(ChannelId=22, Name="Cadenas de Proximidad"),
                Channel(ChannelId=23, Name="Estación de Servicio")])
    db.add(User(UserId=149, Email="sg@x.test", DisplayName="Santiago Gallastegui", IsActive=True))
    db.flush()
    for sid, ch, name, active in [
        (1, 22, "Chica (menos de 10 PDVs)", True), (2, 22, "Tomyshop", True), (3, 22, "Tommy's shop", True),
        (4, 22, "Mckio", True), (5, 22, "Maxikiosco", True), (6, 22, "Chicago Kiosco", True),
        (7, 22, "Kiosco Pepe", False), (62, 9, "Key Accounts/Cuentas Claves", True), (63, 9, "Kiosco", True),
    ]:
        db.add(SubChannel(SubChannelId=sid, ChannelId=ch, Name=name, IsActive=active))
    rows = [(1, "Tomy 1", 22, 2, None), (2, "Tommy 2", 22, 3, None), (3, "Mckio 1", 22, 4, None),
            (4, "Maxi", 22, 5, None), (5, "365 - LAVALLE 1471", 9, 62, "CAD-01-012"),
            (6, "Maxikiosco The Best (cadena)", 9, 63, None), (7, "Kiosco a mano", 9, 62, None),
            (8, "Chicago 1", 22, 6, None), (9, "Pepe 1", 22, 7, None)]
    for pid, name, ch, sub, code in rows:
        db.add(PDV(PdvId=pid, Code=code or f"P-{pid}", Name=name, Channel="Convenience" if ch == 9 else "Cadenas de Proximidad",
                   ChannelId=ch, SubChannelId=sub, IsActive=True))
    db.add(MandatoryActivity(Name="Canje KA", ActionType="canje_sueltos", ChannelId=9, PhotoRequired=True, IsActive=True))
    db.add(MandatoryActivity(Name="Vieja", ActionType="pop", ChannelId=22, PhotoRequired=True, IsActive=False))
    db.commit()
    yield db
    db.close()


LOG = {"pdvs": [{"PdvId": 5}], "reused": [{"PdvId": 6, "Name": "The Best"}]}
TARGET = {"kind": "sqlite", "server": "(archivo local)", "database": "mig.db", "label": "sqlite · mig.db"}


def _snapshot(db):
    from app.models import PDV
    return {r.PdvId: (r.ChannelId, r.Channel, r.SubChannelId, r.ChainId)
            for r in db.query(PDV.PdvId, PDV.ChannelId, PDV.Channel, PDV.SubChannelId, PDV.ChainId).all()}


def test_commit_blockers_plan_hash_and_mandatory_activities(mig_db, tmp_path):
    """M1 + M4: sin el plan revisado, con un plan viejo o sin el ack, no se aplica."""
    state = m.load_state(mig_db, skip_id_check=False)      # ids 22 / 9 / 62 / 149 = los esperados de prod
    plan = m.build_plan(state, LOG)
    assert [(a["Name"], a["ChannelId"]) for a in plan["mandatory_activities"]] == [("Canje KA", 9)]
    assert plan["moved_from_channel"] == {"9": 2}

    plan_file = tmp_path / "plan.json"
    args = m.parse_args(["--commit", "--plan-json", str(plan_file)])
    assert "no existe" in m.commit_blockers(args, plan, TARGET)[0]

    import json
    plan_file.write_text(json.dumps({"plan_hash": m.plan_fingerprint(plan, TARGET), "target": TARGET}))
    blockers = m.commit_blockers(args, plan, TARGET)
    assert len(blockers) == 1 and "--ack-mandatory-activities" in blockers[0]
    acked = m.parse_args(["--commit", "--plan-json", str(plan_file), "--ack-mandatory-activities"])
    assert m.commit_blockers(acked, plan, TARGET) == []
    # mismo plan pero OTRA base → no vale
    other = {**TARGET, "server": "trade-mkt-sql.database.windows.net", "database": "trademktdb", "kind": "mssql"}
    assert "NO es el que se revisó" in m.commit_blockers(acked, plan, other)[0]
    # la base cambió después del dry-run → el plan de hoy difiere del revisado
    from app.models import PDV
    mig_db.query(PDV).filter(PDV.PdvId == 4).update({PDV.SubChannelId: 4})
    mig_db.commit()
    plan2 = m.build_plan(m.load_state(mig_db, skip_id_check=False), LOG)
    assert "NO es el que se revisó" in m.commit_blockers(acked, plan2, TARGET)[0]


def test_apply_plan_then_rollback_end_to_end(mig_db, tmp_path):
    import json

    from app.models import PDV, SubChannel
    from app.models.audit import AuditEvent
    from app.models.chain import Chain

    db = mig_db
    before = _snapshot(db)
    state = m.load_state(db, skip_id_check=False)
    plan = m.build_plan(state, LOG)
    backup_path = tmp_path / "backup.json"
    backup = m.apply_plan(db, state, plan, backup_path)

    chains = {c.Name: c for c in db.query(Chain).all()}
    assert chains["Tommy Shop"].IsKeyAccount and chains["Tommy Shop"].AccountManagerUserId == 149
    assert {"Mckio", "Chicago Kiosco", "Kiosco Pepe", "365", "The Best", "YPF"} <= set(chains)   # H2: Kiosco Pepe existe
    subs = {s.SubChannelId: s for s in db.query(SubChannel).all()}
    bucket = {m.is_bucket_subchannel(s.Name): s.SubChannelId for s in subs.values() if m.is_bucket_subchannel(s.Name)}
    assert set(bucket) == {"chica", "mediana", "grande"} and bucket["chica"] == 1
    after = _snapshot(db)
    assert after[1] == (22, "Cadenas de Proximidad", bucket["mediana"], chains["Tommy Shop"].ChainId)   # 17 locales
    assert after[5] == (22, "Cadenas de Proximidad", bucket["grande"], chains["365"].ChainId)           # venía de canal 9
    assert after[6][3] == chains["The Best"].ChainId and after[8][3] == chains["Chicago Kiosco"].ChainId
    assert after[9] == (22, "Cadenas de Proximidad", 1, chains["Kiosco Pepe"].ChainId)
    assert after[4] == before[4] and after[7] == before[7]                     # Maxikiosco / KA a mano: intactos
    assert not subs[2].IsActive and not subs[4].IsActive and subs[5].IsActive  # cadenas off, Maxikiosco queda
    assert subs[62].IsActive                                                   # todavía lo usa el PDV 7
    changed = [pid for pid in before if before[pid] != after[pid]]
    assert sorted(changed) == [1, 2, 3, 5, 6, 8, 9]
    # auditoría: una fila por PDV (aunque el UPDATE sea por grupo) y por cadena creada
    ev = db.query(AuditEvent).filter(AuditEvent.Action == "PDV_CHAIN_CHANGE").all()
    assert sorted(int(e.EntityId) for e in ev) == sorted(changed)
    assert json.loads(ev[0].PayloadJson)["source"] == "migrate_chains_20261119"
    assert db.query(AuditEvent).filter(AuditEvent.Action == "CHAIN_CREATE").count() == len(backup["chains_created"])
    # el backup en disco quedó completo
    on_disk = json.loads(backup_path.read_text())
    assert sorted(p["PdvId"] for p in on_disk["pdvs"]) == sorted(changed) and len(on_disk["pdvs_after"]) == 7
    # nunca pisa un backup existente
    with pytest.raises(FileExistsError):
        m.apply_plan(db, state, plan, backup_path)
    db.rollback()
    # idempotente
    assert not m.has_changes(m.build_plan(m.load_state(db, skip_id_check=False), LOG))

    # ── después de la migración pasan cosas: un alta nueva con cadena y una edición a mano ──
    db.add(PDV(PdvId=50, Code="P-50", Name="Tommy nuevo", Channel="Cadenas de Proximidad", ChannelId=22,
               SubChannelId=bucket["mediana"], ChainId=chains["Tommy Shop"].ChainId, IsActive=True))
    db.query(PDV).filter(PDV.PdvId == 3).update({PDV.ChainId: chains["Chicago Kiosco"].ChainId})   # editado a mano
    db.commit()

    r = rb.rollback(db, on_disk, backup_name="backup.json")
    db.commit()
    final = _snapshot(db)
    assert [s[0] for s in r["skipped"]] == [3]                                  # editado después: no se pisa
    for pid in (1, 2, 5, 6, 8, 9):
        assert final[pid] == before[pid]
    assert final[3][3] == chains["Chicago Kiosco"].ChainId
    # H3: las cadenas creadas NO se borran, se desactivan; el PDV nuevo conserva su ChainId
    assert db.query(Chain).count() == len(chains)
    assert db.query(Chain).filter(Chain.ChainId.in_(on_disk["chains_created"]), Chain.IsActive == True).count() == 0  # noqa: E712
    assert final[50][3] == chains["Tommy Shop"].ChainId
    assert (chains["Tommy Shop"].ChainId, "Tommy Shop", 1) in r["still_linked"]
    subs = {s.SubChannelId: s for s in db.query(SubChannel).all()}
    assert subs[2].IsActive and subs[4].IsActive and not subs[7].IsActive       # reactivados; el 7 ya era inactivo
    assert subs[bucket["mediana"]].IsActive                                     # lo usa el PDV 50
    assert not subs[bucket["grande"]].IsActive                                  # creado y sin PDVs → off
    assert db.query(AuditEvent).filter(AuditEvent.Action == "CHAIN_ROLLBACK").count() == 1
    # --force restaura también el editado
    r2 = rb.rollback(db, on_disk, force=True)
    db.commit()
    assert r2["skipped"] == [] and _snapshot(db)[3] == before[3]
    # volver a migrar después del rollback: reactiva las mismas cadenas, no crea duplicadas
    plan3 = m.build_plan(m.load_state(db, skip_id_check=False), LOG)
    assert plan3["chains_create"] == [] and any(c["after"].get("IsActive") for c in plan3["chains_update"])


def test_apply_plan_reverts_if_db_changed_under_it(mig_db, tmp_path):
    """Guarda de concurrencia: si a un PDV le pusieron cadena entre el plan y el UPDATE, no cierra la cuenta."""
    from app.models import PDV
    from app.models.chain import Chain
    db = mig_db
    state = m.load_state(db, skip_id_check=False)
    plan = m.build_plan(state, LOG)
    db.add(Chain(ChainId=900, Name="Ajena", ChannelId=22, Kind="cadena"))
    db.query(PDV).filter(PDV.PdvId == 1).update({PDV.ChainId: 900})
    db.commit()
    with pytest.raises(m.PlanError, match="cambió durante la migración"):
        m.apply_plan(db, state, plan, tmp_path / "b.json")
    db.rollback()
    assert db.query(Chain).count() == 1 and _snapshot(db)[2][3] is None
