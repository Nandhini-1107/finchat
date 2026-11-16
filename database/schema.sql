-- ============================================================================
-- FinChat Enterprise Financial & HR RAG - Complete Database Schema
-- Architecture: Dynamic Relational Financial Fact Database
-- Target Database: Azure SQL Database
-- ============================================================================

-- 1. Source Authority Ranks Table
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SourceAuthorityRanks')
BEGIN
    CREATE TABLE dbo.SourceAuthorityRanks (
        AuthorityRank INT NOT NULL PRIMARY KEY,
        SourceType NVARCHAR(100) NOT NULL,
        AuthorityCategory NVARCHAR(100) NULL,
        Description NVARCHAR(500) NULL,
        Priority INT NOT NULL DEFAULT 1,
        ReportingBasis NVARCHAR(50) NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );

    INSERT INTO dbo.SourceAuthorityRanks (AuthorityRank, SourceType, AuthorityCategory, Description, Priority, ReportingBasis, IsActive) VALUES
    (1, 'Audited Financials', 'Audited Financials', 'Audited statutory filings and reports (Highest authority)', 1, 'Actual', 1),
    (2, 'Board Packs / Final', 'Board Packs / Final', 'Approved board reports, executive packs, final settlement files', 2, 'Actual', 1),
    (3, 'Drafts / Working Files', 'Drafts / Working Files', 'Draft estimates, working ledgers, unapproved reports', 3, 'Actual', 1),
    (4, 'Sample / Test', 'Sample / Test', 'Sample test documents and synthetic datasets', 4, 'Actual', 1);
END;

-- 2. Entities Table (Dynamic Companies, Subsidiaries, Business Units, Groups)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Entities')
BEGIN
    CREATE TABLE dbo.Entities (
        EntityId BIGINT IDENTITY(1,1) PRIMARY KEY,
        EntityName NVARCHAR(200) NOT NULL,
        EntityType NVARCHAR(50) NOT NULL DEFAULT 'Company',
        FiscalYearStartMonth INT NOT NULL DEFAULT 1,
        ParentEntityId BIGINT NULL FOREIGN KEY REFERENCES dbo.Entities(EntityId),
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NULL
    );
    CREATE UNIQUE INDEX UX_Entities_Name_Type ON dbo.Entities(EntityName, EntityType);
END;

-- 2b. EntityAliases Table (Approved multilingual company and entity synonyms)
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

-- 3. Metrics Table (Canonical Metric Definitions)
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

-- 3b. MetricAliases Table (Approved multilingual synonyms and aliases)
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

-- 4. Periods Table (Dynamic Reporting Periods)
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

-- 5. Ingestion Runs Table (Execution Tracking)
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
END;

