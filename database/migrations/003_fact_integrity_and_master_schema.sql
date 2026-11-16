-- ============================================================================
-- Migration 003: Fact Integrity & Master Schema Migration (Consolidated)
-- Description: Master schema consolidation for WP13.
--              Adds Documents lifecycle & governance columns, FinancialFacts identity
--              and location hashing with unique index, FactConflicts retry/reissue columns,
--              EntityAliases table, MetricAliases seed (IFRS + HR terms in English and Arabic),
--              per-entity FiscalYearStartMonth, and historical row backfills.
-- Work Package: WP13
-- Date: 2026-11-16
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extend dbo.Entities with FiscalYearStartMonth
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Entities') AND name = 'FiscalYearStartMonth')
BEGIN
    ALTER TABLE dbo.Entities ADD FiscalYearStartMonth INT NOT NULL DEFAULT 1;
END;

-- ----------------------------------------------------------------------------
-- 2. Create dbo.EntityAliases Table
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'EntityAliases')
BEGIN
    CREATE TABLE dbo.EntityAliases (
        AliasId BIGINT IDENTITY(1,1) PRIMARY KEY,
        EntityId BIGINT NOT NULL FOREIGN KEY REFERENCES dbo.Entities(EntityId),
        AliasText NVARCHAR(200) NOT NULL,
        LanguageCode NVARCHAR(10) NOT NULL DEFAULT 'en',
        IsApproved BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX UX_EntityAliases_Alias_Lang ON dbo.EntityAliases(AliasText, LanguageCode);
    CREATE INDEX IX_EntityAliases_EntityId ON dbo.EntityAliases(EntityId);
END;

-- ----------------------------------------------------------------------------
-- 3. Extend dbo.Documents (Consolidated Evolution)
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'ContentHash')
BEGIN
    ALTER TABLE dbo.Documents ADD ContentHash NVARCHAR(64) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'IndexingStatus')
BEGIN
    ALTER TABLE dbo.Documents ADD IndexingStatus NVARCHAR(30) NOT NULL DEFAULT 'NotIndexed';
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'UploaderEmail')
BEGIN
    ALTER TABLE dbo.Documents ADD UploaderEmail NVARCHAR(255) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'BlobUri')
BEGIN
    ALTER TABLE dbo.Documents ADD BlobUri NVARCHAR(1000) NULL;
END;

-- NOTE: ConflictHold and OpenConflictId are cached state columns.
-- NOT the primary source of truth: WP6 / WP9 recompute document hold dynamically
-- from open conflicts in dbo.FactConflicts (a document is held if and only if
-- EXISTS any active conflict referencing it, and released when none remain).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'ConflictHold')
BEGIN
    ALTER TABLE dbo.Documents ADD ConflictHold BIT NOT NULL DEFAULT 0;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'OpenConflictId')
BEGIN
    ALTER TABLE dbo.Documents ADD OpenConflictId BIGINT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Documents_ContentHash' AND object_id = OBJECT_ID('dbo.Documents'))
BEGIN
    CREATE INDEX IX_Documents_ContentHash ON dbo.Documents(ContentHash);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Documents_IndexingStatus' AND object_id = OBJECT_ID('dbo.Documents'))
BEGIN
    CREATE INDEX IX_Documents_IndexingStatus ON dbo.Documents(IndexingStatus);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Documents_ConflictHold' AND object_id = OBJECT_ID('dbo.Documents'))
BEGIN
    CREATE INDEX IX_Documents_ConflictHold ON dbo.Documents(ConflictHold);
END;

-- ----------------------------------------------------------------------------
-- 4. Extend dbo.FinancialFacts (Identity Hash, Location Hash & Unique Index)
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'Unit')
BEGIN
    ALTER TABLE dbo.FinancialFacts ADD Unit NVARCHAR(50) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'AsOfDate')
BEGIN
    ALTER TABLE dbo.FinancialFacts ADD AsOfDate DATE NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'FactIdentityHash')
BEGIN
    ALTER TABLE dbo.FinancialFacts ADD FactIdentityHash CHAR(64) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'SourceLocationHash')
BEGIN
    ALTER TABLE dbo.FinancialFacts ADD SourceLocationHash CHAR(64) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FinancialFacts_IdentityHash' AND object_id = OBJECT_ID('dbo.FinancialFacts'))
