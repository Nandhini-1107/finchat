-- ============================================================================
-- Migration 001: Dynamic Financial Fact Database Architecture
-- Description: Non-destructive, incremental migration supporting dynamic entities,
--              canonical metrics, periods, multi-fact conflicts, resolutions, and audits.
-- Date: 2026-11-14
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SourceAuthorityRanks: Ensure table & extend with Priority & ReportingBasis
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SourceAuthorityRanks')
BEGIN
    CREATE TABLE dbo.SourceAuthorityRanks (
        AuthorityRank INT NOT NULL PRIMARY KEY,
        SourceType NVARCHAR(100) NOT NULL,
        Description NVARCHAR(500) NULL,
        Priority INT NOT NULL DEFAULT 1,
        ReportingBasis NVARCHAR(50) NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );

    INSERT INTO dbo.SourceAuthorityRanks (AuthorityRank, SourceType, Description, Priority, ReportingBasis, IsActive) VALUES
    (1, 'Audited Financials', 'Audited statutory filings and reports (Highest authority)', 1, 'Actual', 1),
    (2, 'Board Packs / Final', 'Approved board reports, executive packs, final settlement files', 2, 'Actual', 1),
    (3, 'Drafts / Working Files', 'Draft estimates, working ledgers, unapproved reports', 3, 'Actual', 1),
    (4, 'Sample / Test', 'Sample test documents and synthetic datasets', 4, 'Actual', 1);
END
ELSE
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SourceAuthorityRanks') AND name = 'Priority')
        ALTER TABLE dbo.SourceAuthorityRanks ADD Priority INT NOT NULL DEFAULT 1;

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SourceAuthorityRanks') AND name = 'AuthorityCategory')
        ALTER TABLE dbo.SourceAuthorityRanks ADD AuthorityCategory NVARCHAR(100) NULL;

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SourceAuthorityRanks') AND name = 'ReportingBasis')
        ALTER TABLE dbo.SourceAuthorityRanks ADD ReportingBasis NVARCHAR(50) NULL;

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SourceAuthorityRanks') AND name = 'IsActive')
        ALTER TABLE dbo.SourceAuthorityRanks ADD IsActive BIT NOT NULL DEFAULT 1;

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SourceAuthorityRanks') AND name = 'CreatedAt')
        ALTER TABLE dbo.SourceAuthorityRanks ADD CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME();

    -- Sync AuthorityCategory with SourceType
    UPDATE dbo.SourceAuthorityRanks SET AuthorityCategory = SourceType WHERE AuthorityCategory IS NULL;
END;

-- ----------------------------------------------------------------------------
-- 2. Entities Table: Dynamic entities, subsidiaries, business units
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Entities')
BEGIN
    CREATE TABLE dbo.Entities (
        EntityId BIGINT IDENTITY(1,1) PRIMARY KEY,
        EntityName NVARCHAR(200) NOT NULL,
        EntityType NVARCHAR(50) NOT NULL DEFAULT 'Company',
        ParentEntityId BIGINT NULL FOREIGN KEY REFERENCES dbo.Entities(EntityId),
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NULL
    );
    CREATE UNIQUE INDEX UX_Entities_Name_Type ON dbo.Entities(EntityName, EntityType);
END;

-- ----------------------------------------------------------------------------
-- 3. Metrics Table: Dynamic canonical metrics independent of document labels
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Metrics')
BEGIN
    CREATE TABLE dbo.Metrics (
        MetricId BIGINT IDENTITY(1,1) PRIMARY KEY,
        CanonicalMetric NVARCHAR(200) NOT NULL,
        MetricCategory NVARCHAR(100) NULL,
        Definition NVARCHAR(1000) NULL,
        MeasurementType NVARCHAR(50) NOT NULL DEFAULT 'Amount',
        DefaultUnit NVARCHAR(50) NULL,
        ParentMetricId BIGINT NULL FOREIGN KEY REFERENCES dbo.Metrics(MetricId),
        ApprovedStatus NVARCHAR(30) NOT NULL DEFAULT 'Approved',
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NULL
    );
    CREATE UNIQUE INDEX UX_Metrics_CanonicalName ON dbo.Metrics(CanonicalMetric);
