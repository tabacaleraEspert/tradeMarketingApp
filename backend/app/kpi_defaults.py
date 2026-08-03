"""Datos default de configuración de KPIs del tablero TMR (docs/tablero-tmr-diseno.md §3-4).

Módulo único de datos + función idempotente `apply_kpi_defaults(session)`, usado desde
`seed_db.py` (dev, vía ORM) y desde la migración `0021_kpi_config` (los valores planos
se reusan ahí para el seed inicial vía `sa.table`/`op.bulk_insert`).
"""
from datetime import date

# Los 5 KPIs de la variable mensual (§3 del diseño). Weight en % (suman 100), Target en %.
KPI_DEFINITIONS = [
    {
        "key": "cobertura_skus",
        "name": "Cobertura de SKUs prioritarios",
        "description": "PDVs de ruta foco con calificación de cobertura >= Bueno (rúbrica de cobertura).",
        "weight": 30,
        "target": 80,
    },
    {
        "key": "efectividad_visitas",
        "name": "Efectividad de visitas",
        "description": "PDVs con visita efectiva (cobertura + POP + >=1 acción) el día planificado.",
        "weight": 10,
        "target": 90,
    },
    {
        "key": "penetracion_sueltos",
        "name": "Penetración venta de sueltos",
        "description": "PDVs que venden sueltos con >=1 canje en el mes.",
        "weight": 10,
        "target": 50,
    },
    {
        "key": "pop_colocado",
        "name": "Colocación de material POP",
        "description": "PDVs de ruta foco con calificación de comunicación >= Bueno y foto tomada desde la app.",
        "weight": 30,
        "target": 70,
    },
    {
        "key": "activaciones_promo",
        "name": "Activaciones promocionales",
        "description": "PDVs de ruta foco con >=1 promo activada en el mes.",
        "weight": 20,
        "target": 40,
    },
]

# Rúbrica de cobertura por marca y nivel (planilla "Ejecución", §4 del diseño).
# Las celdas marcadas con * en la planilla original eran combinadas/ambiguas; se
# interpretaron con el valor de la celda combinada tal cual quedó definido en el
# plan de fase 1 (docs/tablero-tmr-plan-fase1.md, tarea T1):
#   - Melbourne Bueno/Regular (celda combinada "1*") -> 1/1
#   - Bold Bueno/Regular (celda combinada "*") -> 0/0 (sin mínimo propio, cubierto por el total)
#   - Van Kiff Regular (celda combinada "1*") -> 1 (se toma el valor de Regular; el "No cuenta"=1
#     de la planilla original no se modela como fila propia de marca, ídem otras marcas)
#   - Lebonn Regular (celda combinada "*") -> 0
# "No cuenta" solo se modela para las filas de total (Total cigs / Total tabacos); las marcas
# individuales no tienen fila propia de "no_cuenta" en la planilla.
# (Brand, Level, MinSkus)
COVERAGE_RULES = [
    ("Milenio", "excelente", 4),
    ("Milenio", "muy_bueno", 3),
    ("Milenio", "bueno", 3),
    ("Milenio", "regular", 1),
    ("Mill", "excelente", 2),
    ("Mill", "muy_bueno", 2),
    ("Mill", "bueno", 1),
    ("Mill", "regular", 1),
    ("Melbourne", "excelente", 1),
    ("Melbourne", "muy_bueno", 1),
    ("Melbourne", "bueno", 1),
    ("Melbourne", "regular", 1),
    ("Bold", "excelente", 1),
    ("Bold", "muy_bueno", 1),
    ("Bold", "bueno", 0),
    ("Bold", "regular", 0),
    ("Total cigs", "excelente", 8),
    ("Total cigs", "muy_bueno", 7),
    ("Total cigs", "bueno", 5),
    ("Total cigs", "regular", 3),
    ("Total cigs", "no_cuenta", 2),
    ("Van Kiff", "excelente", 4),
    ("Van Kiff", "muy_bueno", 3),
    ("Van Kiff", "bueno", 2),
    ("Van Kiff", "regular", 1),
    ("Lebonn", "excelente", 1),
    ("Lebonn", "muy_bueno", 1),
    ("Lebonn", "bueno", 1),
    ("Lebonn", "regular", 0),
    ("Total tabacos", "excelente", 5),
    ("Total tabacos", "muy_bueno", 4),
    ("Total tabacos", "bueno", 3),
    ("Total tabacos", "regular", 1),
    ("Total tabacos", "no_cuenta", 1),
]

# Rúbrica de comunicación: elementos POP mínimos por nivel (§4 del diseño). MaterialType
# "total" representa la cuenta agregada de elementos (el detalle por tipo de material
# queda para un alta por UI posterior, fuera de esta tarea).
# (MaterialType, Level, Required, MinElements)
COMMUNICATION_RULES = [
    ("total", "excelente", None, 4),
    ("total", "muy_bueno", None, 3),
    ("total", "bueno", None, 2),
    ("total", "regular", None, 1),
]


def apply_kpi_defaults(session) -> None:
    """Inserta la config default de KPIs si todavía no existe (idempotente).

    Scope `global`, vigente desde el primer día del mes actual, sin usuario de
    auditoría (seed de sistema).
    """
    from .models import KpiDefinition, KpiConfig, ScoringCoverageRule, ScoringCommunicationRule

    valid_from = date.today().replace(day=1)

    kpi_by_key = {}
    for kpi in KPI_DEFINITIONS:
        existing = session.query(KpiDefinition).filter(KpiDefinition.KpiKey == kpi["key"]).first()
        if not existing:
            existing = KpiDefinition(
                KpiKey=kpi["key"],
                Name=kpi["name"],
                Description=kpi["description"],
                IsActive=True,
            )
            session.add(existing)
            session.flush()
        kpi_by_key[kpi["key"]] = existing

    if session.query(KpiConfig).first() is None:
        for kpi in KPI_DEFINITIONS:
            session.add(KpiConfig(
                KpiDefinitionId=kpi_by_key[kpi["key"]].KpiDefinitionId,
                Weight=kpi["weight"],
                Target=kpi["target"],
                ScopeType="global",
                ScopeId=None,
                ValidFrom=valid_from,
                ValidTo=None,
                CreatedByUserId=None,
            ))

    if session.query(ScoringCoverageRule).first() is None:
        for brand, level, min_skus in COVERAGE_RULES:
            session.add(ScoringCoverageRule(
                Brand=brand,
                ProductGroupJson=None,
                Level=level,
                MinSkus=min_skus,
                ScopeType="global",
                ScopeId=None,
                ValidFrom=valid_from,
                ValidTo=None,
                CreatedByUserId=None,
            ))

    if session.query(ScoringCommunicationRule).first() is None:
        for material_type, level, required, min_elements in COMMUNICATION_RULES:
            session.add(ScoringCommunicationRule(
                MaterialType=material_type,
                Level=level,
                Required=required,
                MinElements=min_elements,
                ScopeType="global",
                ScopeId=None,
                ValidFrom=valid_from,
                ValidTo=None,
                CreatedByUserId=None,
            ))

    session.commit()