BEGIN
    CREATE INDEX IX_FinancialFacts_IdentityHash ON dbo.FinancialFacts(FactIdentityHash);
END;

-- Filtered unique index: guarantees no duplicate facts within a document at a specific location
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FinancialFacts_Doc_Identity_Location' AND object_id = OBJECT_ID('dbo.FinancialFacts'))
BEGIN
    CREATE UNIQUE INDEX UX_FinancialFacts_Doc_Identity_Location 
    ON dbo.FinancialFacts(DocumentId, FactIdentityHash, SourceLocationHash)
    WHERE FactIdentityHash IS NOT NULL AND SourceLocationHash IS NOT NULL;
END;

-- ----------------------------------------------------------------------------
-- 5. Extend dbo.FactConflicts (Retry, Reissue, and Status Values)
-- ----------------------------------------------------------------------------
-- ConflictStatus domain values: 'PendingApproval', 'PendingReview', 'Detected',
-- 'Potential', 'Resolved', 'Rejected', 'Escalated', 'Moot'.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'ReissueCount')
BEGIN
    ALTER TABLE dbo.FactConflicts ADD ReissueCount INT NOT NULL DEFAULT 0;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'NotificationRetryCount')
BEGIN
    ALTER TABLE dbo.FactConflicts ADD NotificationRetryCount INT NOT NULL DEFAULT 0;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'NotificationError')
BEGIN
    ALTER TABLE dbo.FactConflicts ADD NotificationError NVARCHAR(MAX) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'TokenExpiresAt')
BEGIN
    ALTER TABLE dbo.FactConflicts ADD TokenExpiresAt DATETIME2 NULL;
END;

-- ----------------------------------------------------------------------------
-- 6. Seed MetricAliases for IFRS & HR Metrics (English + Arabic)
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.Metrics WHERE CanonicalMetric = 'Revenue')
    INSERT INTO dbo.Metrics (CanonicalMetric, MetricCategory, MeasurementType, DefaultUnit) VALUES ('Revenue', 'Income Statement', 'Amount', 'AED');
IF NOT EXISTS (SELECT 1 FROM dbo.Metrics WHERE CanonicalMetric = 'Cost of Goods Sold')
    INSERT INTO dbo.Metrics (CanonicalMetric, MetricCategory, MeasurementType, DefaultUnit) VALUES ('Cost of Goods Sold', 'Income Statement', 'Amount', 'AED');
IF NOT EXISTS (SELECT 1 FROM dbo.Metrics WHERE CanonicalMetric = 'Gross Profit')
    INSERT INTO dbo.Metrics (CanonicalMetric, MetricCategory, MeasurementType, DefaultUnit) VALUES ('Gross Profit', 'Income Statement', 'Amount', 'AED');
IF NOT EXISTS (SELECT 1 FROM dbo.Metrics WHERE CanonicalMetric = 'Operating Expenses')
    INSERT INTO dbo.Metrics (CanonicalMetric, MetricCategory, MeasurementType, DefaultUnit) VALUES ('Operating Expenses', 'Income Statement', 'Amount', 'AED');
IF NOT EXISTS (SELECT 1 FROM dbo.Metrics WHERE CanonicalMetric = 'Net Profit')
    INSERT INTO dbo.Metrics (CanonicalMetric, MetricCategory, MeasurementType, DefaultUnit) VALUES ('Net Profit', 'Income Statement', 'Amount', 'AED');
IF NOT EXISTS (SELECT 1 FROM dbo.Metrics WHERE CanonicalMetric = 'Total Assets')
    INSERT INTO dbo.Metrics (CanonicalMetric, MetricCategory, MeasurementType, DefaultUnit) VALUES ('Total Assets', 'Balance Sheet', 'Amount', 'AED');
IF NOT EXISTS (SELECT 1 FROM dbo.Metrics WHERE CanonicalMetric = 'Total Liabilities')
    INSERT INTO dbo.Metrics (CanonicalMetric, MetricCategory, MeasurementType, DefaultUnit) VALUES ('Total Liabilities', 'Balance Sheet', 'Amount', 'AED');