-- 6. Documents Table (Metadata, Versioning & Lineage)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Documents')
BEGIN
    CREATE TABLE dbo.Documents (
        DocumentId BIGINT IDENTITY(1,1) PRIMARY KEY,
        LogicalDocumentId NVARCHAR(100) NULL,
        FileName NVARCHAR(260) NOT NULL,
        FileType NVARCHAR(20) NULL,
        DocumentType NVARCHAR(100) NULL,
        DocumentIssuer NVARCHAR(200) NULL,
        SourceType NVARCHAR(50) NOT NULL DEFAULT 'ManualUpload',
        SharePointFileId NVARCHAR(300) NULL,
        SourceUrl NVARCHAR(1000) NULL,
        FileVersion NVARCHAR(100) NULL,
        VersionNumber INT NULL,
        SupersedesDocumentId BIGINT NULL FOREIGN KEY REFERENCES dbo.Documents(DocumentId),
        DocumentStatus NVARCHAR(50) NULL,
        ReportingBasis NVARCHAR(50) NULL,
        ReportingScope NVARCHAR(50) NULL,
        AuthorityRank INT NULL FOREIGN KEY REFERENCES dbo.SourceAuthorityRanks(AuthorityRank),
        AuthorityCategory NVARCHAR(100) NULL,
        IsCurrent BIT NOT NULL DEFAULT 1,
        SourceJson NVARCHAR(MAX) NULL,
        PreparedDate DATE NULL,
        ApprovalDate DATE NULL,
        AsOfDate DATE NULL,
        PeriodStart DATE NULL,
        PeriodEnd DATE NULL,
        Currency NVARCHAR(10) NULL,
        AllowedUserGroups NVARCHAR(1000) NULL,
        IngestionStatus NVARCHAR(30) NOT NULL DEFAULT 'Processing',
        LastProcessedAt DATETIME2 NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedByUserId NVARCHAR(255) NULL,
        CreatedByName NVARCHAR(150) NULL,
        CreatedByUserName NVARCHAR(150) NULL,
        CreatedByEmail NVARCHAR(255) NULL,
        CreatedByUserEmail NVARCHAR(255) NULL,
        CreatedByDepartment NVARCHAR(100) NULL,
        ModifiedByUserId NVARCHAR(255) NULL,
        ModifiedByName NVARCHAR(150) NULL,
        ModifiedByUserName NVARCHAR(150) NULL,
        ModifiedByEmail NVARCHAR(255) NULL,
        ModifiedByUserEmail NVARCHAR(255) NULL,
        ModifiedAt DATETIME2 NULL,
        FileHash NVARCHAR(128) NULL,
        ContentHash NVARCHAR(64) NULL,
        IndexingStatus NVARCHAR(30) NOT NULL DEFAULT 'NotIndexed',
        UploaderEmail NVARCHAR(255) NULL,
        BlobUri NVARCHAR(1000) NULL,
        -- ConflictHold and OpenConflictId: Cached state columns.
        -- NOT the primary source of truth: WP6 / WP9 recompute document hold dynamically from open conflicts
        -- in dbo.FactConflicts (a document is held if and only if EXISTS any active conflict referencing it).
        ConflictHold BIT NOT NULL DEFAULT 0,
        OpenConflictId BIGINT NULL,
        ProcessingError NVARCHAR(MAX) NULL,
        MetadataJson NVARCHAR(MAX) NULL,
        UpdatedAt DATETIME2 NULL
    );
    CREATE INDEX IX_Documents_LogicalId ON dbo.Documents(LogicalDocumentId);
    CREATE INDEX IX_Documents_SupersedesId ON dbo.Documents(SupersedesDocumentId);
    CREATE INDEX IX_Documents_IngestionStatus ON dbo.Documents(IngestionStatus);
    CREATE INDEX IX_Documents_ContentHash ON dbo.Documents(ContentHash);
    CREATE INDEX IX_Documents_IndexingStatus ON dbo.Documents(IndexingStatus);
    CREATE INDEX IX_Documents_ConflictHold ON dbo.Documents(ConflictHold);
END;