END;

-- MetricAliases Table: Multilingual synonyms and document label mappings
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MetricAliases')
BEGIN
    CREATE TABLE dbo.MetricAliases (
        AliasId BIGINT IDENTITY(1,1) PRIMARY KEY,
        MetricId BIGINT NOT NULL FOREIGN KEY REFERENCES dbo.Metrics(MetricId),
        AliasText NVARCHAR(200) NOT NULL,
        LanguageCode NVARCHAR(10) NOT NULL DEFAULT 'en',
        IsApproved BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX UX_MetricAliases_Alias_Lang ON dbo.MetricAliases(AliasText, LanguageCode);
END;

-- ----------------------------------------------------------------------------
-- 4. Periods Table: Dynamic calendar and non-calendar reporting periods
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Periods')
BEGIN
    CREATE TABLE dbo.Periods (
        PeriodId BIGINT IDENTITY(1,1) PRIMARY KEY,
        PeriodName NVARCHAR(100) NOT NULL,
        PeriodType NVARCHAR(50) NOT NULL DEFAULT 'CustomRange',
        PeriodStart DATE NULL,
        PeriodEnd DATE NULL,
        FinancialYear NVARCHAR(20) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX UX_Periods_Name_Dates ON dbo.Periods(PeriodName, PeriodStart, PeriodEnd);
END;

-- ----------------------------------------------------------------------------
-- 5. IngestionRuns Table: Extend with TriggeredBy and CorrelationId
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'IngestionRuns')
BEGIN
    CREATE TABLE dbo.IngestionRuns (
        RunId BIGINT IDENTITY(1,1) PRIMARY KEY,
        StartedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CompletedAt DATETIME2 NULL,
        FilesDiscovered INT NOT NULL DEFAULT 1,
        FilesSucceeded INT NOT NULL DEFAULT 0,
        FilesFailed INT NOT NULL DEFAULT 0,
        RunStatus NVARCHAR(30) NOT NULL DEFAULT 'Processing',
        ErrorSummary NVARCHAR(MAX) NULL,
        TriggeredBy NVARCHAR(50) NULL DEFAULT 'Timer',
        CorrelationId NVARCHAR(100) NULL
    );
END
ELSE
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.IngestionRuns') AND name = 'TriggeredBy')
        ALTER TABLE dbo.IngestionRuns ADD TriggeredBy NVARCHAR(50) NULL DEFAULT 'Timer';

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.IngestionRuns') AND name = 'CorrelationId')
        ALTER TABLE dbo.IngestionRuns ADD CorrelationId NVARCHAR(100) NULL;
END;

-- ----------------------------------------------------------------------------
-- 6. Documents Table: Safe extension for versions, lineage, reporting context
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Documents')
BEGIN
    CREATE TABLE dbo.Documents (
        DocumentId BIGINT IDENTITY(1,1) PRIMARY KEY,
        FileName NVARCHAR(260) NOT NULL,
        SourceType NVARCHAR(50) NOT NULL DEFAULT 'ManualUpload',
        SharePointFileId NVARCHAR(300) NULL,
        SourceUrl NVARCHAR(1000) NULL,
        FileVersion NVARCHAR(100) NULL,
        AuthorityRank INT NULL FOREIGN KEY REFERENCES dbo.SourceAuthorityRanks(AuthorityRank),
        AllowedUserGroups NVARCHAR(1000) NULL,
        IngestionStatus NVARCHAR(30) NOT NULL DEFAULT 'Processing',
        LastProcessedAt DATETIME2 NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedByUserId NVARCHAR(255) NULL,
        CreatedByName NVARCHAR(150) NULL,
        CreatedByEmail NVARCHAR(255) NULL,
        CreatedByDepartment NVARCHAR(100) NULL,
        ModifiedByUserId NVARCHAR(255) NULL,
        ModifiedByName NVARCHAR(150) NULL,
        ModifiedByEmail NVARCHAR(255) NULL,
        ModifiedAt DATETIME2 NULL,
        ProcessingError NVARCHAR(MAX) NULL
    );
END;

-- Safely add new columns to dbo.Documents
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'LogicalDocumentId')
    ALTER TABLE dbo.Documents ADD LogicalDocumentId NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'FileType')
    ALTER TABLE dbo.Documents ADD FileType NVARCHAR(20) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'DocumentType')
    ALTER TABLE dbo.Documents ADD DocumentType NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'DocumentIssuer')
    ALTER TABLE dbo.Documents ADD DocumentIssuer NVARCHAR(200) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'VersionNumber')
    ALTER TABLE dbo.Documents ADD VersionNumber INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'SupersedesDocumentId')
    ALTER TABLE dbo.Documents ADD SupersedesDocumentId BIGINT NULL FOREIGN KEY REFERENCES dbo.Documents(DocumentId);

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'DocumentStatus')
    ALTER TABLE dbo.Documents ADD DocumentStatus NVARCHAR(50) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'ReportingBasis')
    ALTER TABLE dbo.Documents ADD ReportingBasis NVARCHAR(50) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'ReportingScope')
    ALTER TABLE dbo.Documents ADD ReportingScope NVARCHAR(50) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'PreparedDate')
    ALTER TABLE dbo.Documents ADD PreparedDate DATE NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'ApprovalDate')
    ALTER TABLE dbo.Documents ADD ApprovalDate DATE NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'AsOfDate')
    ALTER TABLE dbo.Documents ADD AsOfDate DATE NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'PeriodStart')
    ALTER TABLE dbo.Documents ADD PeriodStart DATE NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'PeriodEnd')
    ALTER TABLE dbo.Documents ADD PeriodEnd DATE NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'Currency')
    ALTER TABLE dbo.Documents ADD Currency NVARCHAR(10) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'CreatedByUserName')
    ALTER TABLE dbo.Documents ADD CreatedByUserName NVARCHAR(150) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'CreatedByUserEmail')
    ALTER TABLE dbo.Documents ADD CreatedByUserEmail NVARCHAR(255) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'ModifiedByUserName')
    ALTER TABLE dbo.Documents ADD ModifiedByUserName NVARCHAR(150) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'ModifiedByUserEmail')
    ALTER TABLE dbo.Documents ADD ModifiedByUserEmail NVARCHAR(255) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'IsCurrent')
    ALTER TABLE dbo.Documents ADD IsCurrent BIT NOT NULL DEFAULT 1;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'AuthorityCategory')
    ALTER TABLE dbo.Documents ADD AuthorityCategory NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'SourceJson')
    ALTER TABLE dbo.Documents ADD SourceJson NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'FileHash')
    ALTER TABLE dbo.Documents ADD FileHash NVARCHAR(128) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'MetadataJson')
    ALTER TABLE dbo.Documents ADD MetadataJson NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'UpdatedAt')
    ALTER TABLE dbo.Documents ADD UpdatedAt DATETIME2 NULL;

