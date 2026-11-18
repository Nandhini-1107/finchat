require('../utils/config');
const sql = require('mssql');
const crypto = require('crypto');

let pool = null;
let schemaInitialized = false;

/**
 * Ensures all relational tables, indexes, constraints, and views are present.
 * Uses idempotent, safe batches to prevent errors on existing live databases.
 */
async function ensureDatabaseSchema(p) {
    if (schemaInitialized) return;

    try {
        // Batch 1: Authority Ranks
        await p.request().batch(`
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

                EXEC(N'UPDATE dbo.SourceAuthorityRanks SET AuthorityCategory = SourceType WHERE AuthorityCategory IS NULL');
            END;
        `);

        // Batch 2: Entities, EntityAliases, Metrics, MetricAliases, Periods
        await p.request().batch(`
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

            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Entities') AND name = 'FiscalYearStartMonth')
                ALTER TABLE dbo.Entities ADD FiscalYearStartMonth INT NOT NULL DEFAULT 1;

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
        `);

        // Batch 3: IngestionRuns & Documents
        await p.request().batch(`
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

            -- Documents safe column evolution
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
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'FileHash')
                ALTER TABLE dbo.Documents ADD FileHash NVARCHAR(128) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'MetadataJson')
                ALTER TABLE dbo.Documents ADD MetadataJson NVARCHAR(MAX) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'UpdatedAt')
                ALTER TABLE dbo.Documents ADD UpdatedAt DATETIME2 NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'ContentHash')
                ALTER TABLE dbo.Documents ADD ContentHash NVARCHAR(64) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'IndexingStatus')
                ALTER TABLE dbo.Documents ADD IndexingStatus NVARCHAR(30) NOT NULL DEFAULT 'NotIndexed';
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'UploaderEmail')
                ALTER TABLE dbo.Documents ADD UploaderEmail NVARCHAR(255) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'BlobUri')
                ALTER TABLE dbo.Documents ADD BlobUri NVARCHAR(1000) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'ConflictHold')
                ALTER TABLE dbo.Documents ADD ConflictHold BIT NOT NULL DEFAULT 0;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'OpenConflictId')
                ALTER TABLE dbo.Documents ADD OpenConflictId BIGINT NULL;

            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Documents_LogicalId' AND object_id = OBJECT_ID('dbo.Documents'))
                CREATE INDEX IX_Documents_LogicalId ON dbo.Documents(LogicalDocumentId);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Documents_SupersedesId' AND object_id = OBJECT_ID('dbo.Documents'))
                CREATE INDEX IX_Documents_SupersedesId ON dbo.Documents(SupersedesDocumentId);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Documents_ContentHash' AND object_id = OBJECT_ID('dbo.Documents'))
                CREATE INDEX IX_Documents_ContentHash ON dbo.Documents(ContentHash);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Documents_IndexingStatus' AND object_id = OBJECT_ID('dbo.Documents'))
                CREATE INDEX IX_Documents_IndexingStatus ON dbo.Documents(IndexingStatus);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Documents_ConflictHold' AND object_id = OBJECT_ID('dbo.Documents'))
                CREATE INDEX IX_Documents_ConflictHold ON dbo.Documents(ConflictHold);
        `);

        // Batch 4: FinancialFacts
        await p.request().batch(`
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
                    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    UpdatedAt DATETIME2 NULL,
                    -- Backward compatibility columns
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
            END;

            -- FinancialFacts safe column evolution
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
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'UpdatedAt')
                ALTER TABLE dbo.FinancialFacts ADD UpdatedAt DATETIME2 NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'Unit')
                ALTER TABLE dbo.FinancialFacts ADD Unit NVARCHAR(50) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'AsOfDate')
                ALTER TABLE dbo.FinancialFacts ADD AsOfDate DATE NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'FactIdentityHash')
                ALTER TABLE dbo.FinancialFacts ADD FactIdentityHash CHAR(64) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FinancialFacts') AND name = 'SourceLocationHash')
                ALTER TABLE dbo.FinancialFacts ADD SourceLocationHash CHAR(64) NULL;

            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FinancialFacts_IdentityHash' AND object_id = OBJECT_ID('dbo.FinancialFacts'))
                CREATE INDEX IX_FinancialFacts_IdentityHash ON dbo.FinancialFacts(FactIdentityHash);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FinancialFacts_Doc_Identity_Location' AND object_id = OBJECT_ID('dbo.FinancialFacts'))
                CREATE UNIQUE INDEX UX_FinancialFacts_Doc_Identity_Location ON dbo.FinancialFacts(DocumentId, FactIdentityHash, SourceLocationHash) WHERE FactIdentityHash IS NOT NULL AND SourceLocationHash IS NOT NULL;
        `);

        // Batch 5: Conflicts, ConflictRecords, Resolutions, Audit
        await p.request().batch(`
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
                    -- Backward compatibility columns
                    FactId1 BIGINT NULL,
                    FactId2 BIGINT NULL,
                    ConflictReason NVARCHAR(1000) NULL,
                    ResolutionStatus NVARCHAR(30) NULL,
                    ResolutionNotes NVARCHAR(2000) NULL,
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
                );
            END;

            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'DecisionTokenHash')
                ALTER TABLE dbo.FactConflicts ADD DecisionTokenHash NVARCHAR(128) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'TokenExpiresAt')
                ALTER TABLE dbo.FactConflicts ADD TokenExpiresAt DATETIME2 NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'ReissueCount')
                ALTER TABLE dbo.FactConflicts ADD ReissueCount INT NOT NULL DEFAULT 0;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'NotificationStatus')
                ALTER TABLE dbo.FactConflicts ADD NotificationStatus NVARCHAR(50) NOT NULL DEFAULT 'Pending';
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'NotificationRetryCount')
                ALTER TABLE dbo.FactConflicts ADD NotificationRetryCount INT NOT NULL DEFAULT 0;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'NotificationSentAt')
                ALTER TABLE dbo.FactConflicts ADD NotificationSentAt DATETIME2 NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'NotificationRecipient')
                ALTER TABLE dbo.FactConflicts ADD NotificationRecipient NVARCHAR(255) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'NotificationError')
                ALTER TABLE dbo.FactConflicts ADD NotificationError NVARCHAR(MAX) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'ExistingFactId')
                ALTER TABLE dbo.FactConflicts ADD ExistingFactId BIGINT NULL FOREIGN KEY REFERENCES dbo.FinancialFacts(FactId);
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'IncomingFactId')
                ALTER TABLE dbo.FactConflicts ADD IncomingFactId BIGINT NULL FOREIGN KEY REFERENCES dbo.FinancialFacts(FactId);
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'Reminder24SentAt')
                ALTER TABLE dbo.FactConflicts ADD Reminder24SentAt DATETIME2 NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'Reminder48SentAt')
                ALTER TABLE dbo.FactConflicts ADD Reminder48SentAt DATETIME2 NULL;

            -- Indexes for FactConflicts performance and security
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FactConflicts_TokenHash' AND object_id = OBJECT_ID('dbo.FactConflicts'))
                CREATE INDEX IX_FactConflicts_TokenHash ON dbo.FactConflicts(DecisionTokenHash);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FactConflicts_NotificationStatus' AND object_id = OBJECT_ID('dbo.FactConflicts'))
                CREATE INDEX IX_FactConflicts_NotificationStatus ON dbo.FactConflicts(NotificationStatus);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FactConflicts_Status' AND object_id = OBJECT_ID('dbo.FactConflicts'))
                CREATE INDEX IX_FactConflicts_Status ON dbo.FactConflicts(ConflictStatus);

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
            END;

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
            END;

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
        `);

        // Batch 6: Complete Reporting View
        await p.request().batch(`
            IF EXISTS (SELECT 1 FROM sys.views WHERE name = 'vw_FinancialFacts_Complete')
                DROP VIEW dbo.vw_FinancialFacts_Complete;
        `);

        await p.request().batch(`
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
            LEFT JOIN dbo.SourceAuthorityRanks r ON d.AuthorityRank = r.AuthorityRank
            WHERE f.MappingStatus = 'Approved' 
              AND ISNULL(d.ConflictHold, 0) = 0
              AND d.IngestionStatus = 'Succeeded'
              AND (d.DocumentStatus IS NULL OR d.DocumentStatus NOT IN ('Superseded', 'Rejected', 'Held', 'PendingApproval'));
        `);

        // Batch 8: Master Schema Backfill & Data Integrity (WP13)
        await p.request().batch(`
            -- Backfill historical NULL-status facts to NeedsReview
            UPDATE dbo.FinancialFacts SET MappingStatus = 'NeedsReview' WHERE MappingStatus IS NULL;
            UPDATE dbo.Documents SET IndexingStatus = 'NotIndexed' WHERE IndexingStatus IS NULL;
            UPDATE dbo.Documents SET ConflictHold = 0 WHERE ConflictHold IS NULL;
            UPDATE dbo.FinancialFacts SET SourceLocationHash = CONVERT(CHAR(64), HASHBYTES('SHA2_256', ISNULL(SourceLocationJson, ISNULL(SourceLocationText, CONCAT(CAST(DocumentId AS NVARCHAR(30)), ':', ISNULL(Metric, 'UNKNOWN'), ':', ISNULL(PeriodLabel, 'UNKNOWN'))))), 2) WHERE SourceLocationHash IS NULL;
            UPDATE dbo.FinancialFacts SET FactIdentityHash = CONVERT(CHAR(64), HASHBYTES('SHA2_256', LOWER(CONCAT(ISNULL(Entity, 'unknown'), '|', ISNULL(Metric, ISNULL(OriginalLabel, 'unknown')), '|', ISNULL(PeriodLabel, 'unknown'), '|', ISNULL(ReportingBasis, 'actual'), '|', ISNULL(Unit, ISNULL(NormalizedUnit, 'amount')), '|', ISNULL(Currency, '')))), 2) WHERE FactIdentityHash IS NULL;
        `);

        schemaInitialized = true;
    } catch (err) {
        console.warn('Notice: Automatic database schema initialization encountered an issue:', err.message);
    }
}

async function getPool() {
    if (pool && pool.connected) {
        return pool;
    }

    const config = {
        server: process.env.AZURE_SQL_SERVER,
        database: process.env.AZURE_SQL_DATABASE,
        user: process.env.AZURE_SQL_USER,
        password: process.env.AZURE_SQL_PASSWORD,
        options: {
            encrypt: process.env.AZURE_SQL_ENCRYPT !== 'false',
            trustServerCertificate: process.env.AZURE_SQL_TRUST_CERT === 'true' || process.env.AZURE_SQL_ENCRYPT === 'false'
        },
        connectionTimeout: 60000,
        requestTimeout: 60000,
        pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000
        }
    };

    pool = await sql.connect(config);
    await ensureDatabaseSchema(pool);
    return pool;
}

function setPool(customPool) {
    pool = customPool;
}

function resetPool() {
    pool = null;
    schemaInitialized = false;
}

// ----------------------------------------------------------------------------
// Dynamic Entity, Metric, Period Helpers
// ----------------------------------------------------------------------------

/**
 * Finds an existing entity or inserts a new one dynamically.
 * Zero hardcoded entities.
 */
