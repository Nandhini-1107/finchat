-- ============================================================================
-- Migration 002: Conflict Governance, Decision Tokens, and Notifications
-- Description: Non-destructive, incremental migration supporting human approval workflow,
--              cryptographic single-use decision tokens, and notification tracking.
-- Phase: 4.4 Financial Fact Conflict Detection and Human Approval Workflow
-- Date: 2026-11-15
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extend dbo.FactConflicts with Token and Notification Metadata
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'DecisionTokenHash')
BEGIN
    ALTER TABLE dbo.FactConflicts ADD DecisionTokenHash NVARCHAR(128) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'TokenExpiresAt')
BEGIN
    ALTER TABLE dbo.FactConflicts ADD TokenExpiresAt DATETIME2 NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'NotificationStatus')
BEGIN
    ALTER TABLE dbo.FactConflicts ADD NotificationStatus NVARCHAR(50) NOT NULL DEFAULT 'Pending';
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'NotificationSentAt')
BEGIN
    ALTER TABLE dbo.FactConflicts ADD NotificationSentAt DATETIME2 NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'NotificationRecipient')
BEGIN
    ALTER TABLE dbo.FactConflicts ADD NotificationRecipient NVARCHAR(255) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'NotificationError')
BEGIN
    ALTER TABLE dbo.FactConflicts ADD NotificationError NVARCHAR(MAX) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'ExistingFactId')
BEGIN
    ALTER TABLE dbo.FactConflicts ADD ExistingFactId BIGINT NULL FOREIGN KEY REFERENCES dbo.FinancialFacts(FactId);
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflicts') AND name = 'IncomingFactId')
BEGIN
    ALTER TABLE dbo.FactConflicts ADD IncomingFactId BIGINT NULL FOREIGN KEY REFERENCES dbo.FinancialFacts(FactId);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FactConflicts_TokenHash' AND object_id = OBJECT_ID('dbo.FactConflicts'))
BEGIN
    CREATE INDEX IX_FactConflicts_TokenHash ON dbo.FactConflicts(DecisionTokenHash);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FactConflicts_NotificationStatus' AND object_id = OBJECT_ID('dbo.FactConflicts'))
BEGIN
    CREATE INDEX IX_FactConflicts_NotificationStatus ON dbo.FactConflicts(NotificationStatus);
END;

-- ----------------------------------------------------------------------------
-- 2. Extend dbo.FactConflictRecords with FactRole
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FactConflictRecords') AND name = 'FactRole')
BEGIN
    ALTER TABLE dbo.FactConflictRecords ADD FactRole NVARCHAR(50) NOT NULL DEFAULT 'Alternative';
END;