-- Sync username/email aliases
UPDATE dbo.Documents SET CreatedByUserName = CreatedByName WHERE CreatedByUserName IS NULL;
UPDATE dbo.Documents SET CreatedByUserEmail = CreatedByEmail WHERE CreatedByUserEmail IS NULL;
UPDATE dbo.Documents SET ModifiedByUserName = ModifiedByName WHERE ModifiedByUserName IS NULL;
UPDATE dbo.Documents SET ModifiedByUserEmail = ModifiedByEmail WHERE ModifiedByUserEmail IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Documents_LogicalId' AND object_id = OBJECT_ID('dbo.Documents'))
    CREATE INDEX IX_Documents_LogicalId ON dbo.Documents(LogicalDocumentId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Documents_SupersedesId' AND object_id = OBJECT_ID('dbo.Documents'))
    CREATE INDEX IX_Documents_SupersedesId ON dbo.Documents(SupersedesDocumentId);

-- ----------------------------------------------------------------------------
-- 7. FinancialFacts Table: Safe extension for relational links & normalization
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FinancialFacts')
BEGIN
    CREATE TABLE dbo.FinancialFacts (
        FactId BIGINT IDENTITY(1,1) PRIMARY KEY,
        DocumentId BIGINT NOT NULL FOREIGN KEY REFERENCES dbo.Documents(DocumentId),
        Metric NVARCHAR(200) NOT NULL,
        Entity NVARCHAR(200) NULL,
        PeriodLabel NVARCHAR(100) NULL,
        FactDate DATE NULL,
        AsOfDate DATE NULL,
        NumericValue DECIMAL(19,4) NULL,
        TextValue NVARCHAR(2000) NULL,
        Unit NVARCHAR(50) NULL,
        Currency NVARCHAR(10) NULL,
        SourceLocation NVARCHAR(300) NULL,
        SourceFileName NVARCHAR(260) NULL,
        AuthorityRank INT NULL FOREIGN KEY REFERENCES dbo.SourceAuthorityRanks(AuthorityRank),
        ValidationStatus NVARCHAR(30) NOT NULL DEFAULT 'Validated',
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;

-- Safely add new dynamic architecture columns to FinancialFacts
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'EntityId')
    ALTER TABLE dbo.FinancialFacts ADD EntityId BIGINT NULL FOREIGN KEY REFERENCES dbo.Entities(EntityId);

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'MetricId')
    ALTER TABLE dbo.FinancialFacts ADD MetricId BIGINT NULL FOREIGN KEY REFERENCES dbo.Metrics(MetricId);

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'PeriodId')
    ALTER TABLE dbo.FinancialFacts ADD PeriodId BIGINT NULL FOREIGN KEY REFERENCES dbo.Periods(PeriodId);

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'ReportingBasis')
    ALTER TABLE dbo.FinancialFacts ADD ReportingBasis NVARCHAR(50) NULL DEFAULT 'Actual';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'ReportingScope')
    ALTER TABLE dbo.FinancialFacts ADD ReportingScope NVARCHAR(50) NULL DEFAULT 'Consolidated';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'FactCategory')
    ALTER TABLE dbo.FinancialFacts ADD FactCategory NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'OriginalLabel')
    ALTER TABLE dbo.FinancialFacts ADD OriginalLabel NVARCHAR(300) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'OriginalValue')
    ALTER TABLE dbo.FinancialFacts ADD OriginalValue DECIMAL(28,8) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'OriginalTextValue')
    ALTER TABLE dbo.FinancialFacts ADD OriginalTextValue NVARCHAR(2000) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'OriginalUnit')
    ALTER TABLE dbo.FinancialFacts ADD OriginalUnit NVARCHAR(50) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'NormalizedValue')
    ALTER TABLE dbo.FinancialFacts ADD NormalizedValue DECIMAL(28,8) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'NormalizedUnit')
    ALTER TABLE dbo.FinancialFacts ADD NormalizedUnit NVARCHAR(50) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'SourceLocationJson')
    ALTER TABLE dbo.FinancialFacts ADD SourceLocationJson NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'SourceLocationText')
    ALTER TABLE dbo.FinancialFacts ADD SourceLocationText NVARCHAR(500) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'ExtractionMethod')
    ALTER TABLE dbo.FinancialFacts ADD ExtractionMethod NVARCHAR(50) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'ExtractionConfidence')
    ALTER TABLE dbo.FinancialFacts ADD ExtractionConfidence DECIMAL(5,4) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'MappingStatus')
    ALTER TABLE dbo.FinancialFacts ADD MappingStatus NVARCHAR(30) NOT NULL DEFAULT 'Approved';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'FactAsOfDate')
    ALTER TABLE dbo.FinancialFacts ADD FactAsOfDate DATE NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'UpdatedAt')
    ALTER TABLE dbo.FinancialFacts ADD UpdatedAt DATETIME2 NULL;