async function findOrCreateEntity(entityName, entityType = 'Company', parentEntityId = null) {
    if (!entityName || typeof entityName !== 'string') return null;
    const cleanName = entityName.trim();
    if (!cleanName) return null;

    const p = await getPool();
    const result = await p.request()
        .input('EntityName', sql.NVarChar(200), cleanName)
        .input('EntityType', sql.NVarChar(50), entityType || 'Company')
        .input('ParentEntityId', sql.BigInt, parentEntityId || null)
        .query(`
            MERGE INTO dbo.Entities WITH (HOLDLOCK) AS target
            USING (SELECT @EntityName AS EntityName, @EntityType AS EntityType) AS source
            ON target.EntityName = source.EntityName AND target.EntityType = source.EntityType
            WHEN MATCHED THEN
                UPDATE SET UpdatedAt = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN
                INSERT (EntityName, EntityType, ParentEntityId, IsActive, CreatedAt)
                VALUES (source.EntityName, source.EntityType, @ParentEntityId, 1, SYSUTCDATETIME())
            OUTPUT $action, inserted.EntityId;
        `);

    return result.recordset[0]?.EntityId || null;
}

/**
 * Finds an existing canonical metric or registers a new one dynamically.
 * Zero hardcoded metrics.
 */
async function findOrCreateMetric(canonicalMetric, metricCategory = null, measurementType = 'Amount', defaultUnit = null) {
    if (!canonicalMetric || typeof canonicalMetric !== 'string') return null;
    const cleanMetric = canonicalMetric.trim();
    if (!cleanMetric) return null;

    const p = await getPool();
    const result = await p.request()
        .input('CanonicalMetric', sql.NVarChar(200), cleanMetric)
        .input('MetricCategory', sql.NVarChar(100), metricCategory || null)
        .input('MeasurementType', sql.NVarChar(50), measurementType || 'Amount')
        .input('DefaultUnit', sql.NVarChar(50), defaultUnit || null)
        .query(`
            MERGE INTO dbo.Metrics WITH (HOLDLOCK) AS target
            USING (SELECT @CanonicalMetric AS CanonicalMetric) AS source
            ON target.CanonicalMetric = source.CanonicalMetric
            WHEN MATCHED THEN
                UPDATE SET UpdatedAt = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN
                INSERT (CanonicalMetric, MetricCategory, Definition, MeasurementType, DefaultUnit, ApprovedStatus, IsActive, CreatedAt)
                VALUES (source.CanonicalMetric, @MetricCategory, NULL, @MeasurementType, @DefaultUnit, 'Approved', 1, SYSUTCDATETIME())
            OUTPUT $action, inserted.MetricId;
        `);

    return result.recordset[0]?.MetricId || null;
}

/**
 * Finds an existing reporting period or creates a new one dynamically.
 * Zero hardcoded periods.
 */
async function findOrCreatePeriod(periodName, periodStart = null, periodEnd = null, periodType = 'CustomRange', financialYear = null) {
    if (!periodName || typeof periodName !== 'string') return null;
    const cleanName = periodName.trim();
    if (!cleanName) return null;

    const p = await getPool();
    const result = await p.request()
        .input('PeriodName', sql.NVarChar(100), cleanName)
        .input('PeriodType', sql.NVarChar(50), periodType || 'CustomRange')
        .input('PeriodStart', sql.Date, periodStart ? new Date(periodStart) : null)
        .input('PeriodEnd', sql.Date, periodEnd ? new Date(periodEnd) : null)
        .input('FinancialYear', sql.NVarChar(20), financialYear || null)
        .query(`
            DECLARE @FoundId BIGINT;
            SELECT TOP 1 @FoundId = PeriodId 
            FROM dbo.Periods 
            WHERE PeriodName = @PeriodName 
              AND ((@PeriodStart IS NULL AND PeriodStart IS NULL) OR PeriodStart = @PeriodStart)
              AND ((@PeriodEnd IS NULL AND PeriodEnd IS NULL) OR PeriodEnd = @PeriodEnd);

            IF @FoundId IS NOT NULL
            BEGIN
                SELECT @FoundId AS PeriodId;
            END
            ELSE
            BEGIN
                INSERT INTO dbo.Periods (PeriodName, PeriodType, PeriodStart, PeriodEnd, FinancialYear, CreatedAt)
                OUTPUT INSERTED.PeriodId
                VALUES (@PeriodName, @PeriodType, @PeriodStart, @PeriodEnd, @FinancialYear, SYSUTCDATETIME());
            END
        `);

    return result.recordset[0]?.PeriodId || null;
}

/**
 * Resolves an entity string to its canonical EntityId and EntityName via EntityAliases.
 * In Phase 1 & Rule A.4, entity aliases are matched in English or Arabic.
 */
async function resolveEntityAlias(entityText, langCode = null) {
    if (!entityText || typeof entityText !== 'string') return null;
    const cleanText = entityText.trim();
    if (!cleanText) return null;

    const p = await getPool();
    const req = p.request().input('AliasText', sql.NVarChar(200), cleanText);
    let query = `
        SELECT TOP 1 a.EntityId, e.EntityName, e.FiscalYearStartMonth
        FROM dbo.EntityAliases a
        JOIN dbo.Entities e ON a.EntityId = e.EntityId
        WHERE LOWER(a.AliasText) = LOWER(@AliasText)
    `;
    if (langCode) {
        req.input('LanguageCode', sql.NVarChar(10), langCode);
        query += ` AND a.LanguageCode = @LanguageCode`;
    }
    query += ` ORDER BY a.IsApproved DESC, a.AliasId ASC`;
    const res = await req.query(query).catch(() => ({ recordset: [] }));
    if (res.recordset && res.recordset.length > 0) {
        return {
            entityId: res.recordset[0].EntityId,
            entityName: res.recordset[0].EntityName,
            fiscalYearStartMonth: res.recordset[0].FiscalYearStartMonth || 1
        };
    }

    // Direct lookup on Entities table
    const directReq = p.request().input('EntityName', sql.NVarChar(200), cleanText);
    const directRes = await directReq.query(`
        SELECT TOP 1 EntityId, EntityName, FiscalYearStartMonth
        FROM dbo.Entities
        WHERE LOWER(EntityName) = LOWER(@EntityName)
    `).catch(() => ({ recordset: [] }));
    if (directRes.recordset && directRes.recordset.length > 0) {
        return {
            entityId: directRes.recordset[0].EntityId,
            entityName: directRes.recordset[0].EntityName,
            fiscalYearStartMonth: directRes.recordset[0].FiscalYearStartMonth || 1
        };
    }
    return null;
}

/**
 * Resolves a financial or HR metric label to its canonical MetricId and CanonicalMetric via MetricAliases.
 */
async function resolveMetricAlias(metricText, langCode = null) {
    if (!metricText || typeof metricText !== 'string') return null;
    const cleanText = metricText.trim();
    if (!cleanText) return null;

    const p = await getPool();
    const req = p.request().input('AliasText', sql.NVarChar(200), cleanText);
    let query = `
        SELECT TOP 1 a.MetricId, m.CanonicalMetric
        FROM dbo.MetricAliases a
        JOIN dbo.Metrics m ON a.MetricId = m.MetricId
        WHERE LOWER(a.AliasText) = LOWER(@AliasText)
    `;
    if (langCode) {
        req.input('LanguageCode', sql.NVarChar(10), langCode);
        query += ` AND a.LanguageCode = @LanguageCode`;
    }
    query += ` ORDER BY a.IsApproved DESC, a.AliasId ASC`;
    const res = await req.query(query).catch(() => ({ recordset: [] }));
    if (res.recordset && res.recordset.length > 0) {
        return {
            metricId: res.recordset[0].MetricId,
            canonicalMetric: res.recordset[0].CanonicalMetric
        };
    }

    // Direct lookup on Metrics table
    const directReq = p.request().input('CanonicalMetric', sql.NVarChar(200), cleanText);
    const directRes = await directReq.query(`
        SELECT TOP 1 MetricId, CanonicalMetric
        FROM dbo.Metrics
        WHERE LOWER(CanonicalMetric) = LOWER(@CanonicalMetric)
    `).catch(() => ({ recordset: [] }));
    if (directRes.recordset && directRes.recordset.length > 0) {
        return {
            metricId: directRes.recordset[0].MetricId,
            canonicalMetric: directRes.recordset[0].CanonicalMetric
        };
    }
    return null;
}

/**
 * Retrieves the fiscal year start month configured for an entity (1 = January, 4 = April, etc.).
 */
async function getEntityFiscalYearStartMonth(entityId) {
    if (!entityId) return 1;
    const p = await getPool();
    const res = await p.request()
        .input('EntityId', sql.BigInt, entityId)
        .query(`SELECT FiscalYearStartMonth FROM dbo.Entities WHERE EntityId = @EntityId`)
        .catch(() => ({ recordset: [] }));
    if (res.recordset && res.recordset.length > 0 && res.recordset[0].FiscalYearStartMonth) {
        return res.recordset[0].FiscalYearStartMonth;
    }
    return 1;
}

/**
 * Updates a document's conflict hold flag and associated open conflict ID.
 */
async function updateDocumentHold(documentId, isHeld, openConflictId = null) {
    const p = await getPool();
    await p.request()
        .input('DocumentId', sql.BigInt, documentId)
        .input('ConflictHold', sql.Bit, isHeld ? 1 : 0)
        .input('OpenConflictId', sql.BigInt, openConflictId || null)
        .query(`
            UPDATE dbo.Documents
            SET ConflictHold = @ConflictHold,
                OpenConflictId = @OpenConflictId,
                UpdatedAt = SYSUTCDATETIME()
            WHERE DocumentId = @DocumentId
        `);
}

/**
 * Recomputes and updates a document's ConflictHold flag based on whether
 * any active conflicts remain for this document in dbo.FactConflicts.
 */
async function recomputeDocumentHold(documentId) {
    if (!documentId) return false;
    const p = await getPool();
    const res = await p.request()
        .input('DocumentId', sql.BigInt, documentId)
        .query(`
            SELECT COUNT(*) AS ActiveConflictCount
            FROM dbo.FactConflicts c
            WHERE c.ConflictStatus IN ('PendingApproval', 'PendingReview', 'Detected', 'Potential', 'Escalated')
              AND (
                  c.ExistingFactId IN (SELECT FactId FROM dbo.FinancialFacts WHERE DocumentId = @DocumentId)
                  OR c.IncomingFactId IN (SELECT FactId FROM dbo.FinancialFacts WHERE DocumentId = @DocumentId)
                  OR EXISTS (
                      SELECT 1 FROM dbo.FactConflictRecords cr
                      JOIN dbo.FinancialFacts f ON cr.FactId = f.FactId
                      WHERE cr.ConflictId = c.ConflictId AND f.DocumentId = @DocumentId
                  )
              )
        `);

    const activeCount = res.recordset?.[0]?.ActiveConflictCount || 0;
    const isHeld = activeCount > 0;

    await p.request()
        .input('DocumentId', sql.BigInt, documentId)
        .input('ConflictHold', sql.Bit, isHeld ? 1 : 0)
        .query(`
            UPDATE dbo.Documents
            SET ConflictHold = @ConflictHold,
                UpdatedAt = SYSUTCDATETIME()
            WHERE DocumentId = @DocumentId
        `);

    return isHeld;
}

/**
 * Acquires an exclusive application lock for concurrency serialization on a fact identity key or hash.
 */
