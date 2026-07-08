-- SSO Command Center: tabla de jti consumidos (tickets de un solo uso).
-- Prod NO está alembic-tracked → aplicar este SQL quirúrgico en Azure SQL
-- (equivale a la migración 0020_sso_used_jti.py).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SsoUsedJti')
BEGIN
    CREATE TABLE SsoUsedJti (
        Jti NVARCHAR(64) NOT NULL PRIMARY KEY,
        ExpiresAt DATETIME2 NOT NULL,
        UsedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