UPDATE dbo.FinancialFacts SET FactAsOfDate = AsOfDate WHERE FactAsOfDate IS NULL AND AsOfDate IS NOT NULL;

-- Composite & lookup indexes for FinancialFacts
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FinancialFacts_Entity_Metric_Period' AND object_id = OBJECT_ID('dbo.FinancialFacts'))
    CREATE INDEX IX_FinancialFacts_Entity_Metric_Period ON dbo.FinancialFacts(EntityId, MetricId, PeriodId, ReportingBasis);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FinancialFacts_Validation_Mapping' AND object_id = OBJECT_ID('dbo.FinancialFacts'))
    CREATE INDEX IX_FinancialFacts_Validation_Mapping ON dbo.FinancialFacts(ValidationStatus, MappingStatus);

-- ----------------------------------------------------------------------------
-- 8. FactConflicts Table: Safe extension for multi-dimension conflict detection
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FactConflicts')
BEGIN
    CREATE TABLE dbo.FactConflicts (
        ConflictId BIGINT IDENTITY(1,1) PRIMARY KEY,
        FactId1 BIGINT NULL FOREIGN KEY REFERENCES dbo.FinancialFacts(FactId),
        FactId2 BIGINT NULL FOREIGN KEY REFERENCES dbo.FinancialFacts(FactId),
        ConflictReason NVARCHAR(1000) NOT NULL,
        ResolutionStatus NVARCHAR(30) NOT NULL DEFAULT 'Unresolved',
        ResolutionNotes NVARCHAR(2000) NULL,
        ReviewedAt DATETIME2 NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'EntityId')
    ALTER TABLE dbo.FactConflicts ADD EntityId BIGINT NULL FOREIGN KEY REFERENCES dbo.Entities(EntityId);

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'MetricId')
    ALTER TABLE dbo.FactConflicts ADD MetricId BIGINT NULL FOREIGN KEY REFERENCES dbo.Metrics(MetricId);

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'PeriodId')
    ALTER TABLE dbo.FactConflicts ADD PeriodId BIGINT NULL FOREIGN KEY REFERENCES dbo.Periods(PeriodId);

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'ReportingBasis')
    ALTER TABLE dbo.FactConflicts ADD ReportingBasis NVARCHAR(50) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'ReportingScope')
    ALTER TABLE dbo.FactConflicts ADD ReportingScope NVARCHAR(50) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'ConflictType')
    ALTER TABLE dbo.FactConflicts ADD ConflictType NVARCHAR(100) NOT NULL DEFAULT 'ValueMismatch';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'ConflictStatus')
    ALTER TABLE dbo.FactConflicts ADD ConflictStatus NVARCHAR(50) NOT NULL DEFAULT 'Potential';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'ConflictDescription')
    ALTER TABLE dbo.FactConflicts ADD ConflictDescription NVARCHAR(1000) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'DifferenceValue')
    ALTER TABLE dbo.FactConflicts ADD DifferenceValue DECIMAL(28,8) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'DifferencePercentage')
    ALTER TABLE dbo.FactConflicts ADD DifferencePercentage DECIMAL(9,4) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'ToleranceApplied')
    ALTER TABLE dbo.FactConflicts ADD ToleranceApplied DECIMAL(9,4) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'SelectedFactId')
    ALTER TABLE dbo.FactConflicts ADD SelectedFactId BIGINT NULL FOREIGN KEY REFERENCES dbo.FinancialFacts(FactId);

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'ResolutionReason')
    ALTER TABLE dbo.FactConflicts ADD ResolutionReason NVARCHAR(2000) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'DetectedAt')
    ALTER TABLE dbo.FactConflicts ADD DetectedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME();

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'RecordIdsJson')
    ALTER TABLE dbo.FactConflicts ADD RecordIdsJson NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'ReviewedBy')
    ALTER TABLE dbo.FactConflicts ADD ReviewedBy NVARCHAR(150) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'UpdatedAt')
    ALTER TABLE dbo.FactConflicts ADD UpdatedAt DATETIME2 NULL;

