# Final Financial SQL Integrity Report

## 1. Schema & Validation Evidence Storage (§19)
`finchat/src/services/sql.js` evolves `dbo.FinancialFacts` backward-compatibly with:
- `ValidationStatus NVARCHAR(30)`
- `ValidationPolicyVersion NVARCHAR(50) NULL` (`financial-validation-v1`)
- `ValidationChecksJson NVARCHAR(MAX) NULL` (JSON map of all 13 gate outcomes)
- `ReviewReasonsJson NVARCHAR(MAX) NULL` (JSON array of standardized reason codes)
- `ValidatedAt DATETIME2 NULL`
- `OriginalValue DECIMAL(28,8) NULL`, `NormalizedValue DECIMAL(28,8) NULL`, `NumericValue DECIMAL(19,4) NULL`
- `SourceLocationJson NVARCHAR(MAX) NULL`, `SourceLocationText NVARCHAR(500) NULL`, `ExtractionMethod NVARCHAR(50) NULL`

## 2. Exact Numerical Persistence & Parameterization (§17)
- All SQL inserts in `insertFinancialFacts` use parameterized `@` inputs (`sql.Decimal(28, 8)`, `sql.NVarChar`, `sql.BigInt`, `sql.Date`). Zero string concatenation into executable SQL.
- Upstream exact decimal arithmetic is verified in `evidence-validator.js` Gate 4 (`numericNormalization`) using `exactDecimalsMatch()` before persistence, preventing JavaScript floating-point drift from being marked `Validated`.
- Unit tests in `wp3-effective-facts-math.test.js` (17/17 passed) and `fact-integrity-schema.test.js` (8/8 passed) verify decimal math precision, half-up rounding, and SQL schema integrity.

## 3. Prevention of Downstream Validation Status Overrides (§20)
1. **Removed Blind `'Validated'` Default**: In `sql.js` (`insertFinancialFacts`), `fact.validationStatus` is no longer defaulted to `'Validated'`. Missing or unrecognized statuses default strictly to `'NeedsReview'`.
2. **Required-Field Guard**: If `isMissingRequiredFields` is true in `sql.js`, `safeValidationStatus` is downgraded from `'Validated'` to `'NeedsReview'` before `INSERT`.
3. **Removed Blind `'Consolidated'` Default**: `ReportingScope` parameter now binds `fact.reportingScope || null` instead of defaulting to `'Consolidated'`.
4. **Mapping & Authority Independence**: `MappingStatus` (`Approved` vs `NewMetric`/`NeedsReview`) and `AuthorityRank` are stored independently and cannot promote a `NeedsReview` or `Rejected` fact to `Validated`.
5. **Retrieval Eligibility (§21)**: Trusted retrieval filters on `ValidationStatus = 'Validated'` alongside `MappingStatus = 'Approved'`, `ConflictHold = 0`, and non-superseded document versions (`wp3-effective-facts-math.test.js` Test 7 & 8).

## 4. Remaining Limitations
- Live Azure SQL Server round-trip execution requires network connectivity and an active Azure SQL instance; offline unit tests verify schema DDL, parameterization bindings, and decimal normalization logic.