async function acquireFactAppLock(req, lockKey, timeoutMs = 15000) {
    if (!req || !lockKey) return false;
    try {
        const lockResource = `FactLock_${String(lockKey).substring(0, 200)}`;
        await req
            .input('LockResource', sql.NVarChar(255), lockResource)
            .input('LockTimeout', sql.Int, timeoutMs)
            .query(`
                DECLARE @result INT;
                EXEC @result = sp_getapplock 
                    @Resource = @LockResource, 
                    @LockMode = 'Exclusive', 
                    @LockOwner = 'Transaction', 
                    @LockTimeout = @LockTimeout;
                IF @result < 0
                BEGIN
                    THROW 50001, 'Failed to acquire application lock for fact identity', 1;
                END
            `);
        return true;
    } catch (err) {
        if (err.message && (err.message.includes('Could not find stored procedure') || err.message.includes('mock') || err.message.includes('not supported') || err.number === 2812)) {
            return false;
        }
        throw err;
    }
}

// ----------------------------------------------------------------------------
// Core Document & Ingestion Operations
// ----------------------------------------------------------------------------

async function ensureDefaultAuthorityRank(rank = 4, sourceType = 'ManualUpload', description = 'Manual document upload') {
    const p = await getPool();
    await p.request()
        .input('Rank', sql.Int, rank)
        .input('SourceType', sql.NVarChar(100), sourceType)
        .input('Description', sql.NVarChar(500), description)
        .query(`
            IF NOT EXISTS (SELECT 1 FROM dbo.SourceAuthorityRanks WHERE AuthorityRank = @Rank)
            BEGIN
                INSERT INTO dbo.SourceAuthorityRanks (AuthorityRank, SourceType, Description, Priority, ReportingBasis, IsActive)
                VALUES (@Rank, @SourceType, @Description, @Rank, 'Actual', 1)
            END
        `);
}

async function startIngestionRun(filesDiscovered = 1, triggeredBy = 'Timer', correlationId = null) {
    const p = await getPool();
    const result = await p.request()
        .input('FilesDiscovered', sql.Int, filesDiscovered)
        .input('TriggeredBy', sql.NVarChar(50), triggeredBy)
        .input('CorrelationId', sql.NVarChar(100), correlationId)
        .query(`
            INSERT INTO dbo.IngestionRuns 
                (StartedAt, FilesDiscovered, FilesSucceeded, FilesFailed, RunStatus, TriggeredBy, CorrelationId)
            OUTPUT INSERTED.RunId
            VALUES 
                (SYSUTCDATETIME(), @FilesDiscovered, 0, 0, 'Processing', @TriggeredBy, @CorrelationId)
        `);
    return result.recordset[0].RunId;
}

async function completeIngestionRun(runId, filesSucceeded, filesFailed, runStatus, errorSummary = null) {
    const p = await getPool();
    await p.request()
        .input('RunId', sql.BigInt, runId)
        .input('FilesSucceeded', sql.Int, filesSucceeded)
        .input('FilesFailed', sql.Int, filesFailed)
        .input('RunStatus', sql.NVarChar(30), runStatus)
        .input('ErrorSummary', sql.NVarChar(sql.MAX), errorSummary)
        .query(`
            UPDATE dbo.IngestionRuns
            SET CompletedAt = SYSUTCDATETIME(),
                FilesSucceeded = @FilesSucceeded,
                FilesFailed = @FilesFailed,
                RunStatus = @RunStatus,
                ErrorSummary = @ErrorSummary
            WHERE RunId = @RunId
        `);
}

async function updateIngestionRunProgress(runId, isSuccess = true, errorSummary = null) {
    if (!runId) return;
    const p = await getPool();
    await p.request()
        .input('RunId', sql.BigInt, runId)
        .input('IsSuccess', sql.Bit, isSuccess ? 1 : 0)
        .input('ErrorSummary', sql.NVarChar(sql.MAX), errorSummary)
        .query(`
            UPDATE dbo.IngestionRuns
            SET FilesSucceeded = FilesSucceeded + CASE WHEN @IsSuccess = 1 THEN 1 ELSE 0 END,
                FilesFailed = FilesFailed + CASE WHEN @IsSuccess = 0 THEN 1 ELSE 0 END,
                ErrorSummary = CASE 
                    WHEN @ErrorSummary IS NOT NULL AND ErrorSummary IS NULL THEN @ErrorSummary
                    WHEN @ErrorSummary IS NOT NULL THEN SUBSTRING(ErrorSummary + CHAR(10) + @ErrorSummary, 1, 4000)
                    ELSE ErrorSummary
                END
            WHERE RunId = @RunId
        `);
}

/**
 * Creates a new document record. Supports both legacy positional parameters
 * and a rich options object for full versioning and reporting context metadata.
 */
async function createDocument(docDataOrFileName, sourceType = 'ManualUpload', authorityRank = 4, allowedUserGroups = null) {
    let opts = {};
    if (typeof docDataOrFileName === 'object' && docDataOrFileName !== null) {
        opts = docDataOrFileName;
    } else {
        opts = {
            fileName: docDataOrFileName,
            sourceType,
            authorityRank,
            allowedUserGroups
        };
    }

    const rank = opts.authorityRank || 4;
    const sType = opts.sourceType || 'ManualUpload';
    await ensureDefaultAuthorityRank(rank, sType);

    const createdEmail = opts.createdByEmail || opts.uploaderEmail || opts.modifiedUserEmail || null;
    const modifiedEmail = opts.modifiedByEmail || opts.uploaderEmail || opts.modifiedUserEmail || null;
    const createdName = opts.createdByName || opts.createdByUserName || null;
    const modifiedName = opts.modifiedByName || opts.modifiedByUserName || null;

    const p = await getPool();
    const result = await p.request()
        .input('FileName', sql.NVarChar(260), opts.fileName)
        .input('SourceType', sql.NVarChar(50), sType)
        .input('AuthorityRank', sql.Int, rank)
        .input('AllowedUserGroups', sql.NVarChar(1000), opts.allowedUserGroups || null)
        .input('LogicalDocumentId', sql.NVarChar(100), opts.logicalDocumentId || null)
        .input('FileType', sql.NVarChar(20), opts.fileType || null)
        .input('DocumentType', sql.NVarChar(100), opts.documentType || null)
        .input('DocumentIssuer', sql.NVarChar(200), opts.documentIssuer || null)
        .input('SharePointFileId', sql.NVarChar(300), opts.sharePointFileId || null)
        .input('SourceUrl', sql.NVarChar(1000), opts.sourceUrl || null)
        .input('FileVersion', sql.NVarChar(100), opts.fileVersion || null)
        .input('VersionNumber', sql.Int, opts.versionNumber || 1)
        .input('SupersedesDocumentId', sql.BigInt, opts.supersedesDocumentId || null)
        .input('DocumentStatus', sql.NVarChar(50), opts.documentStatus || 'Draft')
        .input('ReportingBasis', sql.NVarChar(50), opts.reportingBasis || 'Actual')
        .input('ReportingScope', sql.NVarChar(50), opts.reportingScope || 'Consolidated')
        .input('PreparedDate', sql.Date, opts.preparedDate ? new Date(opts.preparedDate) : null)
        .input('ApprovalDate', sql.Date, opts.approvalDate ? new Date(opts.approvalDate) : null)
        .input('AsOfDate', sql.Date, opts.asOfDate ? new Date(opts.asOfDate) : null)
        .input('PeriodStart', sql.Date, opts.periodStart ? new Date(opts.periodStart) : null)
        .input('PeriodEnd', sql.Date, opts.periodEnd ? new Date(opts.periodEnd) : null)
        .input('Currency', sql.NVarChar(10), opts.currency || null)
        .input('MetadataJson', sql.NVarChar(sql.MAX), opts.metadataJson ? JSON.stringify(opts.metadataJson) : null)
        .input('FileHash', sql.NVarChar(128), opts.fileHash || opts.contentHash || null)
        .input('ContentHash', sql.NVarChar(64), opts.contentHash || null)
        .input('IndexingStatus', sql.NVarChar(30), opts.indexingStatus || 'NotIndexed')
        .input('UploaderEmail', sql.NVarChar(255), opts.uploaderEmail || modifiedEmail || createdEmail)
        .input('CreatedByUserId', sql.NVarChar(255), opts.createdByUserId || null)
        .input('CreatedByName', sql.NVarChar(150), createdName)
        .input('CreatedByUserName', sql.NVarChar(150), createdName)
        .input('CreatedByEmail', sql.NVarChar(255), createdEmail)
        .input('CreatedByUserEmail', sql.NVarChar(255), createdEmail)
        .input('CreatedByDepartment', sql.NVarChar(100), opts.createdByDepartment || opts.department || null)
        .input('ModifiedByUserId', sql.NVarChar(255), opts.modifiedByUserId || null)
        .input('ModifiedByName', sql.NVarChar(150), modifiedName)
        .input('ModifiedByUserName', sql.NVarChar(150), modifiedName)
        .input('ModifiedByEmail', sql.NVarChar(255), modifiedEmail)
        .input('ModifiedByUserEmail', sql.NVarChar(255), modifiedEmail)
        .input('ModifiedAt', sql.DateTime2, opts.modifiedAt ? new Date(opts.modifiedAt) : (opts.modifiedDate ? new Date(opts.modifiedDate) : null))
        .input('BlobUri', sql.NVarChar(1000), opts.blobUri || null)
        .input('ConflictHold', sql.Bit, opts.conflictHold ? 1 : 0)
        .input('OpenConflictId', sql.BigInt, opts.openConflictId || null)
        .query(`
            INSERT INTO dbo.Documents 
                (FileName, SourceType, AuthorityRank, AllowedUserGroups, IngestionStatus, CreatedAt,
                 LogicalDocumentId, FileType, DocumentType, DocumentIssuer, SharePointFileId, SourceUrl,
                 FileVersion, VersionNumber, SupersedesDocumentId, DocumentStatus, ReportingBasis,
                 ReportingScope, PreparedDate, ApprovalDate, AsOfDate, PeriodStart, PeriodEnd, Currency, MetadataJson,
                 FileHash, ContentHash, IndexingStatus, UploaderEmail,
                 CreatedByUserId, CreatedByName, CreatedByUserName, CreatedByEmail, CreatedByUserEmail, CreatedByDepartment,
                 ModifiedByUserId, ModifiedByName, ModifiedByUserName, ModifiedByEmail, ModifiedByUserEmail, ModifiedAt,
                 BlobUri, ConflictHold, OpenConflictId)
            OUTPUT INSERTED.DocumentId
            VALUES 
                (@FileName, @SourceType, @AuthorityRank, @AllowedUserGroups, 'Processing', SYSUTCDATETIME(),
                 @LogicalDocumentId, @FileType, @DocumentType, @DocumentIssuer, @SharePointFileId, @SourceUrl,
                 @FileVersion, @VersionNumber, @SupersedesDocumentId, @DocumentStatus, @ReportingBasis,
                 @ReportingScope, @PreparedDate, @ApprovalDate, @AsOfDate, @PeriodStart, @PeriodEnd, @Currency, @MetadataJson,
                 @FileHash, @ContentHash, @IndexingStatus, @UploaderEmail,
                 @CreatedByUserId, @CreatedByName, @CreatedByUserName, @CreatedByEmail, @CreatedByUserEmail, @CreatedByDepartment,
                 @ModifiedByUserId, @ModifiedByName, @ModifiedByUserName, @ModifiedByEmail, @ModifiedByUserEmail, @ModifiedAt,
                 @BlobUri, @ConflictHold, @OpenConflictId)
        `);

    return result.recordset[0].DocumentId;
}

/**
 * Updates enriched document metadata (issuer, currency, scope, dates, indexing status, etc.).
 */