-- ----------------------------------------------------------------------------
-- 9. FactConflictRecords Table: N-way relationship between facts and conflicts
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FactConflictRecords')
BEGIN
    CREATE TABLE dbo.FactConflictRecords (
        ConflictRecordId BIGINT IDENTITY(1,1) PRIMARY KEY,
        ConflictId BIGINT NOT NULL FOREIGN KEY REFERENCES dbo.FactConflicts(ConflictId),
        FactId BIGINT NOT NULL FOREIGN KEY REFERENCES dbo.FinancialFacts(FactId),
        FactRole NVARCHAR(50) NOT NULL DEFAULT 'Alternative',
        DifferenceFromSelected DECIMAL(28,8) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX UX_FactConflictRecords_Conflict_Fact ON dbo.FactConflictRecords(ConflictId, FactId);
    CREATE INDEX IX_FactConflictRecords_FactId ON dbo.FactConflictRecords(FactId);
END;

-- ----------------------------------------------------------------------------
-- 10. FactResolutions Table: Auditable history of conflict resolutions
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FactResolutions')
BEGIN
    CREATE TABLE dbo.FactResolutions (
        ResolutionId BIGINT IDENTITY(1,1) PRIMARY KEY,
        ConflictId BIGINT NOT NULL FOREIGN KEY REFERENCES dbo.FactConflicts(ConflictId),
        SelectedFactId BIGINT NULL FOREIGN KEY REFERENCES dbo.FinancialFacts(FactId),
        ResolutionType NVARCHAR(50) NOT NULL,
        ResolutionReason NVARCHAR(2000) NOT NULL,
        ResolutionRule NVARCHAR(500) NULL,
        ResolvedBy NVARCHAR(150) NOT NULL DEFAULT 'System',
        ResolvedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        PreviousStatus NVARCHAR(50) NULL,
        NewStatus NVARCHAR(50) NOT NULL
    );
    CREATE INDEX IX_FactResolutions_ConflictId ON dbo.FactResolutions(ConflictId);
    CREATE INDEX IX_FactResolutions_ResolvedAt ON dbo.FactResolutions(ResolvedAt);
END;

-- ----------------------------------------------------------------------------
-- 11. FactAudit Table: Complete audit trail of fact actions
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FactAudit')
BEGIN
    CREATE TABLE dbo.FactAudit (
        AuditId BIGINT IDENTITY(1,1) PRIMARY KEY,
        FactId BIGINT NOT NULL FOREIGN KEY REFERENCES dbo.FinancialFacts(FactId),
        DocumentId BIGINT NOT NULL FOREIGN KEY REFERENCES dbo.Documents(DocumentId),
        ActionType NVARCHAR(50) NOT NULL,
        OldValue NVARCHAR(500) NULL,
        NewValue NVARCHAR(500) NULL,
        ActionReason NVARCHAR(1000) NULL,
        ActionBy NVARCHAR(150) NULL,
        ActionAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CorrelationId NVARCHAR(100) NULL
    );
    CREATE INDEX IX_FactAudit_Fact_Time ON dbo.FactAudit(FactId, ActionAt);
    CREATE INDEX IX_FactAudit_DocumentId ON dbo.FactAudit(DocumentId);
END;

-- ----------------------------------------------------------------------------
-- 12. Idempotent Backfill: Seed Entities, Metrics, Periods from existing data
-- ----------------------------------------------------------------------------
-- Backfill Entities
INSERT INTO dbo.Entities (EntityName, EntityType)
SELECT DISTINCT TRIM(Entity), 'Company'
FROM dbo.FinancialFacts
WHERE Entity IS NOT NULL AND TRIM(Entity) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM dbo.Entities e WHERE e.EntityName = TRIM(dbo.FinancialFacts.Entity)
  );

