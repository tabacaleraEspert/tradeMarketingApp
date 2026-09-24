"""Hotfix prod 2026-09-24: tablas del reporte de comportamiento por mail (migración 0024).

Prod no está trackeado por Alembic — replica 0024_behavior_report.py:
  1. CREATE TABLE BehaviorReportSubscription (+ índice UserId).
  2. CREATE TABLE BehaviorReport (+ índice SubscriptionId + único filtrado
     (SubscriptionId, Kind, PeriodFrom) WHERE Kind <> 'test').

CORRER ANTES del deploy del backend (el ABM y el cron consultan estas tablas).
Son tablas nuevas: el resto de la app no se ve afectado.

Credenciales: DATABASE_SERVER / DATABASE_NAME / DATABASE_USER / DATABASE_PASSWORD
del entorno o de backend/.env (mismo `Settings` que la app). No se hardcodean.
Idempotente. Uso (desde backend/): python scripts/hotfix_behavior_report_prod_20260924.py [--dry-run]
"""
import sys
from pathlib import Path

import pymssql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings

DDL = [
    ("BehaviorReportSubscription", [
        """CREATE TABLE BehaviorReportSubscription (
            SubscriptionId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            Email NVARCHAR(256) NOT NULL,
            Name NVARCHAR(120) NOT NULL,
            Scope NVARCHAR(10) NOT NULL,
            ScopeUserId INT NULL REFERENCES [User](UserId),
            TradeIds NVARCHAR(MAX) NULL,
            WeeklyEnabled BIT NOT NULL,
            MonthlyEnabled BIT NOT NULL,
            IsActive BIT NOT NULL,
            AutoCreated BIT NOT NULL,
            UserId INT NULL REFERENCES [User](UserId),
            CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
        )""",
        "CREATE INDEX ix_BehaviorReportSubscription_UserId ON BehaviorReportSubscription(UserId)",
    ]),
    ("BehaviorReport", [
        """CREATE TABLE BehaviorReport (
            ReportId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            Token NVARCHAR(64) NOT NULL UNIQUE,
            SubscriptionId INT NULL REFERENCES BehaviorReportSubscription(SubscriptionId),
            Kind NVARCHAR(10) NOT NULL,
            PeriodFrom DATE NOT NULL,
            PeriodTo DATE NOT NULL,
            Email NVARCHAR(256) NOT NULL,
            Payload NVARCHAR(MAX) NOT NULL,
            ExpiresAt DATETIME2 NOT NULL,
            SentAt DATETIME2 NULL,
            SendError NVARCHAR(1000) NULL,
            CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
        )""",
        "CREATE INDEX ix_BehaviorReport_SubscriptionId ON BehaviorReport(SubscriptionId)",
        "CREATE UNIQUE INDEX ux_BehaviorReport_period ON BehaviorReport(SubscriptionId, Kind, PeriodFrom) WHERE Kind <> 'test'",
    ]),
]


def main(dry_run: bool):
    if not (settings.database_user and settings.database_password):
        sys.exit("Faltan DATABASE_USER / DATABASE_PASSWORD (env o backend/.env)")
    conn = pymssql.connect(
        server=settings.database_server, user=settings.database_user,
        password=settings.database_password, database=settings.database_name, login_timeout=90,
    )
    cur = conn.cursor()
    for table, stmts in DDL:
        cur.execute("SELECT COUNT(*) FROM sys.tables WHERE name = %s", (table,))
        if cur.fetchone()[0]:
            print(f"{table} ya existe — salto")
            continue
        for stmt in stmts:
            if dry_run:
                print(f"[dry-run] {stmt}")
            else:
                cur.execute(stmt)
        if not dry_run:
            conn.commit()
            print(f"{table} creada")
    conn.close()


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