async function updateDocumentMetadata(documentId, fields = {}) {
    if (!documentId || typeof fields !== 'object') return;
    const p = await getPool();
    const req = p.request().input('DocumentId', sql.BigInt, Number(documentId));
    const sets = [];

    const fieldMap = {
        DocumentIssuer: sql.NVarChar(200),
        DocumentType: sql.NVarChar(100),
        Currency: sql.NVarChar(10),
        ReportingBasis: sql.NVarChar(50),
        ReportingScope: sql.NVarChar(50),
        DocumentStatus: sql.NVarChar(50),
        IndexingStatus: sql.NVarChar(30),
        AsOfDate: sql.Date,
        PeriodStart: sql.Date,
        PeriodEnd: sql.Date,
        PreparedDate: sql.Date,
        ApprovalDate: sql.Date,
        ContentHash: sql.NVarChar(64),
        FileHash: sql.NVarChar(128),
        MetadataJson: sql.NVarChar(sql.MAX),
        UploaderEmail: sql.NVarChar(255),
        ModifiedByEmail: sql.NVarChar(255),
        ModifiedByName: sql.NVarChar(150),
        ModifiedByUserName: sql.NVarChar(150),
        ModifiedByUserEmail: sql.NVarChar(255),
        ModifiedAt: sql.DateTime2,
        CreatedByEmail: sql.NVarChar(255),
        CreatedByName: sql.NVarChar(150),
        CreatedByUserName: sql.NVarChar(150),
        CreatedByUserEmail: sql.NVarChar(255),
        CreatedByDepartment: sql.NVarChar(100),
        FileType: sql.NVarChar(20),
        LogicalDocumentId: sql.NVarChar(100),
        FileVersion: sql.NVarChar(100),
        SourceUrl: sql.NVarChar(1000)
    };

    for (const [key, sqlType] of Object.entries(fieldMap)) {
        if (fields[key] !== undefined && fields[key] !== null) {
            let val = fields[key];
            if (key === 'MetadataJson' && typeof val === 'object') {
                val = JSON.stringify(val);
            } else if (['AsOfDate', 'PeriodStart', 'PeriodEnd', 'PreparedDate', 'ApprovalDate'].includes(key) && typeof val === 'string') {
                val = new Date(val);
            } else if (key === 'ModifiedAt' && typeof val === 'string') {
                val = new Date(val);
            }
            req.input(key, sqlType, val);
            sets.push(`${key} = @${key}`);
        }
    }

    if (sets.length === 0) return;
    sets.push('UpdatedAt = SYSUTCDATETIME()');

    await req.query(`
        UPDATE dbo.Documents
        SET ${sets.join(', ')}
        WHERE DocumentId = @DocumentId
    `);
}

async function updateDocumentStatus(documentId, status, errorMsg = null) {
    const p = await getPool();
    await p.request()
        .input('DocumentId', sql.BigInt, documentId)
        .input('Status', sql.NVarChar(30), status)
        .input('ProcessingError', sql.NVarChar(sql.MAX), errorMsg)
        .query(`
            UPDATE dbo.Documents
            SET IngestionStatus = @Status,
                ProcessingError = @ProcessingError,
                LastProcessedAt = SYSUTCDATETIME(),
                UpdatedAt = SYSUTCDATETIME()
            WHERE DocumentId = @DocumentId
        `);
}

/**
 * Inserts dynamic financial facts into dbo.FinancialFacts.
 * Preserves OriginalValue and NormalizedValue independently.
 * Automatically resolves and links Entities, Metrics, and Periods.
 */
async function insertFinancialFacts(documentId, facts, defaultRank = 4, sourceFileName = null, options = {}) {
    if (!facts || facts.length === 0) return [];
    const p = await getPool();
    const insertedIds = [];

    for (const fact of facts) {
        // Resolve relational foreign keys dynamically via EntityAliases/MetricAliases if not already provided
        let entityId = fact.entityId || null;
        if (!entityId && fact.entity) {
            const aliasMatch = await resolveEntityAlias(fact.entity);
            if (aliasMatch) {
                entityId = aliasMatch.entityId;
            } else {
                entityId = await findOrCreateEntity(fact.entity, fact.entityType || 'Company');
            }
        }

        let metricId = fact.metricId || null;
        if (!metricId && (fact.metric || fact.originalLabel)) {
            const rawMetric = fact.metric || fact.originalLabel;
            const aliasMatch = await resolveMetricAlias(rawMetric);
            if (aliasMatch) {
                metricId = aliasMatch.metricId;
            } else {
                metricId = await findOrCreateMetric(rawMetric, fact.factCategory || null, fact.measurementType || 'Amount', fact.normalizedUnit || fact.unit);
            }
        }

        let periodId = fact.periodId || null;
        if (!periodId && fact.periodLabel) {
            periodId = await findOrCreatePeriod(fact.periodLabel, fact.periodStart, fact.periodEnd);
        }

        // WP13: Fact completeness & integrity rule
        // Missing any of entity, period, unit, reporting basis, or source location -> NeedsReview (never guessed).
        const rawPeriod = String(fact.periodLabel || '').trim();
        const isHijriUnresolved = (/هـ|hijri|14\d{2}\s*h/i.test(rawPeriod) && !fact.periodStart && !fact.factDate && !fact.asOfDate);
        const isPeriodMissingOrUnknown = !rawPeriod || /^(unknown|unspecified|not specified|n\/a|\?)$/i.test(rawPeriod);
        const isPeriodUnresolved = isHijriUnresolved || isPeriodMissingOrUnknown;

        const hasEntity = Boolean((fact.entity && String(fact.entity).trim() && !/^(unknown|unspecified|n\/a)$/i.test(String(fact.entity).trim())) || entityId);
        const hasPeriod = Boolean(!isPeriodUnresolved && (fact.periodLabel || periodId));
        const hasUnit = Boolean((fact.unit && String(fact.unit).trim()) || (fact.normalizedUnit && String(fact.normalizedUnit).trim()) || (fact.originalUnit && String(fact.originalUnit).trim()));
        const hasReportingBasis = Boolean(fact.reportingBasis && String(fact.reportingBasis).trim() && !/^(unknown|unspecified)$/i.test(String(fact.reportingBasis).trim()));
        const hasSourceLocation = Boolean(
            (fact.sourceLocation && String(fact.sourceLocation).trim()) ||
            (fact.sourceLocationText && String(fact.sourceLocationText).trim()) ||
            (fact.sourceLocationJson && (typeof fact.sourceLocationJson === 'object' ? Object.keys(fact.sourceLocationJson).length > 0 : String(fact.sourceLocationJson).trim().length > 0))
        );

        const isMissingRequiredFields = !hasEntity || !hasPeriod || !hasUnit || !hasReportingBasis || !hasSourceLocation;

        let mappingStatus = options.mappingStatus || fact.mappingStatus || 'Approved';
        if (isMissingRequiredFields) {
            mappingStatus = 'NeedsReview';
        }

        // Logical Identity Hash
        let factIdentityHash = fact.factIdentityHash || fact.identityHash || (fact.logicalIdentity && fact.logicalIdentity.keyHash) || null;
        if (!factIdentityHash) {
            const canonicalKey = `${fact.entity || 'unknown'}|${fact.metric || fact.originalLabel || 'unknown'}|${fact.periodLabel || 'unknown'}|${fact.reportingBasis || 'actual'}|${fact.normalizedUnit || fact.unit || 'amount'}|${fact.currency || ''}`;
            factIdentityHash = crypto.createHash('sha256').update(canonicalKey.toLowerCase(), 'utf8').digest('hex');
        }

        const factFileName = fact.sourceFileName || sourceFileName || null;
        const asOfDate = fact.asOfDate || fact.factDate || null;
        const normVal = fact.normalizedValue !== undefined ? fact.normalizedValue : fact.numericValue;
        const origVal = fact.originalValue !== undefined ? fact.originalValue : fact.numericValue;
        const sourceLocJson = typeof fact.sourceLocationJson === 'object' && fact.sourceLocationJson !== null
            ? JSON.stringify(fact.sourceLocationJson)
            : (fact.sourceLocationJson || null);

        // Source Location Hash (ensures unique index UX_FinancialFacts_Doc_Identity_Location never indexes NVARCHAR(MAX))
        let sourceLocationHash = fact.sourceLocationHash || null;
        if (!sourceLocationHash) {
            const locKey = sourceLocJson || fact.sourceLocationText || fact.sourceLocation || `${documentId}:${fact.originalLabel || fact.metric}:${fact.periodLabel || ''}`;
            sourceLocationHash = crypto.createHash('sha256').update(String(locKey), 'utf8').digest('hex');
        }

        const req = p.request()
            .input('DocumentId', sql.BigInt, documentId)
            .input('EntityId', sql.BigInt, entityId)
            .input('MetricId', sql.BigInt, metricId)
            .input('PeriodId', sql.BigInt, periodId)
            .input('ReportingBasis', sql.NVarChar(50), fact.reportingBasis || 'Actual')
            .input('ReportingScope', sql.NVarChar(50), fact.reportingScope || 'Consolidated')
            .input('FactCategory', sql.NVarChar(100), fact.factCategory || null)
            .input('OriginalLabel', sql.NVarChar(300), fact.originalLabel || fact.metric || null)
            .input('OriginalValue', sql.Decimal(28, 8), origVal !== undefined ? origVal : null)
            .input('OriginalTextValue', sql.NVarChar(2000), fact.originalTextValue || fact.textValue || null)
            .input('OriginalUnit', sql.NVarChar(50), fact.originalUnit || fact.unit || null)
            .input('NormalizedValue', sql.Decimal(28, 8), normVal !== undefined ? normVal : null)
            .input('NormalizedUnit', sql.NVarChar(50), fact.normalizedUnit || fact.unit || null)
            .input('Currency', sql.NVarChar(10), fact.currency || null)
            .input('SourceLocationJson', sql.NVarChar(sql.MAX), sourceLocJson)
            .input('SourceLocationText', sql.NVarChar(500), fact.sourceLocationText || fact.sourceLocation || null)
            .input('ExtractionMethod', sql.NVarChar(50), fact.extractionMethod || 'LocalExtractor')
            .input('ExtractionConfidence', sql.Decimal(5, 4), fact.extractionConfidence !== undefined ? fact.extractionConfidence : null)
            .input('ValidationStatus', sql.NVarChar(30), fact.validationStatus || 'Validated')
            .input('MappingStatus', sql.NVarChar(30), mappingStatus)
            .input('FactIdentityHash', sql.Char(64), factIdentityHash)
            .input('SourceLocationHash', sql.Char(64), sourceLocationHash)
            // Legacy columns
            .input('Metric', sql.NVarChar(200), fact.metric || fact.originalLabel)
            .input('Entity', sql.NVarChar(200), fact.entity || null)
            .input('PeriodLabel', sql.NVarChar(100), fact.periodLabel || 'Not specified')
            .input('FactDate', sql.Date, fact.factDate || null)
            .input('AsOfDate', sql.Date, asOfDate ? new Date(asOfDate) : null)
            .input('NumericValue', sql.Decimal(19, 4), normVal !== undefined ? normVal : null)
            .input('TextValue', sql.NVarChar(2000), fact.textValue || null)
            .input('Unit', sql.NVarChar(50), fact.unit || fact.normalizedUnit || null)
            .input('SourceLocation', sql.NVarChar(300), fact.sourceLocation || fact.sourceLocationText || null)
            .input('SourceFileName', sql.NVarChar(260), factFileName)
            .input('AuthorityRank', sql.Int, fact.authorityRank || defaultRank);

        const result = await req.query(`
            IF NOT EXISTS (
                SELECT 1 FROM dbo.FinancialFacts 
                WHERE DocumentId = @DocumentId 
                  AND FactIdentityHash = @FactIdentityHash 
                  AND SourceLocationHash = @SourceLocationHash
            )
            BEGIN
                INSERT INTO dbo.FinancialFacts
                    (DocumentId, EntityId, MetricId, PeriodId, ReportingBasis, ReportingScope, FactCategory,
                     OriginalLabel, OriginalValue, OriginalTextValue, OriginalUnit, NormalizedValue, NormalizedUnit,
                     Currency, SourceLocationJson, SourceLocationText, ExtractionMethod, ExtractionConfidence,
                     ValidationStatus, MappingStatus, CreatedAt,
                     Metric, Entity, PeriodLabel, FactDate, AsOfDate, NumericValue, TextValue, Unit,
                     SourceLocation, SourceFileName, AuthorityRank, FactIdentityHash, SourceLocationHash)
                OUTPUT INSERTED.FactId
                VALUES
                    (@DocumentId, @EntityId, @MetricId, @PeriodId, @ReportingBasis, @ReportingScope, @FactCategory,
                     @OriginalLabel, @OriginalValue, @OriginalTextValue, @OriginalUnit, @NormalizedValue, @NormalizedUnit,
                     @Currency, @SourceLocationJson, @SourceLocationText, @ExtractionMethod, @ExtractionConfidence,
                     @ValidationStatus, @MappingStatus, SYSUTCDATETIME(),
                     @Metric, @Entity, @PeriodLabel, @FactDate, @AsOfDate, @NumericValue, @TextValue, @Unit,
                     @SourceLocation, @SourceFileName, @AuthorityRank, @FactIdentityHash, @SourceLocationHash)
            END
        `);

        if (result.recordset && result.recordset.length > 0) {
            const insertedId = result.recordset[0].FactId;
            insertedIds.push(insertedId);

            // Record initial extraction audit
            await logFactAudit({
                factId: insertedId,
                documentId,
                actionType: 'Extracted',
                newValue: String(normVal ?? origVal ?? ''),
                actionReason: `Extracted via ${fact.extractionMethod || 'pipeline'}`
            }).catch(() => {});
        }
    }

    return insertedIds;
}

