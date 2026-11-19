"""Rollback de scripts/migrate_chains_20261119.py a partir de su backup JSON.

Deshace, en UNA transacción y en orden inverso:
  1. Reactiva los subcanales que la migración desactivó (y vuelve a desactivar los
     que reactivó).
  2. Restaura PDV.ChannelId / Channel / SubChannelId / ChainId SOLO de las filas del
     backup (las que la migración tocó). Si un PDV fue editado DESPUÉS de la migración
     (ya no tiene la cadena que le puso la migración) se informa y NO se pisa, salvo --force.
     Los PDVs que NO están en el backup no se tocan: los dados de alta después con
     una cadena creada por la migración conservan su ChainId.
  3. Restaura los atributos de las cadenas que la migración actualizó.
  4. Cadenas CREADAS por la migración: se DESACTIVAN (nunca se borran: puede haber PDVs
     nuevos y auditoría que las referencian, y teléfonos con altas en cola que las
     mandan). Subcanales de tamaño creados: se desactivan si ningún PDV los usa.
     Efecto: sin cadenas activas el canal deja de exigir cadena → la app vuelve a
     comportarse como antes de la migración.
  5. Actividades obligatorias que la migración CLONÓ al canal de cadenas: se desactivan
     (no se borran: las VisitAction ya sembradas las referencian). Las que reactivó
     vuelven a quedar inactivas. Las originales nunca se tocaron.
Los AuditEvent de la migración NO se borran (append-only); se agrega un evento de rollback.
Re-ejecutar la migración después de un rollback reactiva esas mismas cadenas (idempotente).

Base = misma resolución que la migración (chains_ops_20261119.py): imprime servidor y
base, corta si el entorno es ambiguo, pide confirmación tipeada en --commit (--yes la
saltea). SET LOCK_TIMEOUT 15 s en SQL Server. Correr fuera de horario.
Uso (desde backend/): python scripts/rollback_chains_20261119.py backup_migrate_chains_<ts>.json [--commit] [--force] [--yes]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import chains_ops_20261119 as ops  # noqa: E402

SOURCE = "rollback_chains_20261119"


def rollback(db, backup: dict, *, force: bool = False, backup_name: str = "") -> dict:
    """Aplica el rollback en la sesión (sin commit). Devuelve el resumen."""
    from app.models import PDV, SubChannel
    from app.models.audit import AuditEvent
    from app.models.chain import Chain

    ch22 = backup["ids"]["chain_channel"]
    created_chains = set(backup["chains_created"])
    after_by_pdv = backup.get("pdvs_after") or {}
    # 1. subcanales
    for sid in backup["subchannels_deactivated"]:
        db.query(SubChannel).filter(SubChannel.SubChannelId == sid).update({SubChannel.IsActive: True})
    for sid in backup.get("subchannels_activated", []):
        db.query(SubChannel).filter(SubChannel.SubChannelId == sid).update({SubChannel.IsActive: False})

    # 2. PDVs
    restored, skipped, missing = 0, [], []
    current = {r.PdvId: r for r in db.query(PDV.PdvId, PDV.ChannelId, PDV.ChainId, PDV.Name)
               .filter(PDV.PdvId.in_([p["PdvId"] for p in backup["pdvs"]])).all()} if backup["pdvs"] else {}
    # cadenas pre-existentes a las que la migración apuntó PDVs también cuentan como "estado migrado"
    for p in backup["pdvs"]:
        cur = current.get(p["PdvId"])
        if cur is None:
            missing.append(p["PdvId"])
            continue
        migrated = after_by_pdv.get(str(p["PdvId"]))
        if migrated is not None:   # backup nuevo: sabemos exactamente qué cadena dejó la migración
            untouched = cur.ChannelId == ch22 and cur.ChainId == migrated["ChainId"]
        else:
            untouched = cur.ChannelId == ch22 and cur.ChainId is not None
        if not untouched and not force:
            skipped.append((p["PdvId"], cur.Name))
            continue
        db.query(PDV).filter(PDV.PdvId == p["PdvId"]).update({
            PDV.ChannelId: p["ChannelId"], PDV.Channel: p["Channel"],
            PDV.SubChannelId: p["SubChannelId"], PDV.ChainId: p["ChainId"],
        }, synchronize_session=False)
        restored += 1
    db.flush()

    # 3. cadenas actualizadas
    for c in backup["chains_updated"]:
        row = db.query(Chain).filter(Chain.ChainId == c["ChainId"]).first()
        if row is not None:
            for k, v in c["before"].items():
                setattr(row, k, v)
    db.flush()

    # 4. cadenas / subcanales creados: se DESACTIVAN, nunca se borran
    deactivated = []
    for cid in sorted(created_chains):
        row = db.query(Chain).filter(Chain.ChainId == cid).first()
        if row is None:
            continue
        left = db.query(PDV.PdvId).filter(PDV.ChainId == cid).count()
        if row.IsActive:
            row.IsActive = False
        deactivated.append((cid, row.Name, left))
    subs_off, subs_kept = [], []
    for sid in backup["subchannels_created"]:
        left = db.query(PDV.PdvId).filter(PDV.SubChannelId == sid).count()
        if left:
            subs_kept.append((sid, left))
        else:
            db.query(SubChannel).filter(SubChannel.SubChannelId == sid).update({SubChannel.IsActive: False})
            subs_off.append(sid)
    still_linked = [d for d in deactivated if d[2]]

    # 5. actividades obligatorias clonadas / reactivadas por la migración
    from app.models.mandatory_activity import MandatoryActivity
    ma_ids = list(backup.get("mandatory_created", [])) + list(backup.get("mandatory_reactivated", []))
    ma_off = 0
    if ma_ids:
        ma_off = (db.query(MandatoryActivity)
                  .filter(MandatoryActivity.MandatoryActivityId.in_(ma_ids), MandatoryActivity.IsActive == True)  # noqa: E712
                  .update({MandatoryActivity.IsActive: False}, synchronize_session=False))

    db.add(AuditEvent(UserId=None, Entity="Chain", EntityId="0", Action="CHAIN_ROLLBACK", PayloadJson=json.dumps({
        "source": SOURCE, "backup": backup_name, "pdvsRestored": restored,
        "pdvsSkipped": [s[0] for s in skipped], "chainsDeleted": 0,
        "chainsDeactivated": [d[0] for d in deactivated], "mandatoryDeactivated": ma_ids,
    }, ensure_ascii=False)))
    db.flush()
    return {"restored": restored, "skipped": skipped, "missing": missing, "deactivated": deactivated,
            "still_linked": still_linked, "subs_off": subs_off, "subs_kept": subs_kept, "mandatory_off": ma_off}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("backup")
    ap.add_argument("--commit", action="store_true", help="Aplica (default: dry-run)")
    ap.add_argument("--force", action="store_true", help="Restaura también PDVs editados después de la migración")
    ap.add_argument("--yes", action="store_true", help="No pide la confirmación tipeada (uso no interactivo)")
    args = ap.parse_args(argv)

    backup = json.loads(Path(args.backup).read_text())
    if backup.get("script") != "migrate_chains_20261119":
        sys.exit("El archivo no es un backup de migrate_chains_20261119")
    target = ops.resolve_target_or_exit("COMMIT (escribe)" if args.commit else "DRY-RUN (no escribe nada)")
    print(f"Backup del {backup['created']}: {len(backup['pdvs'])} PDVs, {len(backup['chains_created'])} cadenas creadas, "
          f"{len(backup['subchannels_deactivated'])} subcanales desactivados")
    if args.commit:
        ops.confirm_or_exit(target, args.yes, "revertir la migración de cadenas")

    from app.database import SessionLocal
    db = SessionLocal()
    try:
        ops.set_lock_timeout(db)
        r = rollback(db, backup, force=args.force, backup_name=Path(args.backup).name)
        restored, skipped, missing = r["restored"], r["skipped"], r["missing"]

        print(f"\nPDVs restaurados: {restored} · salteados por edición posterior: {len(skipped)} · ya no existen: {len(missing)}")
        for pid, name in skipped[:40]:
            print(f"   ! {pid} {name} (usar --force para restaurarlo igual)")
        print(f"Cadenas desactivadas (no se borran): {len(r['deactivated'])} · de esas, todavía con PDVs "
              f"(altas/ediciones posteriores, conservan su cadena): {r['still_linked'] or 'ninguna'}")
        print(f"Actividades obligatorias clonadas/reactivadas por la migración que se desactivan: {r['mandatory_off']}")
        print(f"Subcanales reactivados: {len(backup['subchannels_deactivated'])} · de tamaño desactivados: "
              f"{len(r['subs_off'])} · conservados activos (con PDVs): {r['subs_kept'] or 'ninguno'}")
        if args.commit:
            db.commit()
            print("\nROLLBACK APLICADO.")
        else:
            db.rollback()
            print("\nDRY-RUN: no se escribió nada. Corré con --commit.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
