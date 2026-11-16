-- ============================================================================
-- Seed Script: Benchmark & Test Entities and EntityAliases
-- Environment: Development & Integration Testing
-- Date: 2026-11-16
-- ============================================================================

-- Contoso Retail LLC
IF NOT EXISTS (SELECT 1 FROM dbo.Entities WHERE EntityName = 'Contoso Retail LLC')
BEGIN
    INSERT INTO dbo.Entities (EntityName, EntityType, FiscalYearStartMonth, IsActive)
    VALUES ('Contoso Retail LLC', 'Company', 1, 1);
END;

-- Contoso Logistics LLC
IF NOT EXISTS (SELECT 1 FROM dbo.Entities WHERE EntityName = 'Contoso Logistics LLC')
BEGIN
    INSERT INTO dbo.Entities (EntityName, EntityType, FiscalYearStartMonth, IsActive)
    VALUES ('Contoso Logistics LLC', 'Company', 1, 1);
END;

-- Contoso Properties LLC
IF NOT EXISTS (SELECT 1 FROM dbo.Entities WHERE EntityName = 'Contoso Properties LLC')
BEGIN
    INSERT INTO dbo.Entities (EntityName, EntityType, FiscalYearStartMonth, IsActive)
    VALUES ('Contoso Properties LLC', 'Company', 1, 1);
END;

-- Contoso Holdings
IF NOT EXISTS (SELECT 1 FROM dbo.Entities WHERE EntityName = 'Contoso Holdings')
BEGIN
    INSERT INTO dbo.Entities (EntityName, EntityType, FiscalYearStartMonth, IsActive)
    VALUES ('Contoso Holdings', 'Holding', 1, 1);
END;

-- Contoso Medical Supplies LLC
IF NOT EXISTS (SELECT 1 FROM dbo.Entities WHERE EntityName = 'Contoso Medical Supplies LLC')
BEGIN
    INSERT INTO dbo.Entities (EntityName, EntityType, FiscalYearStartMonth, IsActive)
    VALUES ('Contoso Medical Supplies LLC', 'Company', 1, 1);
END;

-- Seed EntityAliases
DECLARE @RetailId BIGINT = (SELECT TOP 1 EntityId FROM dbo.Entities WHERE EntityName = 'Contoso Retail LLC');
DECLARE @LogisticsId BIGINT = (SELECT TOP 1 EntityId FROM dbo.Entities WHERE EntityName = 'Contoso Logistics LLC');
DECLARE @PropertiesId BIGINT = (SELECT TOP 1 EntityId FROM dbo.Entities WHERE EntityName = 'Contoso Properties LLC');
DECLARE @HoldingsId BIGINT = (SELECT TOP 1 EntityId FROM dbo.Entities WHERE EntityName = 'Contoso Holdings');
DECLARE @MedicalId BIGINT = (SELECT TOP 1 EntityId FROM dbo.Entities WHERE EntityName = 'Contoso Medical Supplies LLC');

-- Retail aliases
IF @RetailId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = 'Contoso Retail' AND LanguageCode = 'en')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@RetailId, 'Contoso Retail', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = 'Contoso Retail LLC' AND LanguageCode = 'en')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@RetailId, 'Contoso Retail LLC', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = N'شركة كونتوسو للتجزئة ذ.م.م' AND LanguageCode = 'ar')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@RetailId, N'شركة كونتوسو للتجزئة ذ.م.م', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = N'كونتوسو للتجزئة' AND LanguageCode = 'ar')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@RetailId, N'كونتوسو للتجزئة', 'ar');
END;

-- Logistics aliases
IF @LogisticsId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = 'Contoso Logistics' AND LanguageCode = 'en')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@LogisticsId, 'Contoso Logistics', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = 'Contoso Logistics LLC' AND LanguageCode = 'en')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@LogisticsId, 'Contoso Logistics LLC', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = N'شركة كونتوسو للخدمات اللوجستية ذ.م.م' AND LanguageCode = 'ar')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@LogisticsId, N'شركة كونتوسو للخدمات اللوجستية ذ.م.م', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = N'كونتوسو للوجستيات' AND LanguageCode = 'ar')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@LogisticsId, N'كونتوسو للوجستيات', 'ar');
END;

-- Properties aliases
IF @PropertiesId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = 'Contoso Properties' AND LanguageCode = 'en')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@PropertiesId, 'Contoso Properties', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = 'Contoso Properties LLC' AND LanguageCode = 'en')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@PropertiesId, 'Contoso Properties LLC', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = N'شركة كونتوسو العقارية ذ.م.م' AND LanguageCode = 'ar')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@PropertiesId, N'شركة كونتوسو العقارية ذ.م.م', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = N'كونتوسو العقارية' AND LanguageCode = 'ar')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@PropertiesId, N'كونتوسو العقارية', 'ar');
END;

-- Holdings aliases
IF @HoldingsId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = 'Contoso Holdings' AND LanguageCode = 'en')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@HoldingsId, 'Contoso Holdings', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = 'Contoso Holdings Ltd' AND LanguageCode = 'en')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@HoldingsId, 'Contoso Holdings Ltd', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = N'مجموعة كونتوسو القابضة' AND LanguageCode = 'ar')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@HoldingsId, N'مجموعة كونتوسو القابضة', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = N'كونتوسو القابضة' AND LanguageCode = 'ar')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@HoldingsId, N'كونتوسو القابضة', 'ar');
END;

-- Medical aliases
IF @MedicalId IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = 'Contoso Medical Supplies' AND LanguageCode = 'en')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@MedicalId, 'Contoso Medical Supplies', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = 'Contoso Medical Supplies LLC' AND LanguageCode = 'en')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@MedicalId, 'Contoso Medical Supplies LLC', 'en');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = N'شركة كونتوسو للمستلزمات الطبية ذ.م.م' AND LanguageCode = 'ar')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@MedicalId, N'شركة كونتوسو للمستلزمات الطبية ذ.م.م', 'ar');
    IF NOT EXISTS (SELECT 1 FROM dbo.EntityAliases WHERE AliasText = N'كونتوسو للمستلزمات الطبية' AND LanguageCode = 'ar')
        INSERT INTO dbo.EntityAliases (EntityId, AliasText, LanguageCode) VALUES (@MedicalId, N'كونتوسو للمستلزمات الطبية', 'ar');
END;