/**
 * Retrieves a document by its DocumentId or FileName
 */
async function getDocumentById(documentId) {
    const p = await getPool();
    const req = p.request();
    let query = '';

    const numId = Number(documentId);
    if (!isNaN(numId) && numId > 0) {
        req.input('DocumentId', sql.BigInt, numId);
        query = 'SELECT * FROM dbo.Documents WHERE DocumentId = @DocumentId';
    } else {
        req.input('FileName', sql.NVarChar(260), String(documentId));
        query = 'SELECT TOP 1 * FROM dbo.Documents WHERE FileName = @FileName ORDER BY DocumentId DESC';
    }

    const result = await req.query(query);
    return result.recordset[0] || null;
}

/**
 * Retrieves a document by its SHA-256 ContentHash (Idempotency check)
 */
async function findDocumentByContentHash(contentHash) {
    if (!contentHash) return null;
    const p = await getPool();
    const result = await p.request()
        .input('ContentHash', sql.NVarChar(64), String(contentHash).trim())
        .query(`
            SELECT TOP 1 DocumentId, FileName, IngestionStatus, ConflictHold, OpenConflictId, CreatedAt
            FROM dbo.Documents
            WHERE ContentHash = @ContentHash
            ORDER BY DocumentId DESC
        `);
    return result.recordset[0] || null;
}

/**
 * Retrieves facts with backward-compatible format for existing handlers
 */
async function getFinancialFacts(documentId = null) {
    return await getCompleteFinancialFacts({ documentId });
}

/**
 * Queries the complete financial facts view (dbo.vw_FinancialFacts_Complete)
 * with user authorization and dimension filters.
 */
async function getCompleteFinancialFacts({
    documentId = null,
    entityName = null,
    canonicalMetric = null,
    periodName = null,
    reportingBasis = null,
    reportingScope = null,
    mappingStatus = null,
    userGroups = null,
    includeAllStatuses = false
} = {}) {
    const p = await getPool();
    const req = p.request();

    let query = `
        SELECT FactId, DocumentId, FileName, LogicalDocumentId, VersionNumber,
               DocumentStatus, IngestionStatus, AuthorityCategory, AuthorityPriority,
               EntityId, EntityName, MetricId, CanonicalMetric, OriginalLabel,
               PeriodId, PeriodName, PeriodStart, PeriodEnd, ReportingBasis, ReportingScope,
               OriginalValue, OriginalUnit, NormalizedValue, NormalizedUnit, Currency,
               ValidationStatus, MappingStatus, SourceLocationJson, SourceLocationText,
               ExtractionMethod, ExtractionConfidence, AllowedUserGroups, CreatedAt,
               -- Aliases for backward compatibility with calculation-engine & chat
               CanonicalMetric AS Metric,
               EntityName AS Entity,
               PeriodName AS PeriodLabel,
               NormalizedValue AS NumericValue,
               NormalizedUnit AS Unit,
               FileName AS SourceFileName,
               AuthorityPriority AS AuthorityRank
        FROM dbo.vw_FinancialFacts_Complete
        WHERE (IngestionStatus IN ('Succeeded', 'Completed', 'Processing', 'PendingApproval') OR IngestionStatus IS NULL)
    `;

    if (mappingStatus) {
        req.input('MappingStatus', sql.NVarChar(50), mappingStatus.trim());
        query += ' AND MappingStatus = @MappingStatus';
    } else if (includeAllStatuses) {
        query += " AND MappingStatus IN ('Approved', 'Pending', 'NeedsReview')";
    } else {
        query += " AND MappingStatus = 'Approved'";
    }

    if (documentId) {
        const numId = Number(documentId);
        if (!isNaN(numId) && numId > 0) {
            req.input('DocumentId', sql.BigInt, numId);
            query += ' AND DocumentId = @DocumentId';
        }
    }

    if (entityName) {
        req.input('EntityName', sql.NVarChar(200), entityName.trim());
        query += ' AND EntityName = @EntityName';
    }

    if (canonicalMetric) {
        req.input('CanonicalMetric', sql.NVarChar(200), canonicalMetric.trim());
        query += ' AND (CanonicalMetric = @CanonicalMetric OR OriginalLabel = @CanonicalMetric)';
    }

    if (periodName) {
        req.input('PeriodName', sql.NVarChar(100), periodName.trim());
        query += ' AND PeriodName = @PeriodName';
    }

    if (reportingBasis) {
        req.input('ReportingBasis', sql.NVarChar(50), reportingBasis.trim());
        query += ' AND ReportingBasis = @ReportingBasis';
    }

    if (reportingScope) {
        req.input('ReportingScope', sql.NVarChar(50), reportingScope.trim());
        query += ' AND ReportingScope = @ReportingScope';
    }

    query += ' ORDER BY FactId ASC';
    const result = await req.query(query);
    let records = result.recordset;

    // Apply document ACL check if userGroups is provided
    if (userGroups && Array.isArray(userGroups)) {
        const cleanUserGroups = userGroups.map(g => String(g).trim().toLowerCase());
        records = records.filter(row => {
            if (!row.AllowedUserGroups) return true;
            const allowed = row.AllowedUserGroups.split(',').map(g => g.trim().toLowerCase());
            return cleanUserGroups.some(ug => allowed.includes(ug)) || allowed.includes('*');
        });
    }

    // WP3 One Effective Fact Rule:
    // If two Approved facts share an identity (Metric, Entity, Period, ReportingBasis, Unit),
    // de-duplicate by selecting the fact from the latest document version (VersionNumber DESC, FactId DESC).
    const effectiveMap = new Map();
    for (const r of records) {
        const key = `${r.EntityName || r.Entity || ''}|${r.CanonicalMetric || r.Metric || ''}|${r.PeriodName || r.PeriodLabel || ''}|${r.ReportingBasis || 'Actual'}|${r.NormalizedUnit || r.Unit || ''}|${r.Currency || ''}`.toLowerCase();
        const existing = effectiveMap.get(key);
        if (!existing) {
            effectiveMap.set(key, r);
        } else {
            const vNew = Number(r.VersionNumber || 1);
            const vOld = Number(existing.VersionNumber || 1);
            if (vNew > vOld || (vNew === vOld && r.FactId > existing.FactId)) {
                effectiveMap.set(key, r);
            }
        }
    }

    return Array.from(effectiveMap.values());
}

/**
 * D7 SQL Allow-list for Azure AI Search:
 * Retrieves IDs of documents that are fully Approved, Indexed, and not on ConflictHold, Superseded, Rejected, or PartiallyApproved.
 * Excludes held, pending, superseded, rejected, and PartiallyApproved documents so their narrative chunks are strictly non-searchable.
 */
async function getSearchAllowList(userGroups = null) {
    const p = await getPool();
    const result = await p.request().query(`
        SELECT DocumentId, FileName, AllowedUserGroups
        FROM dbo.Documents
        WHERE IngestionStatus = 'Succeeded'
          AND IndexingStatus = 'Indexed'
          AND ISNULL(ConflictHold, 0) = 0;
    `);
    let rows = result.recordset || [];
    if (userGroups && Array.isArray(userGroups) && userGroups.length > 0) {
        const cleanUserGroups = userGroups.map(ug => ug.trim().toLowerCase());
        rows = rows.filter(row => {
            if (!row.AllowedUserGroups) return true;
            const allowed = row.AllowedUserGroups.split(',').map(g => g.trim().toLowerCase());
            return cleanUserGroups.some(ug => allowed.includes(ug)) || allowed.includes('*');
        });
    }
    return rows.map(r => String(r.DocumentId));
}

/**
 * Creates a conflict record linking multiple conflicting facts.
 */
