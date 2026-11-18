# Finora AI (FinChat) — Project Files Analysis by Implementation Stage

This document provides a comprehensive inventory and stage-by-stage analysis of all **168 files** within the Finora AI (`finchat`) repository. Each file is categorized by its respective architectural stage/phase along with a precise one-line use case explaining why it was created.

---

## Table of Contents
1. [Stage 1: System Governance, Specifications & Environment](#stage-1-system-governance-specifications--environment)
2. [Stage 2: Database Schema, Migrations & Fact Integrity](#stage-2-database-schema-migrations--fact-integrity)
3. [Stage 3: Ingestion Pathways, Queue Handover & Scope Validation](#stage-3-ingestion-pathways-queue-handover--scope-validation)
4. [Stage 4: Content Normalization & Contracts (NormalizedDocumentV1)](#stage-4-content-normalization--contracts-normalizeddocumentv1)
5. [Stage 5: Structured Fact Extraction Engine & Contracts (ExtractedFactsV1)](#stage-5-structured-fact-extraction-engine--contracts-extractedfactsv1)
6. [Stage 6: Synthetic Golden Benchmark Dataset & Evaluation Harness](#stage-6-synthetic-golden-benchmark-dataset--evaluation-harness)
7. [Stage 7: Conflict Governance, Human Approval & Decision Tokens](#stage-7-conflict-governance-human-approval--decision-tokens)
8. [Stage 8: Azure AI Search, Hybrid Vector Indexing & Leak Guard](#stage-8-azure-ai-search-hybrid-vector-indexing--leak-guard)
9. [Stage 9: Query Routing, Deterministic Calculation Engine & Chat Execution](#stage-9-query-routing-deterministic-calculation-engine--chat-execution)
10. [Stage 10: Lifecycle Governance, Soft Delete, Reconciler & Observability](#stage-10-lifecycle-governance-soft-delete-reconciler--observability)
11. [Stage 11: Enterprise Acceptance Test Suite & Binary Test Fixtures](#stage-11-enterprise-acceptance-test-suite--binary-test-fixtures)
12. [Stage 12: Automated Unit & Phase Verification Tests](#stage-12-automated-unit--phase-verification-tests)

---

## Stage 1: System Governance, Specifications & Environment
*Foundational architecture rules, requirements traceability, and deployment configuration.*

| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `IMPLEMENTATION_PLAN.md` | Core Specification | Defines the frozen, dependency-aligned 19-package implementation sequence and self-check rules B.1–B.9. |
| `REQUIREMENTS_TRACE.md` | Governance & Audit | Tracks end-to-end traceability of all Invariable Operating Rules (A.1–A.8) and Decisions (D1–D8) across code and tests. |
| `PROJECT_WORKFLOW.md` | Architecture Documentation | Details complete 10-step ingestion lifecycle, table parsers, conflict state transitions, and API reference. |
| `KNOWN_LIMITATIONS.md` | Security Boundaries | Formalizes Phase 1 boundaries, anonymous auth stubs, and security controls deferred to Phase 2. |
| `MANUAL_RUNBOOK.md` | Operational Guide | Provides operational instructions and manual verification steps for live cloud dependencies. |
| `BACKLOG.md` | Project Management | Tracks deferred enhancements, non-critical technical debt, and Phase 2 backlog work items. |
| `package.json` | Project Manifest | Manages Node.js 22 runtime dependencies, test scripts, and native ESM/CommonJS module settings. |
| `package-lock.json` | Dependency Lockfile | Locks deterministic dependency tree versions across builds and Azure Functions deployment environments. |
| `host.json` | Azure Functions Config | Configures Azure Functions v4 runtime settings, extension bundles, logging, and timeout limits. |
| `local.settings.json` | Local Environment Settings | Provides local secrets, connection strings, and environment variables for local Functions execution. |
| `.env` | Local Env Variables | Supplies environment configurations for standalone test runners and node CLI scripts. |
| `.env.example` | Env Template | Sanitized template demonstrating required configuration keys without exposing real credentials. |
| `.funcignore` | Deployment Filter | Prevents tests, local logs, and development files from being packaged into Azure Functions production zip. |
| `.gitignore` | Git Filter | Prevents node_modules, local secrets, temporary artifacts, and coverage reports from entering version control. |
| `.github/workflows/main_finchat-functions.yml` | CI/CD Automation | GitHub Actions pipeline automating build, test validation, and deployment to Azure Functions App. |

---

## Stage 2: Database Schema, Migrations & Fact Integrity
*Azure SQL relational schema, fact-level constraints, audit tables, and database client.*

| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `database/schema.sql` | Master Database Schema | Defines full 13-table Azure SQL schema including Documents, FinancialFacts, SourceAuthorityRanks, and Views. |
| `database/migrations/001_dynamic_financial_fact_architecture.sql` | Migration (Phase 4.1) | Creates dynamic entity, metric, period, and financial fact tables eliminating hardcoded taxonomies. |
| `database/migrations/002_conflict_governance_and_notifications.sql` | Migration (Phase 4.4) | Adds FactConflicts, FactResolutions, FactAudit, and single-use decision token tracking columns. |
| `database/migrations/003_fact_integrity_and_master_schema.sql` | Migration (WP13) | Enforces unique constraints on FactIdentityHash/SourceLocationHash and adds bilingual aliases. |
| `src/services/sql.js` | Azure SQL Data Access Layer | Manages connection pooling, parameterized queries, atomic transactions, and fact retrieval views. |

---

## Stage 3: Ingestion Pathways, Queue Handover & Scope Validation
*File validation, scope enforcement, HTTP upload endpoint, and SharePoint scanner.*

| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `src/functions/ingestDocument.js` | HTTP Ingestion Route (WP2) | HTTP API endpoint (`POST /api/ingestDocument`) handling file uploads, authority rank, and scope gating. |
| `src/functions/processDocumentQueue.js` | SharePoint Queue Worker | Timer function polling and processing incoming document items from SharePoint queues with locking. |
| `src/functions/sharepointScanner.js` | SharePoint Scan Worker (WP11) | Automated scanner checking document libraries and dispatching upfront rejection notices for non-compliant files. |
| `src/services/sharepoint-queue.js` | SharePoint Integration | Connects to Microsoft Graph API to read, lock, download, and update queue item states in SharePoint. |
| `src/services/sharepoint-scanner.js` | Governance Scanner (WP11) | Validates scanned PDFs and macro workbooks upfront and sends uploader rejection emails. |
| `src/services/ingestion-pipeline.js` | Ingestion Orchestration | Orchestrates the end-to-end 10-step lifecycle linking validation, extraction, staging, and indexing. |
| `src/services/durable-queue.js` | Queue Durability (WP15) | Implements resilient queuing with exponential backoff and dead-letter queue (DLQ) poison routing. |
| `src/utils/validation.js` | Scope & Buffer Gating (WP2) | Enforces Rule A.6 by validating magic bytes, rejecting Word/CSV/macros, and detecting scanned PDFs. |
| `src/utils/errors.js` | Error Hierarchy | Defines enterprise error classes (ValidationError, ConflictError, AppError) with HTTP status mapping. |
| `src/utils/config.js` | Runtime Configuration | Centralizes environment variable reading, parsing, and strict defaults validation across services. |

---

## Stage 4: Content Normalization & Contracts (NormalizedDocumentV1)
*Parsing raw documents into structured 2D grids, multi-level headers, and intermediate contracts.*

| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `contracts/normalized-document.v1.schema.json` | Contract Specification (Phase 3) | JSON Schema defining standard structure for 2D cell grids, headers, paragraph blocks, and metadata. |
| `contracts/normalized-document.js` | Contract Factory (Phase 3) | Factory module constructing and validating contract-compliant `NormalizedDocumentV1` payloads. |
| `src/services/normalized-document-validator.js` | Contract Validator (Phase 3) | Validates document payloads against `NormalizedDocumentV1` schema using Ajv schema engine. |
| `src/services/content-normalizer.js` | Normalization Engine (Phase 3) | Reconstructs 2D table grids, computes header scores, resolves hierarchical header paths, and classifies paragraph roles. |
| `src/services/local-extractor.js` | Local Parser Engine | Extracts raw tabular and text content from PDFs and Excel files using pdf-parse and xlsx without cloud APIs. |
| `src/services/document-intelligence.js` | Cloud Document AI | Integrates Azure AI Document Intelligence layout models for complex multi-column and scanned layouts. |
| `contracts/examples/01-metrics-in-columns.json` | Contract Example | Reference fixture showing metrics positioned in columns across period rows. |
| `contracts/examples/02-metrics-in-rows.json` | Contract Example | Reference fixture showing traditional income statement layout with metrics in rows across period columns. |
| `contracts/examples/03-multi-level-headers.json` | Contract Example | Reference fixture illustrating hierarchical two-tier segment headers (Geography / Business Unit). |
| `contracts/examples/04-pdf-table-locations.json` | Contract Example | Reference fixture containing exact PDF page numbers, bounding boxes, and provenance locations. |
| `contracts/examples/05-excel-formulas-cells.json` | Contract Example | Reference fixture preserving Excel formula expressions, cached values, and error types. |
| `contracts/examples/06-narrative-context-paragraphs.json` | Contract Example | Reference fixture capturing narrative commentary blocks associated with financial tables. |
| `contracts/examples/07-duplicate-blank-headers.json` | Contract Example | Reference fixture modeling edge cases with empty header cells and repeated section labels. |
| `contracts/examples/08-unknown-missing-metadata.json` | Contract Example | Reference fixture validating graceful handling of missing issuer, date, or reporting period metadata. |

---

## Stage 5: Structured Fact Extraction Engine & Contracts (ExtractedFactsV1)
*Dynamic entity/metric identification, table layout parsing, unit scaling, and bilingual NLP.*

| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `contracts/extracted-facts.v1.schema.json` | Contract Specification (Phase 4.1) | JSON Schema defining atomic financial facts, 8-coordinate identities, provenance, and validation status. |
| `contracts/extracted-facts.js` | Contract Factory (Phase 4.1) | Factory constructing standardized `ExtractedFactsV1` objects with extraction metadata and audit counters. |
| `src/services/extracted-facts-validator.js` | Contract Validator (Phase 4.1) | Enforces schema validation and invariant checks on extracted financial facts. |
| `src/services/fact-extraction.js` | Core Extraction Engine (Phase 4.3) | Dynamically extracts facts from tables and narrative paragraphs across 6 structural table archetypes. |
| `src/services/unit-normalizer.js` | Scale & Unit Normalizer (Phase 4.3.2) | Normalizes scales ('000, millions), isolates currencies, and canonicalizes % and bps to decimal ratios. |
| `src/services/arabic-normalizer.js` | Multilingual NLP (WP5) | Normalizes Arabic Unicode variants, strips tatweel/tashkeel, and converts Eastern Arabic numerals to ASCII. |

---

## Stage 6: Synthetic Golden Benchmark Dataset & Evaluation Harness
*Independent 100-fact ground truth benchmark, automated accuracy evaluation, and diagnostic reports.*

| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `tests/financial-facts/golden-dataset/README.md` | Benchmark Specification (Phase 4.2.2) | Specification guide detailing 11 benchmark documents, 5 fixtures, 100 facts, and baseline evaluation results. |
| `tests/financial-facts/golden-dataset/evaluation/evaluate-extraction.js` | Evaluation Engine (Phase 4.2.2/4.2.4) | Evaluates extraction engine against golden ground truth, computing Precision, Recall, F1, and field accuracy. |
| `tests/financial-facts/golden-dataset/evaluation/baseline-evaluation-report.json` | Historical Baseline Report | Persisted evaluation report documenting Phase 4.2.2 legacy baseline performance (F1: 81.22%). |
| `tests/financial-facts/golden-dataset/evaluation/revised-evaluation-report.v2.json` | Strict V2 Evaluation Report | Persisted evaluation report verifying 100% Precision, Recall, and F1 under strict business identity matching. |
| `tests/financial-facts/golden-dataset/documents/doc-01-contoso-retail-q1-audited.json` | Benchmark Doc 1 (Normalized) | Audited Q1 P&L for Contoso Retail LLC (Rank 1, 9 facts, Revenue = 12.48M AED). |
| `tests/financial-facts/golden-dataset/documents/doc-02-contoso-retail-q2-management-pack.json` | Benchmark Doc 2 (Normalized) | Management Pack P&L for Contoso Retail LLC (Rank 2, 10 facts including narrative revenue growth). |
| `tests/financial-facts/golden-dataset/documents/doc-03-contoso-logistics-q1-audited.json` | Benchmark Doc 3 (Normalized) | Audited Q1 P&L for Contoso Logistics LLC (Rank 1, 9 facts, Direct operating costs and PBT). |
| `tests/financial-facts/golden-dataset/documents/doc-04-contoso-logistics-q2-draft-v1.json` | Benchmark Doc 4 (Normalized) | Draft v1 Q2 P&L for Contoso Logistics LLC (Rank 3, 4 facts, Revenue = 9.105M AED). |
| `tests/financial-facts/golden-dataset/documents/doc-05-contoso-logistics-q2-final-v2.json` | Benchmark Doc 5 (Normalized) | Final v2 Q2 P&L for Contoso Logistics LLC superseding Doc 4 (Rank 2, 4 facts, Revenue = 9.35M AED). |
| `tests/financial-facts/golden-dataset/documents/doc-06-contoso-properties-q1-management-pack.json` | Benchmark Doc 6 (Normalized) | Management Pack for Contoso Properties LLC (Rank 2, 8 facts including Cash Shortfall instant fact). |
| `tests/financial-facts/golden-dataset/documents/doc-07-contoso-holdings-board-pack-q1.json` | Benchmark Doc 7 (Normalized) | Group Summary in AED thousands for Contoso Holdings (Rank 2, 12 facts, conflicting with Doc 1). |
| `tests/financial-facts/golden-dataset/documents/doc-08-contoso-retail-budget-fy2026.json` | Benchmark Doc 8 (Normalized) | Approved Budget matrix for Contoso Retail LLC across Q1–Q4 and FY2026 (Rank 2, 10 budget facts). |
| `tests/financial-facts/golden-dataset/documents/doc-09-contoso-logistics-budget-fy2026.json` | Benchmark Doc 9 (Normalized) | Approved Budget for Contoso Logistics LLC across 5 periods (Rank 2, 5 budget facts). |
| `tests/financial-facts/golden-dataset/documents/doc-10-contoso-properties-budget-fy2026.json` | Benchmark Doc 10 (Normalized) | Approved Rental Budget in AED thousands for Contoso Properties LLC (Rank 2, 5 budget facts). |
| `tests/financial-facts/golden-dataset/documents/doc-11-contoso-holdings-group-actuals-tracker.json` | Benchmark Doc 11 (Normalized) | Multi-entity actuals tracker holding stale Logistics Q2 draft data (Rank 3, 10 facts). |
| `tests/financial-facts/golden-dataset/fixtures/fixture-01-multilevel-segments.json` | Edge Case Fixture 1 | Fixture testing 2-level header segment dimensions (Channel / Geography) and percentage margins. |
| `tests/financial-facts/golden-dataset/fixtures/fixture-02-excel-formulas-and-errors.json` | Edge Case Fixture 2 | Fixture testing cached formula value extraction and #DIV/0! error fact capture. |
| `tests/financial-facts/golden-dataset/fixtures/fixture-03-ratios-and-bps.json` | Edge Case Fixture 3 | Fixture testing normalization of percentages, basis points (180 bps), and raw ratios. |
| `tests/financial-facts/golden-dataset/fixtures/fixture-04-missing-metadata-and-stray.json` | Edge Case Fixture 4 | Fixture testing missing entity tolerance, headcount unit isolation, and exclusion of stray numbers. |
| `tests/financial-facts/golden-dataset/fixtures/fixture-05-narrative-commentary-bilingual.json` | Edge Case Fixture 5 | Fixture testing bilingual English and Arabic narrative disclosures with monetary amounts. |
| `tests/financial-facts/golden-dataset/expected-facts/doc-01-expected.json` | Ground Truth (ExtractedFactsV1) | 9 manually verified ground-truth facts for Benchmark Doc 1. |
| `tests/financial-facts/golden-dataset/expected-facts/doc-02-expected.json` | Ground Truth (ExtractedFactsV1) | 10 manually verified ground-truth facts for Benchmark Doc 2 (including narrative growth ratio). |
| `tests/financial-facts/golden-dataset/expected-facts/doc-03-expected.json` | Ground Truth (ExtractedFactsV1) | 9 manually verified ground-truth facts for Benchmark Doc 3. |
| `tests/financial-facts/golden-dataset/expected-facts/doc-04-expected.json` | Ground Truth (ExtractedFactsV1) | 4 manually verified ground-truth facts for Benchmark Doc 4 (Logistics Draft v1). |
| `tests/financial-facts/golden-dataset/expected-facts/doc-05-expected.json` | Ground Truth (ExtractedFactsV1) | 4 manually verified ground-truth facts for Benchmark Doc 5 (Logistics Final v2). |
| `tests/financial-facts/golden-dataset/expected-facts/doc-06-expected.json` | Ground Truth (ExtractedFactsV1) | 8 manually verified ground-truth facts for Benchmark Doc 6 (5 P&L + 3 Liquidity instant facts). |
| `tests/financial-facts/golden-dataset/expected-facts/doc-07-expected.json` | Ground Truth (ExtractedFactsV1) | 12 manually verified ground-truth facts scaled by 1000 for Benchmark Doc 7. |
| `tests/financial-facts/golden-dataset/expected-facts/doc-08-expected.json` | Ground Truth (ExtractedFactsV1) | 10 manually verified budget facts across 5 periods for Benchmark Doc 8. |
| `tests/financial-facts/golden-dataset/expected-facts/doc-09-expected.json` | Ground Truth (ExtractedFactsV1) | 5 manually verified budget facts for Benchmark Doc 9. |
| `tests/financial-facts/golden-dataset/expected-facts/doc-10-expected.json` | Ground Truth (ExtractedFactsV1) | 5 manually verified rental budget facts scaled by 1000 for Benchmark Doc 10. |
| `tests/financial-facts/golden-dataset/expected-facts/doc-11-expected.json` | Ground Truth (ExtractedFactsV1) | 10 manually verified multi-entity tracker facts for Benchmark Doc 11. |
| `tests/financial-facts/golden-dataset/expected-facts/fixture-01-expected.json` | Ground Truth (ExtractedFactsV1) | 4 ground-truth facts verifying multi-level segment dimensions and margins. |
| `tests/financial-facts/golden-dataset/expected-facts/fixture-02-expected.json` | Ground Truth (ExtractedFactsV1) | 2 ground-truth facts verifying formula evaluation and #DIV/0! error status. |
| `tests/financial-facts/golden-dataset/expected-facts/fixture-03-expected.json` | Ground Truth (ExtractedFactsV1) | 4 ground-truth facts verifying canonical decimal conversion of %, bps, and ratios. |
| `tests/financial-facts/golden-dataset/expected-facts/fixture-04-expected.json` | Ground Truth (ExtractedFactsV1) | 2 ground-truth facts verifying headcount metric isolation and stray noise exclusion. |
| `tests/financial-facts/golden-dataset/expected-facts/fixture-05-expected.json` | Ground Truth (ExtractedFactsV1) | 2 ground-truth facts verifying bilingual English and Arabic narrative extraction. |

---

## Stage 7: Conflict Governance, Human Approval & Decision Tokens
*Conflict detection engine, HMAC decision tokens, review endpoints, email notifications, and lifecycle timers.*

| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `src/functions/confirmConflict.js` | Human Review Endpoints (WP8) | Provides RFC 7231 read-only GET preview and transactional POST decision execution. |
| `src/functions/conflictLifecycleTimer.js` | Lifecycle Worker (WP16) | Timer function managing 24h/48h conflict reminders and 3-strike escalation policies. |
| `src/functions/adminConflicts.js` | Admin Governance API (WP18) | Admin endpoint listing active conflicts and manual resolution overrides. |
| `src/services/conflict-resolver.js` | Conflict Engine (WP6) | Compares 8-field business identities, applies Rule D4 tolerances, and stages conflicts. |
| `src/services/conflict-token.js` | Cryptographic Tokens (WP8) | Issues and validates expiring single-use HMAC-SHA256 conflict decision tokens. |
| `src/services/conflict-notifier.js` | Email Dispatcher (WP7) | Formats and dispatches conflict notification emails via Microsoft Graph with dual access links. |
| `src/services/blob-storage.js` | Azure Blob Storage (WP14) | Streams document buffers to Azure Blob Storage and generates 72-hour time-limited read SAS URLs. |

---

## Stage 8: Azure AI Search, Hybrid Vector Indexing & Leak Guard
*Hybrid vector and semantic search index, chunking, embeddings, and leak guards.*

| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `src/services/azure-search.js` | Hybrid Search Client (WP5) | Executes hybrid BM25 and vector searches with strict document ID allow-list filters. |
| `src/services/search-document.js` | Search Document Formatting | Formats document text chunks and vector embeddings for upload into Azure AI Search. |
| `src/services/search-index.js` | Index Definition & Setup | Defines Azure AI Search index schema, vector configuration, and semantic ranking profiles. |
| `src/services/chunking.js` | Content Chunking Engine | Chunks normalized documents (1000 chars, 200 overlap) while preserving tabular boundary isolation. |
| `src/services/embeddings.js` | Vector Embeddings (WP5) | Generates 1536-dimensional embeddings using Azure OpenAI `text-embedding-3-small`. |
| `scripts/update-search-index.js` | Index Management Utility | CLI script for deploying, updating, or repairing the Azure AI Search index schema. |

---

## Stage 9: Query Routing, Deterministic Calculation Engine & Chat Execution
*User intent routing, arbitrary-precision arithmetic, chat endpoint, and zero-hallucination math.*

| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `src/functions/chat.js` | Chat HTTP Endpoint (WP10/17) | API endpoint (`POST /api/chat`) enforcing conflict holds (Rule A.8) and routing queries. |
| `src/functions/getIngestionStatus.js` | Ingestion Status API | API endpoint (`GET /api/getIngestionStatus`) reporting document processing, hold, and indexing state. |
| `src/functions/dbHealth.js` | Health Check API | API endpoint (`GET /api/dbHealth`) verifying Azure SQL pool connectivity and table counts. |
| `src/services/intent-classifier.js` | Intent Classification (WP4) | Classifies user queries into DIRECT_SQL, AZURE_SEARCH, or OUT_OF_SCOPE categories. |
| `src/services/calculation-engine.js` | Math Engine (WP3) | Computes variances, sums, and YoY percentages using pure code arithmetic with zero LLM math. |
| `src/services/answer-generation.js` | Answer Synthesizer | Synthesizes natural language chat answers from verified SQL facts and calculation results. |
| `src/services/evidence-validation.js` | Evidence Guard (WP10) | Validates that all facts cited in answers possess verified provenance and Approved status. |
| `src/services/model-client.js` | Azure OpenAI Gateway (WP4) | Manages resilient API calls to Azure OpenAI fast and strong deployments from env variables. |
| `src/utils/decimal.js` | Decimal Math Library (WP3) | Wraps decimal.js to provide arbitrary-precision arithmetic avoiding IEEE-754 floating-point errors. |

---

## Stage 10: Lifecycle Governance, Soft Delete, Reconciler & Observability
*Audit trail logging, background reconciliation, soft deletion, and system telemetry.*

| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `src/functions/reconcilerTimer.js` | Reconciler Worker (WP9) | Timer function periodically executing background data and search consistency reconciliations. |
| `src/services/reconciler.js` | System Reconciler (WP9) | Resolves orphaned conflict holds, repairs search desyncs, and enforces soft delete (Rule A.3). |
| `src/services/observability.js` | Telemetry & Audit (WP18) | Aggregates document/fact metrics, system health counters, and exports chronological audit trails. |

---

## Stage 11: Enterprise Acceptance Test Suite & Binary Test Fixtures
*370+ line master acceptance scenario dataset, test runner, and real test files.*

| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `tests/acceptance/acceptance-dataset.json` | Master Acceptance Dataset | Master JSON dataset containing test cases validating rules A.1–A.8 and decisions D1–D8 across 13 categories. |
| `tests/acceptance/run-acceptance.js` | Acceptance CLI Runner | Standalone CLI script executing the master acceptance test suite against live or mocked backends. |
| `tests/acceptance/wp12-acceptance.test.js` | WP12 Master Acceptance Test | Automated test suite executing all end-to-end acceptance scenarios in `acceptance-dataset.json`. |
| `tests/fixtures/01_Contoso_Retail_Income_Statement_Q1_2026_Audited.pdf` | Test Fixture (PDF) | Realistic audited statutory PDF income statement used for PDF table extraction testing. |
| `tests/fixtures/arabic_financial_model.xlsx` | Test Fixture (Excel) | Bilingual Arabic Excel financial model used for Arabic table extraction and number parsing. |
| `tests/fixtures/arabic_financial_report.pdf` | Test Fixture (PDF) | Arabic PDF financial report used for testing right-to-left layout and Unicode normalization. |
| `tests/fixtures/encrypted_confidential.pdf` | Test Fixture (Negative) | Password-protected encrypted PDF fixture verifying upfront rejection under Rule A.6. |
| `tests/fixtures/encrypted_locked.xlsx` | Test Fixture (Negative) | Password-protected Excel workbook fixture verifying upfront scope rejection. |
| `tests/fixtures/hr_headcount_report.xlsx` | Test Fixture (Excel) | HR department staffing spreadsheet verifying non-currency headcount unit extraction. |
| `tests/fixtures/macro_model.xlsm` | Test Fixture (Negative) | Macro-enabled Excel workbook (.xlsm) verifying immediate security rejection under Rule A.6. |
| `tests/fixtures/merged_header_statement.xlsx` | Test Fixture (Excel) | Excel balance sheet containing horizontally and vertically merged cells for layout testing. |
| `tests/fixtures/prompt_injection_memo.pdf` | Test Fixture (Security) | Adversarial PDF memo with prompt injection strings verifying delimiter isolation. |
| `tests/fixtures/scanned_statement.pdf` | Test Fixture (Negative) | Low-density scanned PDF with under 100 extractable characters verifying rejection. |
| `tests/fixtures/seed-test-entities.sql` | Test Fixture (SQL) | SQL script seeding initial test corporate entities, subsidiaries, and aliases for test runs. |
| `tests/fixtures/seeded_conflict_v1.xlsx` | Test Fixture (Conflict) | Initial version of a financial report used to establish baseline approved SQL facts. |
| `tests/fixtures/seeded_conflict_v2.xlsx` | Test Fixture (Conflict) | Updated version of the financial report with differing figures triggering conflict staging. |
| `tests/fixtures/seeded_tolerance_v1.xlsx` | Test Fixture (Tolerance) | Financial statement version A used to test rounding tolerance boundaries under Decision D4. |
| `tests/fixtures/seeded_tolerance_v2.xlsx` | Test Fixture (Tolerance) | Financial statement version B with 0.005% variance verifying non-conflict auto-acceptance. |

---

## Stage 12: Automated Unit & Phase Verification Tests
*Comprehensive test coverage across contracts, core units, work packages, and implementation phases.*

### 12.1 Contract Schema Tests
| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `tests/unit/contracts/benchmark-documents.test.js` | Contract Verification | Verifies that all 11 benchmark documents adhere strictly to `NormalizedDocumentV1` schema. |
| `tests/unit/contracts/dynamic-facts-architecture.test.js` | Phase 4.1 Verification | Tests dynamic schema migration, dynamic entity registration, and metric creation without hardcoding. |
| `tests/unit/contracts/extracted-facts-contract.test.js` | Contract Verification | Validates extracted fact arrays against `ExtractedFactsV1` required fields and invariants. |
| `tests/unit/contracts/extraction-normalization.test.js` | Contract Verification | Validates integration between raw text extraction and content normalization contract formatting. |
| `tests/unit/contracts/fact-integrity-schema.test.js` | WP13 Verification | Validates unique constraints on FactIdentityHash and SourceLocationHash preventing duplicates. |
| `tests/unit/contracts/golden-dataset-evaluation.test.js` | Phase 4.2.2 Verification | Validates golden dataset structure, contract compliance, baseline preservation, and strict v2 evaluation. |
| `tests/unit/contracts/normalized-document-contract.test.js` | Contract Verification | Tests `NormalizedDocumentV1` JSON schema validation across all 8 reference example fixtures. |

### 12.2 Core Service Tests
| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `tests/unit/core/async-ingestion.test.js` | Core Ingestion Test | Verifies asynchronous HTTP ingestion returning HTTP 202 and background job status tracking. |
| `tests/unit/core/chunking.test.js` | Core Search Test | Tests sliding-window text chunking with table boundary isolation and character overlap. |
| `tests/unit/core/model-client.test.js` | Core Model Test | Tests Azure OpenAI client model deployment routing and fallback retry handling. |
| `tests/unit/core/search-document.test.js` | Core Search Test | Tests search payload building, metadata attribute mapping, and document key sanitization. |

### 12.3 Phase-by-Phase Feature Tests
| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `tests/unit/phases/phase2-guardrails.test.js` | Phase 2 Guardrails Test | Verifies `ENFORCE_AUTH=false` default, `isAuthEnforced()` evaluator, and `TODO(PHASE2)` markers. |
| `tests/unit/phases/phase3-1-normalization-fixes.test.js` | Phase 3.1 Fixes Test | Verifies normalization defect corrections for merged header alignment and whitespace normalization. |
| `tests/unit/phases/phase3-content-normalizer-v1.test.js` | Phase 3 Normalizer Test | Comprehensive verification of 2D grid rebuilding, header scoring, and paragraph classification. |
| `tests/unit/phases/phase4-3-1-entity-metric-identification.test.js` | Phase 4.3.1 Feature Test | Tests dynamic entity and metric identification across legal suffixes and bilingual headings. |
| `tests/unit/phases/phase4-3-2-unit-scale-normalization.test.js` | Phase 4.3.2 Feature Test | Tests scale multiplication ('000, millions), ratio canonicalization, and currency isolation. |
| `tests/unit/phases/phase4-3-3-narrative-fact-extraction.test.js` | Phase 4.3.3 Feature Test | Tests bilingual English and Arabic regex and NLP extraction of financial facts from text. |
| `tests/unit/phases/phase4-3-4-extraction-audit.test.js` | Phase 4.3.4 Audit Test | Validates fact count integrity, extraction audit logging, and processing time telemetry. |
| `tests/unit/phases/phase4-3-5-defect-corrections.test.js` | Phase 4.3.5 Bugfix Test | Verifies bug fixes for table coordinate drift, footnote row filtering, and formula error handling. |
| `tests/unit/phases/phase4-4-1-security-integration-audit.test.js` | Phase 4.4.1 Security Test | Audits chat hold leak guards, search allow-list filtering, and RFC 7231 read-only GET safety. |
| `tests/unit/phases/phase4-4-conflict-detection.test.js` | Phase 4.4 Conflict Test | Comprehensive 22-scenario test suite verifying conflict detection, decision tokens, and staging. |

### 12.4 Work Package Tests (WP1 to WP18)
| File Path | Implementation Stage | One-Line Use Case |
| :--- | :--- | :--- |
| `tests/unit/work-packages/wp-batch4-package7.test.js` | WP Batch Integration Test | Verifies integration between conflict notification generation and Graph mail client queuing. |
| `tests/unit/work-packages/wp10-wp17-chat-hold-leak-guard.test.js` | WP10/WP17 Integration Test | Verifies that unapproved facts and conflict-held documents return HTTP 409 and never leak to chat. |
| `tests/unit/work-packages/wp11-sharepoint-scanner.test.js` | WP11 Feature Test | Tests SharePoint library scanning, macro workbook rejection, and automated rejection email notices. |
| `tests/unit/work-packages/wp14-blob-sas.test.js` | WP14 Feature Test | Verifies Azure Blob Storage block upload, SAS token generation, and 72-hour TTL expiration. |
| `tests/unit/work-packages/wp15-durable-queue.test.js` | WP15 Feature Test | Tests durable queue worker retry backoff, exponential delays, and poison message routing to DLQ. |
| `tests/unit/work-packages/wp16-conflict-lifecycle.test.js` | WP16 Lifecycle Test | Verifies 24h and 48h reminder notifications and 3-strike escalation rules for pending conflicts. |
| `tests/unit/work-packages/wp16-decision-cascade.test.js` | WP16 Cascade Test | Verifies document status cascade (`Succeeded`, `PartiallyApproved`, `Superseded`) on decision POST. |
| `tests/unit/work-packages/wp17-chat-governance.test.js` | WP17 Feature Test | Verifies chat conflict hold refusal responses (`status: 'CONFLICT_PENDING'`) naming files without figures. |
| `tests/unit/work-packages/wp18-observability.test.js` | WP18 Feature Test | Tests pipeline metrics aggregator, governance status counters, and audit trail export functionality. |
| `tests/unit/work-packages/wp2-scope-idempotency.test.js` | WP2 Feature Test | Verifies SHA-256 `ContentHash` duplicate skip, macro rejection, and scanned PDF detection. |
| `tests/unit/work-packages/wp2-wiring.test.js` | WP2 Wiring Test | Validates routing and middleware integration for file validation within the ingestion pipeline. |
| `tests/unit/work-packages/wp3-effective-facts-math.test.js` | WP3 Feature Test | Tests the arbitrary-precision `Decimal` calculation engine and zero-LLM arithmetic rules. |
| `tests/unit/work-packages/wp4-search-allowlist.test.js` | WP4/D7 Feature Test | Tests dynamic construction of Azure AI Search `$filter=search.in(...)` allow-list expressions. |
| `tests/unit/work-packages/wp4-wp5-router-arabic.test.js` | WP4/WP5 Feature Test | Tests bilingual content routing and Arabic text/numeral normalization for intent classification. |
| `tests/unit/work-packages/wp6-conflict-engine.test.js` | WP6 Feature Test | Tests 8-coordinate business identity comparison, tolerance boundary D4, and `sp_getapplock` serialization. |
| `tests/unit/work-packages/wp7-conflict-notifier.test.js` | WP7 Feature Test | Tests conflict notification email formatting, recipient domain validation, and figures-lost warnings. |
| `tests/unit/work-packages/wp8-decision-tokens.test.js` | WP8 Feature Test | Tests HMAC-SHA256 single-use token generation, expiry validation, and replay rejection (HTTP 409). |
| `tests/unit/work-packages/wp9-reconciler.test.js` | WP9 Feature Test | Tests background reconciler orphaned hold clearance and soft-delete state enforcement (Rule A.3). |

---

## Summary Statistics

```
+-----------------------------------------------------------------------------------+
|                        FINORA AI (FINCHAT) REPOSITORY INVENTORY                   |
+-------------------------------------------------------------------+---------------+
| Stage Category                                                    | File Count    |
+-------------------------------------------------------------------+---------------+
| Stage 1: System Governance, Specifications & Environment          | 15 files      |
| Stage 2: Database Schema, Migrations & Fact Integrity (Azure SQL) | 5 files       |
| Stage 3: Ingestion Pathways, Queue Handover & Scope Validation    | 10 files      |
| Stage 4: Content Normalization & Contracts (NormalizedDocumentV1) | 14 files      |
| Stage 5: Structured Fact Extraction Engine & Contracts            | 6 files       |
| Stage 6: Synthetic Golden Benchmark Dataset & Evaluation Harness  | 36 files      |
| Stage 7: Conflict Governance, Human Approval & Decision Tokens    | 7 files       |
| Stage 8: Azure AI Search, Hybrid Vector Indexing & Leak Guard     | 6 files       |
| Stage 9: Query Routing, Deterministic Calculation Engine & Chat   | 9 files       |
| Stage 10: Lifecycle Governance, Soft Delete & Reconciler          | 3 files       |
| Stage 11: Enterprise Acceptance Test Suite & Binary Test Fixtures | 18 files      |
| Stage 12: Automated Unit & Phase Verification Tests               | 39 files      |
+-------------------------------------------------------------------+---------------+
| TOTAL FILES IN REPOSITORY                                         | 168 files     |
+-------------------------------------------------------------------+---------------+
```