-- Backfill Metrics
INSERT INTO dbo.Metrics (CanonicalMetric, MetricCategory, MeasurementType)
SELECT DISTINCT TRIM(Metric), 'General',
       CASE WHEN LOWER(TRIM(Metric)) LIKE '%count%' THEN 'Count' ELSE 'Amount' END
FROM dbo.FinancialFacts
WHERE Metric IS NOT NULL AND TRIM(Metric) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM dbo.Metrics m WHERE m.CanonicalMetric = TRIM(dbo.FinancialFacts.Metric)
  );

-- Backfill Periods
INSERT INTO dbo.Periods (PeriodName, PeriodType)
SELECT DISTINCT TRIM(PeriodLabel), 'CustomRange'
FROM dbo.FinancialFacts
WHERE PeriodLabel IS NOT NULL AND TRIM(PeriodLabel) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM dbo.Periods p WHERE p.PeriodName = TRIM(dbo.FinancialFacts.PeriodLabel)
  );

-- Backfill foreign keys on FinancialFacts where missing
UPDATE f
SET f.EntityId = e.EntityId
FROM dbo.FinancialFacts f
JOIN dbo.Entities e ON e.EntityName = TRIM(f.Entity)
WHERE f.EntityId IS NULL;

UPDATE f
SET f.MetricId = m.MetricId
FROM dbo.FinancialFacts f
JOIN dbo.Metrics m ON m.CanonicalMetric = TRIM(f.Metric)
WHERE f.MetricId IS NULL;