async function createFactConflict({
    entityId = null,
    metricId = null,
    periodId = null,
    reportingBasis = 'Actual',
    reportingScope = 'Consolidated',
    conflictType = 'ValueMismatch',
    conflictStatus = 'PendingApproval',
    conflictDescription = '',
    differenceValue = null,
    differencePercentage = null,
    toleranceApplied = null,
    selectedFactId = null,
    resolutionReason = null,
    factIds = [],
    existingFactId = null,
    incomingFactId = null,
    decisionTokenHash = null,
    tokenExpiresAt = null,
    notificationStatus = 'Pending',
    notificationRecipient = null,
    notificationError = null
}) {
    const p = await getPool();

    const f1 = factIds[0] || existingFactId || null;
    const f2 = factIds[1] || incomingFactId || null;
    const eFactId = existingFactId || f1;
    const iFactId = incomingFactId || f2;

    const insertRes = await p.request()
        .input('EntityId', sql.BigInt, entityId)
        .input('MetricId', sql.BigInt, metricId)
        .input('PeriodId', sql.BigInt, periodId)
        .input('ReportingBasis', sql.NVarChar(50), reportingBasis)
        .input('ReportingScope', sql.NVarChar(50), reportingScope)
        .input('ConflictType', sql.NVarChar(100), conflictType)
        .input('ConflictStatus', sql.NVarChar(50), conflictStatus)
        .input('ConflictDescription', sql.NVarChar(1000), conflictDescription)
        .input('DifferenceValue', sql.Decimal(28, 8), differenceValue)
        .input('DifferencePercentage', sql.Decimal(9, 4), differencePercentage)
        .input('ToleranceApplied', sql.Decimal(9, 4), toleranceApplied)
        .input('SelectedFactId', sql.BigInt, selectedFactId)
        .input('ResolutionReason', sql.NVarChar(2000), resolutionReason)
        .input('FactId1', sql.BigInt, f1)
        .input('FactId2', sql.BigInt, f2)
        .input('ExistingFactId', sql.BigInt, eFactId)
        .input('IncomingFactId', sql.BigInt, iFactId)
        .input('DecisionTokenHash', sql.NVarChar(128), decisionTokenHash)
        .input('TokenExpiresAt', sql.DateTime2, tokenExpiresAt ? new Date(tokenExpiresAt) : null)
        .input('NotificationStatus', sql.NVarChar(50), notificationStatus || 'Pending')
        .input('NotificationRecipient', sql.NVarChar(255), notificationRecipient)
        .input('NotificationError', sql.NVarChar(sql.MAX), notificationError)
        .query(`
            INSERT INTO dbo.FactConflicts 
                (EntityId, MetricId, PeriodId, ReportingBasis, ReportingScope, ConflictType,
                 ConflictStatus, ConflictDescription, DifferenceValue, DifferencePercentage,
                 ToleranceApplied, SelectedFactId, ResolutionReason, DetectedAt, CreatedAt,
                 FactId1, FactId2, ConflictReason, ResolutionStatus, ResolutionNotes,
                 ExistingFactId, IncomingFactId, DecisionTokenHash, TokenExpiresAt,
                 NotificationStatus, NotificationRecipient, NotificationError)
            OUTPUT INSERTED.ConflictId
            VALUES 
                (@EntityId, @MetricId, @PeriodId, @ReportingBasis, @ReportingScope, @ConflictType,
                 @ConflictStatus, @ConflictDescription, @DifferenceValue, @DifferencePercentage,
                 @ToleranceApplied, @SelectedFactId, @ResolutionReason, SYSUTCDATETIME(), SYSUTCDATETIME(),
                 @FactId1, @FactId2, @ConflictDescription, @ConflictStatus, @ResolutionReason,
                 @ExistingFactId, @IncomingFactId, @DecisionTokenHash, @TokenExpiresAt,
                 @NotificationStatus, @NotificationRecipient, @NotificationError);
        `);

    const conflictId = insertRes.recordset[0].ConflictId;

    // Link each participating fact in FactConflictRecords
    const allIds = Array.from(new Set([f1, f2, eFactId, iFactId, ...factIds].filter(Boolean)));
    for (const fId of allIds) {
        let role = 'Alternative';
        if (fId === selectedFactId) role = 'Selected';
        else if (fId === eFactId) role = 'Existing';
        else if (fId === iFactId) role = 'IncomingCandidate';

        await p.request()
            .input('ConflictId', sql.BigInt, conflictId)
            .input('FactId', sql.BigInt, fId)
            .input('FactRole', sql.NVarChar(50), role)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM dbo.FactConflictRecords WHERE ConflictId = @ConflictId AND FactId = @FactId)
                BEGIN
                    INSERT INTO dbo.FactConflictRecords (ConflictId, FactId, FactRole, CreatedAt)
                    VALUES (@ConflictId, @FactId, @FactRole, SYSUTCDATETIME());
                END
            `);
    }

    return conflictId;
}

/**
 * Resolves an existing conflict, records the resolution event in dbo.FactResolutions
 */
async function resolveFactConflict(conflictId, {
    selectedFactId,
    resolutionType = 'RuleBased',
    resolutionReason,
    resolutionRule = null,
    resolvedBy = 'System',
    newStatus = 'Resolved'
}) {
    const p = await getPool();

    // Get previous status
    const prevRes = await p.request()
        .input('ConflictId', sql.BigInt, conflictId)
        .query('SELECT ConflictStatus FROM dbo.FactConflicts WHERE ConflictId = @ConflictId');
    const previousStatus = prevRes.recordset[0]?.ConflictStatus || 'Potential';

    // Update conflict
    await p.request()
        .input('ConflictId', sql.BigInt, conflictId)
        .input('SelectedFactId', sql.BigInt, selectedFactId)
        .input('Status', sql.NVarChar(50), newStatus)
        .input('Reason', sql.NVarChar(2000), resolutionReason)
        .input('ReviewedBy', sql.NVarChar(150), resolvedBy)
        .query(`
            UPDATE dbo.FactConflicts 
            SET SelectedFactId = @SelectedFactId,
                ConflictStatus = @Status,
                ResolutionReason = @Reason,
                ResolutionStatus = @Status,
                ResolutionNotes = @Reason,
                ReviewedBy = @ReviewedBy,
                ReviewedAt = SYSUTCDATETIME(),
                UpdatedAt = SYSUTCDATETIME()
            WHERE ConflictId = @ConflictId;
        `);

    // Record resolution in FactResolutions
    await p.request()
        .input('ConflictId', sql.BigInt, conflictId)
        .input('SelectedFactId', sql.BigInt, selectedFactId)
        .input('ResolutionType', sql.NVarChar(50), resolutionType)
        .input('ResolutionReason', sql.NVarChar(2000), resolutionReason)
        .input('ResolutionRule', sql.NVarChar(500), resolutionRule)
        .input('ResolvedBy', sql.NVarChar(150), resolvedBy)
        .input('PreviousStatus', sql.NVarChar(50), previousStatus)
        .input('NewStatus', sql.NVarChar(50), newStatus)
        .query(`
            INSERT INTO dbo.FactResolutions
                (ConflictId, SelectedFactId, ResolutionType, ResolutionReason, ResolutionRule,
                 ResolvedBy, ResolvedAt, PreviousStatus, NewStatus)
            VALUES
                (@ConflictId, @SelectedFactId, @ResolutionType, @ResolutionReason, @ResolutionRule,
                 @ResolvedBy, SYSUTCDATETIME(), @PreviousStatus, @NewStatus);
        `);
}

/**
 * Retrieves a conflict record by its ConflictId with linked facts and documents.
 */
async function getConflictById(conflictId) {
    if (!conflictId) return null;
    const p = await getPool();
    const result = await p.request()
        .input('ConflictId', sql.BigInt, Number(conflictId))
        .query(`
            SELECT c.*,
                   dExisting.FileName AS ExistingFileName,
                   dIncoming.FileName AS IncomingFileName,
                   dIncoming.DocumentId AS IncomingDocumentId,
                   dExisting.DocumentId AS ExistingDocumentId,
                   fExisting.NormalizedValue AS ExistingNormalizedValue,
                   fExisting.Metric AS ExistingMetric,
                   fExisting.Entity AS ExistingEntity,
                   fExisting.PeriodLabel AS ExistingPeriodLabel,
                   fExisting.Currency AS ExistingCurrency,
                   fExisting.Unit AS ExistingUnit,
                   fExisting.MappingStatus AS ExistingMappingStatus,
                   fIncoming.NormalizedValue AS IncomingNormalizedValue,
                   fIncoming.Metric AS IncomingMetric,
                   fIncoming.Entity AS IncomingEntity,
                   fIncoming.PeriodLabel AS IncomingPeriodLabel,
                   fIncoming.Currency AS IncomingCurrency,
                   fIncoming.Unit AS IncomingUnit,
                   fIncoming.MappingStatus AS IncomingMappingStatus
            FROM dbo.FactConflicts c
            LEFT JOIN dbo.FinancialFacts fExisting ON c.ExistingFactId = fExisting.FactId
            LEFT JOIN dbo.FinancialFacts fIncoming ON c.IncomingFactId = fIncoming.FactId
            LEFT JOIN dbo.Documents dExisting ON fExisting.DocumentId = dExisting.DocumentId
            LEFT JOIN dbo.Documents dIncoming ON fIncoming.DocumentId = dIncoming.DocumentId
            WHERE c.ConflictId = @ConflictId
        `);
    return result.recordset[0] || null;
}

/**
 * Retrieves a conflict record by its single-use decision token hash.
 */
async function getConflictByTokenHash(tokenHash) {
    if (!tokenHash || typeof tokenHash !== 'string') return null;
    const p = await getPool();
    const result = await p.request()
        .input('TokenHash', sql.NVarChar(128), tokenHash)
        .query(`
            SELECT c.*,
                   dExisting.FileName AS ExistingFileName,
                   dIncoming.FileName AS IncomingFileName,
                   dIncoming.DocumentId AS IncomingDocumentId,
                   dExisting.DocumentId AS ExistingDocumentId,
                   fExisting.NormalizedValue AS ExistingNormalizedValue,
                   fIncoming.NormalizedValue AS IncomingNormalizedValue
            FROM dbo.FactConflicts c
            LEFT JOIN dbo.FinancialFacts fExisting ON c.ExistingFactId = fExisting.FactId
            LEFT JOIN dbo.FinancialFacts fIncoming ON c.IncomingFactId = fIncoming.FactId
            LEFT JOIN dbo.Documents dExisting ON fExisting.DocumentId = dExisting.DocumentId
            LEFT JOIN dbo.Documents dIncoming ON fIncoming.DocumentId = dIncoming.DocumentId
            WHERE c.DecisionTokenHash = @TokenHash
        `);
    return result.recordset[0] || null;
}

/**
 * Stages incoming candidate facts with MappingStatus = 'Pending',
 * sets Document IngestionStatus = 'PendingApproval', and registers
 * conflict records with cryptographic decision tokens.
 */
async function savePendingFactsAndConflicts({
    documentId,
    incomingFacts = [],
    conflicts = [],
    authorityRank = 4,
    fileName = 'Incoming Document',
    modifiedUserEmail = null
}) {
    const p = await getPool();

    // 1. Insert incoming candidate facts with MappingStatus = 'Pending'
    const pendingFacts = incomingFacts.map(f => ({ ...f, mappingStatus: 'Pending' }));
    const insertedFactIds = await insertFinancialFacts(documentId, pendingFacts, authorityRank, fileName, { mappingStatus: 'Pending' });

    // 2. Update incoming document IngestionStatus to 'PendingApproval' and set ConflictHold
    await updateDocumentStatus(documentId, 'PendingApproval');
    await updateDocumentHold(documentId, true);

    // Set ConflictHold on all existing documents involved in conflicts
    const existingDocIds = new Set();
    for (const conflict of conflicts) {
        const eDocId = conflict.existingDocumentId || conflict.existingFact?.DocumentId || conflict.existingFact?.documentId;
        if (eDocId) existingDocIds.add(eDocId);
    }
    for (const eDocId of existingDocIds) {
        await updateDocumentHold(eDocId, true);
    }

    // 3. Register conflict records and generate tokens
    const createdConflicts = [];
    const { generateDecisionToken, hashToken } = require('./conflict-token');

    for (const conflict of conflicts) {
        const incomingFactIdx = conflict.incomingFactIndex !== undefined ? conflict.incomingFactIndex : 0;
        const incomingFactId = insertedFactIds[incomingFactIdx] || null;
        const existingFactId = conflict.existingFactId || conflict.existingFact?.FactId || null;

        const recipient = (
            modifiedUserEmail ||
            conflict.modifiedUserEmail ||
            process.env.FINCHAT_ADMIN_EMAIL ||
            'trainee@idealtechlabs.com'
        ).trim();

        // Create base conflict
        const conflictId = await createFactConflict({
            entityId: conflict.existingFact?.EntityId || null,
            metricId: conflict.existingFact?.MetricId || null,
            periodId: conflict.existingFact?.PeriodId || null,
            reportingBasis: conflict.reportingBasis || 'Actual',
            reportingScope: conflict.reportingScope || 'Consolidated',
            conflictType: conflict.conflictType || 'ValueMismatch',
            conflictStatus: 'PendingApproval',
            conflictDescription: conflict.conflictDescription || `Value mismatch on ${conflict.metric} (${conflict.entity})`,
            differenceValue: conflict.differenceValue,
            differencePercentage: conflict.differencePercentage,
            toleranceApplied: conflict.toleranceApplied || 0.001,
            selectedFactId: null, // Strictly NO auto-selection!
            resolutionReason: 'Held for human approval decision',
            factIds: [existingFactId, incomingFactId].filter(Boolean),
            existingFactId,
            incomingFactId,
            notificationRecipient: recipient
        });

        // Generate token and token hash
        const token = generateDecisionToken({ conflictId, recipientEmail: recipient });
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + 72 * 3600 * 1000);

        // Update token details on dbo.FactConflicts
        await p.request()
            .input('ConflictId', sql.BigInt, conflictId)
            .input('TokenHash', sql.NVarChar(128), tokenHash)
            .input('ExpiresAt', sql.DateTime2, expiresAt)
            .input('Recipient', sql.NVarChar(255), recipient)
            .query(`
                UPDATE dbo.FactConflicts
                SET DecisionTokenHash = @TokenHash,
                    TokenExpiresAt = @ExpiresAt,
                    NotificationRecipient = @Recipient
                WHERE ConflictId = @ConflictId
            `);

        createdConflicts.push({
            ...conflict,
            conflictId,
            existingFactId,
            incomingFactId,
            token,
            tokenHash,
            expiresAt,
            recipientEmail: recipient
        });
    }

    return {
        documentId,
        insertedFactIds,
        conflicts: createdConflicts
    };
}

/**
 * Resolves a conflict decision inside a strict SQL ACID transaction.
 * Option A (keep_existing): incoming candidate fact rejected; existing fact retained.
 * Option B (accept_incoming): incoming candidate fact approved; existing fact superseded (NEVER DELETED).
 */
async function resolveConflictDecisionTransaction({
    conflictId,
    action,
    reviewerEmail = 'authorized-user@contoso.com',
    reviewerName = null,
    notes = null
}) {
    if (!conflictId) {
        throw new Error('conflictId is required');
    }
    const cleanAction = (action || '').trim().toLowerCase();
    if (cleanAction !== 'keep_existing' && cleanAction !== 'accept_incoming') {
        throw new Error(`Invalid decision action "${action}". Allowed: "keep_existing", "accept_incoming"`);
    }

    const p = await getPool();
    const transaction = (p.transaction && typeof p.transaction === 'function')
        ? p.transaction()
        : new sql.Transaction(p);
    await transaction.begin();

    const makeReq = () => (transaction && typeof transaction.request === 'function' ? transaction.request() : new sql.Request(transaction));

    try {
        const req = makeReq();
        const conflictRes = await req
            .input('ConflictId', sql.BigInt, Number(conflictId))
            .query(`
                SELECT c.ConflictId, c.ConflictStatus, c.SelectedFactId, c.ExistingFactId, c.IncomingFactId,
                       c.DifferenceValue, c.DifferencePercentage, c.ToleranceApplied,
                       fExist.DocumentId AS ExistingDocumentId, fExist.NormalizedValue AS ExistingValue,
                       fInc.DocumentId AS IncomingDocumentId, fInc.NormalizedValue AS IncomingValue
                FROM dbo.FactConflicts c WITH (UPDLOCK, ROWLOCK)
                LEFT JOIN dbo.FinancialFacts fExist ON c.ExistingFactId = fExist.FactId
                LEFT JOIN dbo.FinancialFacts fInc ON c.IncomingFactId = fInc.FactId
                WHERE c.ConflictId = @ConflictId
            `);

        const conflict = conflictRes.recordset[0];
        if (!conflict) {
            throw new Error(`Conflict #${conflictId} not found`);
        }

        // Validate status: guard against duplicate and concurrent resolution
        if (conflict.ConflictStatus !== 'PendingApproval' && conflict.ConflictStatus !== 'PendingReview' && conflict.ConflictStatus !== 'Detected' && conflict.ConflictStatus !== 'Potential') {
            throw new Error(`Conflict #${conflictId} has already been resolved with status "${conflict.ConflictStatus}". Duplicate decisions are not permitted.`);
        }

        const reviewer = reviewerEmail || reviewerName || 'Authorized Reviewer';
        let newStatus = '';
        let selectedFactId = null;
        let resolutionReason = '';

        if (cleanAction === 'keep_existing') {
            newStatus = 'ApprovedExisting';
            selectedFactId = conflict.ExistingFactId;
            resolutionReason = notes || `Human reviewer (${reviewer}) retained existing master fact (${conflict.ExistingValue}) and rejected incoming candidate fact (${conflict.IncomingValue}).`;

            // Existing fact retained as Approved
            if (conflict.ExistingFactId) {
                await makeReq()
                    .input('FactId', sql.BigInt, conflict.ExistingFactId)
                    .query(`UPDATE dbo.FinancialFacts SET MappingStatus = 'Approved', UpdatedAt = SYSUTCDATETIME() WHERE FactId = @FactId`);
            }

            // Incoming candidate marked Rejected
            if (conflict.IncomingFactId) {
                await makeReq()
                    .input('FactId', sql.BigInt, conflict.IncomingFactId)
                    .query(`UPDATE dbo.FinancialFacts SET MappingStatus = 'Rejected', UpdatedAt = SYSUTCDATETIME() WHERE FactId = @FactId`);
            }

            // Moot any remaining open conflicts involving this rejected candidate or document pair
            if (conflict.IncomingDocumentId) {
                await makeReq()
                    .input('DocId', sql.BigInt, conflict.IncomingDocumentId)
                    .input('CurrentConflictId', sql.BigInt, Number(conflictId))
                    .query(`
                        UPDATE dbo.FactConflicts
                        SET ConflictStatus = 'Moot',
                            ResolutionStatus = 'Moot',
                            ResolutionReason = 'Moot: incoming candidate rejected in favor of existing master file',
                            UpdatedAt = SYSUTCDATETIME()
                        WHERE ConflictId != @CurrentConflictId
                          AND ConflictStatus IN ('PendingApproval', 'PendingReview', 'Detected', 'Potential', 'Escalated')
                          AND (
                              IncomingFactId IN (SELECT FactId FROM dbo.FinancialFacts WHERE DocumentId = @DocId)
                              OR ExistingFactId IN (SELECT FactId FROM dbo.FinancialFacts WHERE DocumentId = @DocId)
                          )
                    `);
            }
        } else {
            newStatus = 'ApprovedIncoming';
            selectedFactId = conflict.IncomingFactId;
            resolutionReason = notes || `Human reviewer (${reviewer}) accepted incoming candidate fact (${conflict.IncomingValue}) and superseded existing master fact (${conflict.ExistingValue}).`;

            // Incoming candidate promoted to Approved
            if (conflict.IncomingFactId) {
                await makeReq()
                    .input('FactId', sql.BigInt, conflict.IncomingFactId)
                    .query(`UPDATE dbo.FinancialFacts SET MappingStatus = 'Approved', UpdatedAt = SYSUTCDATETIME() WHERE FactId = @FactId`);
            }

            // Existing master fact marked Superseded (NEVER DELETED!)
            if (conflict.ExistingFactId) {
                await makeReq()
                    .input('FactId', sql.BigInt, conflict.ExistingFactId)
                    .query(`UPDATE dbo.FinancialFacts SET MappingStatus = 'Superseded', UpdatedAt = SYSUTCDATETIME() WHERE FactId = @FactId`);
            }
        }

        // Update dbo.FactConflicts with concurrency and status protection
        const updateConflictRes = await makeReq()
            .input('ConflictId', sql.BigInt, Number(conflictId))
            .input('SelectedFactId', sql.BigInt, selectedFactId)
            .input('Status', sql.NVarChar(50), newStatus)
            .input('Reason', sql.NVarChar(2000), resolutionReason)
            .input('ReviewedBy', sql.NVarChar(150), reviewer)
            .query(`
                UPDATE dbo.FactConflicts
                SET SelectedFactId = @SelectedFactId,
                    ConflictStatus = @Status,
                    ResolutionStatus = @Status,
                    ResolutionReason = @Reason,
                    ResolutionNotes = @Reason,
                    ReviewedBy = @ReviewedBy,
                    ReviewedAt = SYSUTCDATETIME(),
                    UpdatedAt = SYSUTCDATETIME()
                WHERE ConflictId = @ConflictId
                  AND ConflictStatus IN ('PendingApproval', 'PendingReview', 'Detected', 'Potential')
            `);

        if (updateConflictRes && Array.isArray(updateConflictRes.rowsAffected) && updateConflictRes.rowsAffected[0] === 0) {
            throw new Error(`Conflict #${conflictId} has already been resolved or locked by another transaction.`);
        }

        // Record in dbo.FactResolutions
        await makeReq()
            .input('ConflictId', sql.BigInt, Number(conflictId))
            .input('SelectedFactId', sql.BigInt, selectedFactId)
            .input('ResolutionType', sql.NVarChar(50), cleanAction === 'keep_existing' ? 'HumanDecisionKeepExisting' : 'HumanDecisionAcceptIncoming')
            .input('ResolutionReason', sql.NVarChar(2000), resolutionReason)
            .input('ResolutionRule', sql.NVarChar(500), 'HumanReviewerDecision')
            .input('ResolvedBy', sql.NVarChar(150), reviewer)
            .input('PrevStatus', sql.NVarChar(50), conflict.ConflictStatus)
            .input('NewStatus', sql.NVarChar(50), newStatus)
            .query(`
                INSERT INTO dbo.FactResolutions
                    (ConflictId, SelectedFactId, ResolutionType, ResolutionReason, ResolutionRule, ResolvedBy, ResolvedAt, PreviousStatus, NewStatus)
                VALUES
                    (@ConflictId, @SelectedFactId, @ResolutionType, @ResolutionReason, @ResolutionRule, @ResolvedBy, SYSUTCDATETIME(), @PrevStatus, @NewStatus)
            `);

        // Record in dbo.FactAudit
        if (conflict.ExistingFactId && conflict.ExistingDocumentId) {
            await makeReq()
                .input('FactId', sql.BigInt, conflict.ExistingFactId)
                .input('DocId', sql.BigInt, conflict.ExistingDocumentId)
                .input('ActionType', sql.NVarChar(50), cleanAction === 'keep_existing' ? 'ConflictResolvedRetained' : 'ConflictResolvedSuperseded')
                .input('OldVal', sql.NVarChar(500), String(conflict.ExistingValue ?? ''))
                .input('NewVal', sql.NVarChar(500), cleanAction === 'keep_existing' ? String(conflict.ExistingValue ?? '') : 'Superseded')
                .input('Reason', sql.NVarChar(1000), resolutionReason)
                .input('By', sql.NVarChar(150), reviewer)
                .query(`
                    INSERT INTO dbo.FactAudit (FactId, DocumentId, ActionType, OldValue, NewValue, ActionReason, ActionBy, ActionAt)
                    VALUES (@FactId, @DocId, @ActionType, @OldVal, @NewVal, @Reason, @By, SYSUTCDATETIME())
                `).catch(() => {});

            // If incoming fact was accepted, check if all facts in existing document are now superseded
            if (cleanAction === 'accept_incoming') {
                try {
                    const existingFactsRes = await makeReq()
                        .input('ExistingDocId', sql.BigInt, conflict.ExistingDocumentId)
                        .query(`
                            SELECT 
                                COUNT(CASE WHEN MappingStatus = 'Approved' THEN 1 END) AS ApprovedCount,
                                COUNT(CASE WHEN MappingStatus = 'Superseded' THEN 1 END) AS SupersededCount,
                                COUNT(*) AS TotalCount
                            FROM dbo.FinancialFacts
                            WHERE DocumentId = @ExistingDocId
                        `);
                    const existingCounts = existingFactsRes.recordset?.[0] || {};
                    if ((existingCounts.ApprovedCount || 0) === 0 && (existingCounts.SupersededCount || 0) > 0) {
                        await makeReq()
                            .input('ExistingDocId', sql.BigInt, conflict.ExistingDocumentId)
                            .query(`
                                UPDATE dbo.Documents
                                SET IngestionStatus = 'Superseded',
                                    UpdatedAt = SYSUTCDATETIME()
                                WHERE DocumentId = @ExistingDocId
                            `);
                    }
                } catch {
                    // Non-fatal if status check fails
                }
            }
        }

        if (conflict.IncomingFactId && conflict.IncomingDocumentId) {
            await makeReq()
                .input('FactId', sql.BigInt, conflict.IncomingFactId)
                .input('DocId', sql.BigInt, conflict.IncomingDocumentId)
                .input('ActionType', sql.NVarChar(50), cleanAction === 'keep_existing' ? 'ConflictResolvedRejected' : 'ConflictResolvedPromoted')
                .input('OldVal', sql.NVarChar(500), String(conflict.IncomingValue ?? ''))
                .input('NewVal', sql.NVarChar(500), cleanAction === 'keep_existing' ? 'Rejected' : String(conflict.IncomingValue ?? ''))
                .input('Reason', sql.NVarChar(1000), resolutionReason)
                .input('By', sql.NVarChar(150), reviewer)
                .query(`
                    INSERT INTO dbo.FactAudit (FactId, DocumentId, ActionType, OldValue, NewValue, ActionReason, ActionBy, ActionAt)
                    VALUES (@FactId, @DocId, @ActionType, @OldVal, @NewVal, @Reason, @By, SYSUTCDATETIME())
                `).catch(() => {});
        }

        // Check if all conflicts for incoming document are resolved
        if (conflict.IncomingDocumentId) {
            const pendingConflictsRes = await makeReq()
                .input('DocId', sql.BigInt, conflict.IncomingDocumentId)
                .query(`
                    SELECT COUNT(*) AS PendingCount
                    FROM dbo.FactConflicts c
                    JOIN dbo.FinancialFacts f ON c.IncomingFactId = f.FactId
                    WHERE f.DocumentId = @DocId
                      AND c.ConflictStatus IN ('PendingApproval', 'PendingReview', 'Detected', 'Potential')
                `);

            const pendingCount = pendingConflictsRes.recordset[0]?.PendingCount || 0;
            if (pendingCount === 0) {
                // Promote remaining non-conflicting facts that are still 'Pending' to 'Approved'
                await makeReq()
                    .input('DocId', sql.BigInt, conflict.IncomingDocumentId)
                    .query(`
                        UPDATE dbo.FinancialFacts
                        SET MappingStatus = 'Approved',
                            UpdatedAt = SYSUTCDATETIME()
                        WHERE DocumentId = @DocId AND MappingStatus = 'Pending'
                    `);

                // Accurately determine document IngestionStatus based on approved vs rejected fact counts
                const statusCountsRes = await makeReq()
                    .input('DocId', sql.BigInt, conflict.IncomingDocumentId)
                    .query(`
                        SELECT 
                            COUNT(CASE WHEN MappingStatus = 'Approved' THEN 1 END) AS ApprovedCount,
                            COUNT(CASE WHEN MappingStatus = 'Rejected' THEN 1 END) AS RejectedCount,
                            COUNT(*) AS TotalCount
                        FROM dbo.FinancialFacts
                        WHERE DocumentId = @DocId
                    `);

                const counts = statusCountsRes.recordset && statusCountsRes.recordset[0] ? statusCountsRes.recordset[0] : {};
                const approvedCount = counts.ApprovedCount || 0;
                const rejectedCount = counts.RejectedCount || 0;

                let finalDocStatus = 'Succeeded';
                if (approvedCount === 0 && rejectedCount > 0) {
                    finalDocStatus = 'Rejected';
                } else if (approvedCount > 0 && rejectedCount > 0) {
                    finalDocStatus = 'PartiallyApproved';
                } else {
                    finalDocStatus = 'Succeeded';
                }

                await makeReq()
                    .input('DocId', sql.BigInt, conflict.IncomingDocumentId)
                    .input('DocStatus', sql.NVarChar(50), finalDocStatus)
                    .query(`
                        UPDATE dbo.Documents
                        SET IngestionStatus = @DocStatus,
                            UpdatedAt = SYSUTCDATETIME()
                        WHERE DocumentId = @DocId
                    `);
            }
        }

        await transaction.commit();

        if (conflict.IncomingDocumentId) {
            await recomputeDocumentHold(conflict.IncomingDocumentId).catch(() => {});
        }
        if (conflict.ExistingDocumentId) {
            await recomputeDocumentHold(conflict.ExistingDocumentId).catch(() => {});
        }

        return {
            success: true,
            conflictId: Number(conflictId),
            action: cleanAction,
            newStatus,
            selectedFactId,
            resolutionReason
        };
    } catch (err) {
        await transaction.rollback().catch(() => {});
        throw err;
    }
}