-- 7. Financial Facts Table (Atomic Financial Figures)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FinancialFacts')
BEGIN
    CREATE TABLE dbo.FinancialFacts (
        FactId BIGINT IDENTITY(1,1) PRIMARY KEY,
        DocumentId BIGINT NOT NULL FOREIGN KEY REFERENCES dbo.Documents(DocumentId),
        EntityId BIGINT NULL FOREIGN KEY REFERENCES dbo.Entities(EntityId),
        MetricId BIGINT NULL FOREIGN KEY REFERENCES dbo.Metrics(MetricId),
        PeriodId BIGINT NULL FOREIGN KEY REFERENCES dbo.Periods(PeriodId),
        ReportingBasis NVARCHAR(50) NULL DEFAULT 'Actual',
        ReportingScope NVARCHAR(50) NULL DEFAULT 'Consolidated',
        FactCategory NVARCHAR(100) NULL,
        OriginalLabel NVARCHAR(300) NULL,
        OriginalValue DECIMAL(28,8) NULL,
        OriginalTextValue NVARCHAR(2000) NULL,
        OriginalUnit NVARCHAR(50) NULL,
        NormalizedValue DECIMAL(28,8) NULL,
        NormalizedUnit NVARCHAR(50) NULL,
        Currency NVARCHAR(10) NULL,
        SourceLocationJson NVARCHAR(MAX) NULL,
        SourceLocationText NVARCHAR(500) NULL,
        ExtractionMethod NVARCHAR(50) NULL,
        ExtractionConfidence DECIMAL(5,4) NULL,
        ValidationStatus NVARCHAR(30) NOT NULL DEFAULT 'Validated',
        MappingStatus NVARCHAR(30) NOT NULL DEFAULT 'Approved',
        FactAsOfDate DATE NULL,
        FactIdentityHash CHAR(64) NULL,
        SourceLocationHash CHAR(64) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NULL,
        -- Backward-compatibility columns
        Metric NVARCHAR(200) NULL,
        Entity NVARCHAR(200) NULL,
        PeriodLabel NVARCHAR(100) NULL,
        FactDate DATE NULL,
        AsOfDate DATE NULL,
        NumericValue DECIMAL(19,4) NULL,
        TextValue NVARCHAR(2000) NULL,
        Unit NVARCHAR(50) NULL,
        SourceLocation NVARCHAR(300) NULL,
        SourceFileName NVARCHAR(260) NULL,
        AuthorityRank INT NULL
    );
    CREATE INDEX IX_FinancialFacts_DocumentId ON dbo.FinancialFacts(DocumentId);
    CREATE INDEX IX_FinancialFacts_MetricId ON dbo.FinancialFacts(MetricId);
    CREATE INDEX IX_FinancialFacts_Entity_Metric_Period ON dbo.FinancialFacts(EntityId, MetricId, PeriodId, ReportingBasis);
    CREATE INDEX IX_FinancialFacts_Validation_Mapping ON dbo.FinancialFacts(ValidationStatus, MappingStatus);
    CREATE INDEX IX_FinancialFacts_IdentityHash ON dbo.FinancialFacts(FactIdentityHash);
    CREATE UNIQUE INDEX UX_FinancialFacts_Doc_Identity_Location ON dbo.FinancialFacts(DocumentId, FactIdentityHash, SourceLocationHash) WHERE FactIdentityHash IS NOT NULL AND SourceLocationHash IS NOT NULL;
END;