IF NOT EXISTS (SELECT 1 FROM dbo.Metrics WHERE CanonicalMetric = 'Total Equity')
    INSERT INTO dbo.Metrics (CanonicalMetric, MetricCategory, MeasurementType, DefaultUnit) VALUES ('Total Equity', 'Balance Sheet', 'Amount', 'AED');
IF NOT EXISTS (SELECT 1 FROM dbo.Metrics WHERE CanonicalMetric = 'Headcount')
    INSERT INTO dbo.Metrics (CanonicalMetric, MetricCategory, MeasurementType, DefaultUnit) VALUES ('Headcount', 'Human Resources', 'Count', 'Employees');
IF NOT EXISTS (SELECT 1 FROM dbo.Metrics WHERE CanonicalMetric = 'Basic EPS')
    INSERT INTO dbo.Metrics (CanonicalMetric, MetricCategory, MeasurementType, DefaultUnit) VALUES ('Basic EPS', 'Income Statement', 'Ratio', 'AED/share');
IF NOT EXISTS (SELECT 1 FROM dbo.Metrics WHERE CanonicalMetric = 'Operating Cash Flow')
    INSERT INTO dbo.Metrics (CanonicalMetric, MetricCategory, MeasurementType, DefaultUnit) VALUES ('Operating Cash Flow', 'Cash Flow', 'Amount', 'AED');

-- Seed multilingual aliases
DECLARE @RevId BIGINT = (SELECT TOP 1 MetricId FROM dbo.Metrics WHERE CanonicalMetric = 'Revenue');
DECLARE @CogsId BIGINT = (SELECT TOP 1 MetricId FROM dbo.Metrics WHERE CanonicalMetric = 'Cost of Goods Sold');
DECLARE @GpId BIGINT = (SELECT TOP 1 MetricId FROM dbo.Metrics WHERE CanonicalMetric = 'Gross Profit');
DECLARE @OpexId BIGINT = (SELECT TOP 1 MetricId FROM dbo.Metrics WHERE CanonicalMetric = 'Operating Expenses');
DECLARE @NpId BIGINT = (SELECT TOP 1 MetricId FROM dbo.Metrics WHERE CanonicalMetric = 'Net Profit');
DECLARE @AssetsId BIGINT = (SELECT TOP 1 MetricId FROM dbo.Metrics WHERE CanonicalMetric = 'Total Assets');
DECLARE @LiabId BIGINT = (SELECT TOP 1 MetricId FROM dbo.Metrics WHERE CanonicalMetric = 'Total Liabilities');
DECLARE @EqId BIGINT = (SELECT TOP 1 MetricId FROM dbo.Metrics WHERE CanonicalMetric = 'Total Equity');
DECLARE @HcId BIGINT = (SELECT TOP 1 MetricId FROM dbo.Metrics WHERE CanonicalMetric = 'Headcount');
DECLARE @EpsId BIGINT = (SELECT TOP 1 MetricId FROM dbo.Metrics WHERE CanonicalMetric = 'Basic EPS');
DECLARE @OcfId BIGINT = (SELECT TOP 1 MetricId FROM dbo.Metrics WHERE CanonicalMetric = 'Operating Cash Flow');

-- Revenue aliases
IF @RevId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = 'Turnover' AND LanguageCode = 'en')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@RevId, 'Turnover', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = 'Total Revenue' AND LanguageCode = 'en')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@RevId, 'Total Revenue', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'الإيرادات' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@RevId, N'الإيرادات', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'إجمالي الإيرادات' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@RevId, N'إجمالي الإيرادات', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'المبيعات' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@RevId, N'المبيعات', 'ar');
END;

-- COGS aliases
IF @CogsId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = 'COGS' AND LanguageCode = 'en')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@CogsId, 'COGS', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = 'Cost of Sales' AND LanguageCode = 'en')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@CogsId, 'Cost of Sales', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'تكلفة المبيعات' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@CogsId, N'تكلفة المبيعات', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'تكلفة البضاعة المباعة' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@CogsId, N'تكلفة البضاعة المباعة', 'ar');
END;

-- Gross Profit aliases
IF @GpId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'إجمالي الربح' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@GpId, N'إجمالي الربح', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'مجمل الربح' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@GpId, N'مجمل الربح', 'ar');
END;