/**
 * Logs an audit event for fact actions
 */
async function logFactAudit({
    factId,
    documentId,
    actionType,
    oldValue = null,
    newValue = null,
    actionReason = null,
    actionBy = 'System',
    correlationId = null
}) {
    try {
        const p = await getPool();
        await p.request()
            .input('FactId', sql.BigInt, factId)
            .input('DocumentId', sql.BigInt, documentId)
            .input('ActionType', sql.NVarChar(50), actionType)
            .input('OldValue', sql.NVarChar(500), oldValue)
            .input('NewValue', sql.NVarChar(500), newValue)
            .input('ActionReason', sql.NVarChar(1000), actionReason)
            .input('ActionBy', sql.NVarChar(150), actionBy)
            .input('CorrelationId', sql.NVarChar(100), correlationId)
            .query(`
                INSERT INTO dbo.FactAudit
                    (FactId, DocumentId, ActionType, OldValue, NewValue, ActionReason, ActionBy, ActionAt, CorrelationId)
                VALUES
                    (@FactId, @DocumentId, @ActionType, @OldValue, @NewValue, @ActionReason, @ActionBy, SYSUTCDATETIME(), @CorrelationId);
            `);
    } catch {
        // Audit failures should not block pipeline processing
    }
}

/**
 * Removes all facts and associated conflicts for a failed or retracted document.
 */