-- 8. Fact Conflicts Table (Conflict Detection Across Documents)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FactConflicts')
BEGIN
    CREATE TABLE dbo.FactConflicts (
        ConflictId BIGINT IDENTITY(1,1) PRIMARY KEY,
        EntityId BIGINT NULL FOREIGN KEY REFERENCES dbo.Entities(EntityId),
        MetricId BIGINT NULL FOREIGN KEY REFERENCES dbo.Metrics(MetricId),
        PeriodId BIGINT NULL FOREIGN KEY REFERENCES dbo.Periods(PeriodId),
        ReportingBasis NVARCHAR(50) NULL,
        ReportingScope NVARCHAR(50) NULL,
        ConflictType NVARCHAR(100) NOT NULL DEFAULT 'ValueMismatch',
        ConflictStatus NVARCHAR(50) NOT NULL DEFAULT 'Potential',
        RecordIdsJson NVARCHAR(MAX) NULL,
        ConflictDescription NVARCHAR(1000) NULL,
        DifferenceValue DECIMAL(28,8) NULL,
        DifferencePercentage DECIMAL(9,4) NULL,
        ToleranceApplied DECIMAL(9,4) NULL,
        SelectedFactId BIGINT NULL FOREIGN KEY REFERENCES dbo.FinancialFacts(FactId),
        ResolutionReason NVARCHAR(2000) NULL,
        DetectedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        ReviewedBy NVARCHAR(150) NULL,
        ReviewedAt DATETIME2 NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NULL,
        -- Backward-compatibility columns
        FactId1 BIGINT NULL,
        FactId2 BIGINT NULL,
        ConflictReason NVARCHAR(1000) NULL,
        ResolutionStatus NVARCHAR(30) NULL,
        ResolutionNotes NVARCHAR(2000) NULL,
        -- Phase 4.4 Decision Token & Notification columns
        ExistingFactId BIGINT NULL FOREIGN KEY REFERENCES dbo.FinancialFacts(FactId),
        IncomingFactId BIGINT NULL FOREIGN KEY REFERENCES dbo.FinancialFacts(FactId),
        DecisionTokenHash NVARCHAR(128) NULL,
        TokenExpiresAt DATETIME2 NULL,
        ReissueCount INT NOT NULL DEFAULT 0,
        NotificationStatus NVARCHAR(50) NOT NULL DEFAULT 'Pending',
        NotificationRetryCount INT NOT NULL DEFAULT 0,
        NotificationSentAt DATETIME2 NULL,
        NotificationRecipient NVARCHAR(255) NULL,
        NotificationError NVARCHAR(MAX) NULL
        -- ConflictStatus domain values: 'PendingApproval', 'PendingReview', 'Detected',
        -- 'Potential', 'Resolved', 'Rejected', 'Escalated', 'Moot'
    );
    CREATE INDEX IX_FactConflicts_Status ON dbo.FactConflicts(ConflictStatus);
    CREATE INDEX IX_FactConflicts_Entity_Metric_Period ON dbo.FactConflicts(EntityId, MetricId, PeriodId);
    CREATE INDEX IX_FactConflicts_TokenHash ON dbo.FactConflicts(DecisionTokenHash);
    CREATE INDEX IX_FactConflicts_NotificationStatus ON dbo.FactConflicts(NotificationStatus);
END;

-- 9. Fact Conflict Records (Junction for N-way fact conflicts)
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

-- 10. Fact Resolutions Table (Auditable Resolution History)
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

-- 11. Fact Audit Table (Event Audit Trail)
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

-- 12. AuthorityRank Table (SharePoint Author Role/Department Lookup)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AuthorityRank')
BEGIN
    CREATE TABLE dbo.AuthorityRank (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        CreatedByName NVARCHAR(150) NULL,
        CreatedByEmail NVARCHAR(255) NULL,
        CreatedByUserId NVARCHAR(255) NULL,
        JobTitle NVARCHAR(150) NOT NULL,
        Department NVARCHAR(100) NOT NULL,
        AuthorityRank INT NOT NULL,
        AuthorityLevel NVARCHAR(50) NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NULL DEFAULT SYSUTCDATETIME()
    );
END;
GO

-- 13. Reporting View: dbo.vw_FinancialFacts_Complete
IF EXISTS (SELECT 1 FROM sys.views WHERE name = 'vw_FinancialFacts_Complete')
    DROP VIEW dbo.vw_FinancialFacts_Complete;
GO

CREATE VIEW dbo.vw_FinancialFacts_Complete AS
SELECT 
    f.FactId,
    f.DocumentId,
    d.FileName,
    d.LogicalDocumentId,
    d.VersionNumber,
    d.DocumentStatus,
    d.IngestionStatus,
    r.SourceType AS AuthorityCategory,
    ISNULL(r.Priority, ISNULL(d.AuthorityRank, 4)) AS AuthorityPriority,
    e.EntityId,
    ISNULL(e.EntityName, f.Entity) AS EntityName,
    m.MetricId,
    ISNULL(m.CanonicalMetric, f.Metric) AS CanonicalMetric,
    f.OriginalLabel,
    p.PeriodId,
    ISNULL(p.PeriodName, f.PeriodLabel) AS PeriodName,
    ISNULL(p.PeriodStart, f.FactDate) AS PeriodStart,
    ISNULL(p.PeriodEnd, f.AsOfDate) AS PeriodEnd,
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
    f.SourceLocationText,
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
