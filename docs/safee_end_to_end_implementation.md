# SAFEE Financial Fact Extraction — End-to-End Implementation Architecture

## 1. Architectural Overview

SAFEE (Structure-Aware Financial Extraction Engine) is a pure Node.js, deterministic, non-LLM subsystem built inside the existing Finora Azure AI ingestion pipeline. It operates with **zero external inference calls, zero tokens, and zero machine learning models**.

```text
Original PDF / Excel Buffer
           │
           ▼
 Document Format Adapters
 (pdf-layout-adapter.js / excel-layout-adapter.js)
           │
           ▼
 Unified Document Representation (document-layout.js)
           │
           ▼
 Table Island Detection & Header Hierarchy Reconstruction
           │
           ▼
 Scoped Context Graph Resolution (context-graph.js)
           │
           ▼
 Independent Numeric Candidate Detection (candidate-detector.js)
           │
           ├────────────────────────────┬────────────────────────────┐
           ▼                                                         ▼
 Table Extraction Engine                                   Narrative Extraction Engine
 (matrix-unpivoter.js)                                     (paragraph-extractor.js)
           │                                                         │
           └────────────────────────────┬────────────────────────────┘
                                        │
                                        ▼
                           Exact Numerical Normalization
                             (numeric-normalizer.js)
                                        │
                                        ▼
                          Independent Evidence Validation
                              (evidence-validator.js)
                                        │
                                        ▼
                             Candidate Reconciliation
                            (candidate-reconciler.js)
                                        │
                                        ▼
                            Source-Aware Deduplication
                                (deduplicator.js)
                                        │
                                        ▼
                       SQL Persistence & Conflict Governance
                                    (sql.js)
```

---

## 2. Component Details

### A. Document Format Adapters (`layout/pdf-layout-adapter.js`, `layout/excel-layout-adapter.js`)
- **PDF Layout Extraction**: Uses embedded Mozilla PDF.js through `pdf-parse` v2.4.5 to access page text items with exact X, Y, width, height, and font size coordinates.
- **Visual Line Reconstruction**: Clusters items sharing similar Y coordinates into reading lines, sorting left-to-right.
- **Line Wrap Repair**: Reconstructs split numeric tokens (e.g. `8,500,00\n0` -> `8,500,000`) and hyphenated or broken fiscal periods (`for FY\n2025` -> `for FY 2025`).
- **Table vs Narrative Isolation**: Regions with multi-column aligned cells are recognized as independent tables; non-table text forms narrative paragraphs. The two regions are mutually exclusive.

### B. Table Island Detector & Header Hierarchy (`layout/table-island-detector.js`, `layout/header-reconstructor.js`)
- Detects multi-table pages, nested row hierarchies (e.g., parent division headers), and multi-level column headers (e.g., `FY 2026 Actual` vs `FY 2026 Budget`).
- Preserves table captions and context notes (`contextText`) so scale ("expressed in AED millions") and currency are inherited.

### C. Dynamic Role Classifier & Orientation Detector (`tables/role-classifier.js`, `tables/orientation-detector.js`)
- Classifies columns dynamically into `Metric`, `Entity`, `ReportingPeriod`, `NumericValue`, `Currency`, `Unit`, `ReportingBasis`, `ReportingDimension`.
- Supports Formats A through G:
  - Format A: Metrics in rows (`Revenue | 15.50 | 20.75`)
  - Format B: Metrics in columns (`Q1 2026 | 850,000 | 125,000`)
  - Format C: Record-based (`Organization | Metric | Period | Currency | Amount`)
  - Format D: Entities in columns
  - Format E: Multi-level headers (Actual vs Budget)

### D. Scoped Context Graph (`context/context-graph.js`)
- Maintains hierarchical context: Document -> Section -> Table/Paragraph -> Row/Column.
- **Context Isolation Guard**: When a new organization is introduced, the previous entity's period and currency are reset.
- Currency and monetary scale are not defaulted to USD or Consolidated when unknown.

### E. Exact Numerical Normalization (`numeric-normalizer.js`)
- Uses `Decimal` BigInt arithmetic from `src/utils/decimal.js`.
- Supports Western (`8,500,000`), Indian (`1,25,00,000` -> `12,500,000`, `15.5 crore` -> `155,000,000`, `85 lakh` -> `8,500,000`), European (`1.250.000,50`), Arabic-Indic digits, accounting negatives (`(250,000)` -> `-250000`).
- Scale multiplier guard: monetary scale is never applied to percentages, ratios, or counts.

### F. Evidence Validation & Candidate Reconciliation (`validation/evidence-validator.js`, `validation/candidate-reconciler.js`)
- Validates field-level and relationship-level evidence.
- Cues such as `Document Version: 1.0` or testing summaries are rejected from becoming validated financial facts.
- Facts missing required entity, period, or currency receive `NeedsReview` status with confidence capped at 0.65.
- 100% of detected candidates are accounted for in coverage telemetry.

### G. SQL Persistence & Existing Governance (`src/services/sql.js`)
- Stored records in `dbo.FinancialFacts` preserve:
  - `RawValue` (original string token)
  - `NormalizedValue` (`DECIMAL(28,8)`)
  - `SourceTableId`, `SourceRow`, `SourceColumn`, `SourceLocationText`, `SourceLocationJson`
  - `ReportingBasis` (`Actual`, `Budget`)
  - `DimensionsJson` (open dimension metadata)
  - `ExtractionMethod = 'StructuredNLP'`
- Fully respects authority ranking, conflict resolution, access control, and Azure AI Search indexing.