async function deleteDocumentFacts(documentId) {
    if (!documentId) return;
    const p = await getPool();
    await p.request()
        .input('DocumentId', sql.BigInt, Number(documentId))
        .query(`
            DELETE FROM dbo.FactConflictRecords
            WHERE FactId IN (SELECT FactId FROM dbo.FinancialFacts WHERE DocumentId = @DocumentId);

            DELETE FROM dbo.FactAudit
            WHERE DocumentId = @DocumentId;

            DELETE FROM dbo.FactConflicts 
            WHERE FactId1 IN (SELECT FactId FROM dbo.FinancialFacts WHERE DocumentId = @DocumentId)
               OR FactId2 IN (SELECT FactId FROM dbo.FinancialFacts WHERE DocumentId = @DocumentId)
               OR SelectedFactId IN (SELECT FactId FROM dbo.FinancialFacts WHERE DocumentId = @DocumentId);

            DELETE FROM dbo.FinancialFacts WHERE DocumentId = @DocumentId;
        `);
}

/**
 * Updates fact validation and mapping status.
 */
async function updateFactStatus(factId, { validationStatus = null, mappingStatus = null, actionReason = null, actionBy = 'System' } = {}) {
    if (!factId) return;
    const p = await getPool();
    const req = p.request().input('FactId', sql.BigInt, factId);

    const sets = [];
    if (validationStatus) {
        req.input('ValidationStatus', sql.NVarChar(30), validationStatus);
        sets.push('ValidationStatus = @ValidationStatus');
    }
    if (mappingStatus) {
        req.input('MappingStatus', sql.NVarChar(30), mappingStatus);
        sets.push('MappingStatus = @MappingStatus');
    }
    if (sets.length === 0) return;

    sets.push('UpdatedAt = SYSUTCDATETIME()');
    await req.query(`UPDATE dbo.FinancialFacts SET ${sets.join(', ')} WHERE FactId = @FactId`);

    await logFactAudit({
        factId,
        documentId: null,
        actionType: 'StatusUpdated',
        newValue: `Validation: ${validationStatus || 'unchanged'}, Mapping: ${mappingStatus || 'unchanged'}`,
        actionReason,
        actionBy
    }).catch(() => {});
}

/**
 * Retrieves configured document authority rules from dbo.SourceAuthorityRanks.
 */
async function getDocumentAuthorityRules() {
    const p = await getPool();
    const result = await p.request().query(`
        SELECT AuthorityRank, 
               ISNULL(AuthorityCategory, SourceType) AS AuthorityCategory,
               SourceType, Priority, ReportingBasis, Description, IsActive
        FROM dbo.SourceAuthorityRanks
        WHERE IsActive = 1
        ORDER BY Priority ASC, AuthorityRank ASC
    `);
    return result.recordset;
}

/**
 * Retrieves summary information for an ingestion run.
 */
async function getIngestionRunSummary(runId) {
    if (!runId) return null;
    const p = await getPool();
    const result = await p.request()
        .input('RunId', sql.BigInt, runId)
        .query('SELECT * FROM dbo.IngestionRuns WHERE RunId = @RunId');
    return result.recordset[0] || null;
}

/**
 * Applies a human conflict decision inside an atomic SQL transaction.
 * Serves as direct API function and wraps resolveConflictDecisionTransaction.
 */
async function applyConflictDecision(conflictIdOrOptions, actionMaybe, optionsMaybe = {}) {
    if (typeof conflictIdOrOptions === 'object' && conflictIdOrOptions !== null) {
        return resolveConflictDecisionTransaction(conflictIdOrOptions);
    }
    return resolveConflictDecisionTransaction({
        conflictId: conflictIdOrOptions,
        action: actionMaybe,
        ...optionsMaybe
    });
}

module.exports = {
    getPool,
    setPool,
    resetPool,
    ensureDatabaseSchema,
    ensureDefaultAuthorityRank,
    findOrCreateEntity,
    findOrCreateMetric,
    findOrCreatePeriod,
    resolveEntityAlias,
    resolveMetricAlias,
    getEntityFiscalYearStartMonth,
    updateDocumentHold,
    recomputeDocumentHold,
    acquireFactAppLock,
    startIngestionRun,
    completeIngestionRun,
    updateIngestionRunProgress,
    getIngestionRunSummary,
    createDocument,
    updateDocumentStatus,
    updateDocumentMetadata,
    insertFinancialFacts,
    updateFactStatus,
    getDocumentById,
    getDocumentAuthorityRules,
    getFinancialFacts,
    getCompleteFinancialFacts,
    createFactConflict,
    resolveFactConflict,
    logFactAudit,
    deleteDocumentFacts,
    findDocumentByContentHash,
    getConflictById,
    getConflictByTokenHash,
    getSearchAllowList,
    savePendingFactsAndConflicts,
    resolveConflictDecisionTransaction,
    applyConflictDecision
};