UPDATE f
SET f.PeriodId = p.PeriodId
FROM dbo.FinancialFacts f
JOIN dbo.Periods p ON p.PeriodName = TRIM(f.PeriodLabel)
WHERE f.PeriodId IS NULL;

-- Backfill NormalizedValue / OriginalValue from legacy NumericValue
UPDATE dbo.FinancialFacts
SET NormalizedValue = NumericValue,
    OriginalValue = NumericValue,
    OriginalLabel = Metric,
    NormalizedUnit = Unit,
    OriginalUnit = Unit
WHERE NormalizedValue IS NULL AND NumericValue IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 13. Reporting View: dbo.vw_FinancialFacts_Complete
-- ----------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.views WHERE name = 'vw_FinancialFacts_Complete')
    DROP VIEW dbo.vw_FinancialFacts_Complete;
GO

CREATE VIEW dbo.vw_FinancialFacts_Complete AS
SELECT 
    f.FactId AS RecordId,
    f.FactId,
    f.DocumentId,
    d.FileName,
    d.LogicalDocumentId,
    d.VersionNumber,
    d.IsCurrent,
    d.DocumentType,
    d.DocumentStatus,
    d.IngestionStatus,
    ISNULL(d.AuthorityCategory, r.SourceType) AS AuthorityCategory,
    ISNULL(r.Priority, ISNULL(d.AuthorityRank, 4)) AS AuthorityPriority,
    e.EntityId,
    ISNULL(e.EntityName, f.Entity) AS EntityName,
    m.MetricId,
    ISNULL(m.CanonicalMetric, f.Metric) AS CanonicalMetric,
    m.MetricCategory,
    f.OriginalLabel,
    p.PeriodId,
    ISNULL(p.PeriodName, f.PeriodLabel) AS PeriodName,
    ISNULL(p.PeriodStart, f.FactDate) AS PeriodStart,
    ISNULL(p.PeriodEnd, f.AsOfDate) AS PeriodEnd,
    ISNULL(f.FactAsOfDate, f.AsOfDate) AS FactAsOfDate,
    f.ReportingBasis,
    f.ReportingScope,
    f.OriginalValue,
    f.OriginalUnit,
    ISNULL(f.NormalizedValue, f.NumericValue) AS NormalizedValue,
    ISNULL(f.NormalizedUnit, f.Unit) AS NormalizedUnit,
    f.Currency,
    f.ValidationStatus,
    f.MappingStatus,
    f.SourceLocationJson,
    ISNULL(f.SourceLocationText, f.SourceLocation) AS SourceLocation,
    ISNULL(f.SourceLocationText, f.SourceLocation) AS SourceLocationText,
    f.ExtractionMethod,
    f.ExtractionConfidence,
    d.AllowedUserGroups,
    f.CreatedAt
FROM dbo.FinancialFacts f
LEFT JOIN dbo.Documents d ON f.DocumentId = d.DocumentId
LEFT JOIN dbo.Entities e ON f.EntityId = e.EntityId
LEFT JOIN dbo.Metrics m ON f.MetricId = m.MetricId
LEFT JOIN dbo.Periods p ON f.PeriodId = p.PeriodId
LEFT JOIN dbo.SourceAuthorityRanks r ON d.AuthorityRank = r.AuthorityRank;
GO