-- OPEX aliases
IF @OpexId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = 'OPEX' AND LanguageCode = 'en')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@OpexId, 'OPEX', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = 'Operating Costs' AND LanguageCode = 'en')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@OpexId, 'Operating Costs', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'المصاريف التشغيلية' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@OpexId, N'المصاريف التشغيلية', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'نفقات التشغيل' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@OpexId, N'نفقات التشغيل', 'ar');
END;

-- Net Profit aliases
IF @NpId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = 'Net Income' AND LanguageCode = 'en')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@NpId, 'Net Income', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = 'Profit for the Period' AND LanguageCode = 'en')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@NpId, 'Profit for the Period', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'صافي الربح' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@NpId, N'صافي الربح', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'صافي الدخل' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@NpId, N'صافي الدخل', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'أرباح الفترة' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@NpId, N'أرباح الفترة', 'ar');
END;

-- Balance Sheet aliases
IF @AssetsId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'إجمالي الأصول' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@AssetsId, N'إجمالي الأصول', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'مجموع الأصول' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@AssetsId, N'مجموع الأصول', 'ar');
END;

IF @LiabId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'إجمالي الالتزامات' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@LiabId, N'إجمالي الالتزامات', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'مجموع الخصوم' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@LiabId, N'مجموع الخصوم', 'ar');
END;

IF @EqId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = 'Shareholders Equity' AND LanguageCode = 'en')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@EqId, 'Shareholders Equity', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'إجمالي حقوق الملكية' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@EqId, N'إجمالي حقوق الملكية', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'صافي حقوق الملكية' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@EqId, N'صافي حقوق الملكية', 'ar');
END;

-- HR Headcount aliases
IF @HcId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = 'Total Headcount' AND LanguageCode = 'en')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@HcId, 'Total Headcount', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = 'Number of Employees' AND LanguageCode = 'en')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@HcId, 'Number of Employees', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = 'Employee Count' AND LanguageCode = 'en')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@HcId, 'Employee Count', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'عدد الموظفين' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@HcId, N'عدد الموظفين', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.MetricAliases WHERE AliasText = N'إجمالي العاملين' AND LanguageCode = 'ar')
        INSERT INTO dbo.MetricAliases (MetricId, AliasText, LanguageCode) VALUES (@HcId, N'إجمالي العاملين', 'ar');
END;

-- ----------------------------------------------------------------------------
-- 7. Backfill Historical Data & Hashes
-- ----------------------------------------------------------------------------
-- Backfill NULL-status facts to NeedsReview
UPDATE dbo.FinancialFacts
SET MappingStatus = 'NeedsReview'
WHERE MappingStatus IS NULL;

-- Backfill missing IndexingStatus on Documents to NotIndexed
UPDATE dbo.Documents
SET IndexingStatus = 'NotIndexed'
WHERE IndexingStatus IS NULL;

-- Backfill missing ConflictHold to 0
UPDATE dbo.Documents
SET ConflictHold = 0
WHERE ConflictHold IS NULL;

-- Backfill missing SourceLocationHash from location text/json
UPDATE dbo.FinancialFacts
SET SourceLocationHash = CONVERT(CHAR(64), HASHBYTES('SHA2_256', ISNULL(SourceLocationJson, ISNULL(SourceLocationText, CONCAT(CAST(DocumentId AS NVARCHAR(30)), ':', ISNULL(Metric, 'UNKNOWN'), ':', ISNULL(PeriodLabel, 'UNKNOWN'))))), 2)
WHERE SourceLocationHash IS NULL;

-- Backfill missing FactIdentityHash from canonical identity fields
UPDATE dbo.FinancialFacts
SET FactIdentityHash = CONVERT(CHAR(64), HASHBYTES('SHA2_256', 
    LOWER(CONCAT(
        ISNULL(Entity, 'unknown'), '|',
        ISNULL(Metric, ISNULL(OriginalLabel, 'unknown')), '|',
        ISNULL(PeriodLabel, 'unknown'), '|',
        ISNULL(ReportingBasis, 'actual'), '|',
        ISNULL(Unit, ISNULL(NormalizedUnit, 'amount')), '|',
        ISNULL(Currency, '')
    ))
), 2)
WHERE FactIdentityHash IS NULL;
