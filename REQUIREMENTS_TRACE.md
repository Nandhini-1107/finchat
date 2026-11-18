# Finora AI (FinChat) — Requirements Traceability Matrix

This document provides exhaustive, end-to-end traceability of all Work Packages (WP1–WP19), Invariable Operating Rules (A.1–A.8), and Architectural Decisions (D1–D8) across source files, functions, and automated tests.

---

## Status Legend
- **Done+tested**: Implementation complete in code and verified with passing automated tests in the test suite.
- **Done+UNVERIFIED**: Implementation complete in code, but depends on real-world cloud tenant infrastructure / external SaaS networks.

---

## 1. Work Package Traceability Matrix (WP1 – WP19)

| Package | Name | Implementation Source Files & Key Functions | Test Files & Test Names | Status |
| :--- | :--- | :--- | :--- | :---: |
| **WP1** | Baseline Auth Guardrails & Phase 2 Boundary | • `src/utils/config.js` (`isAuthEnforced`)<br>• `src/functions/confirmConflict.js`<br>• `src/functions/chat.js`<br>• `src/functions/ingestDocument.js`<br>• `KNOWN_LIMITATIONS.md` | • `tests/phase2-guardrails.test.js`<br>  - *1. Auth Guardrail Enforcement: isAuthEnforced()*<br>  - *2. Security Audit Markers* | **Done+tested** |
| **WP2** | Strict Scope, Rejections & ContentHash Idempotency | • `src/utils/validation.js` (`validateDocumentBuffer`)<br>• `src/functions/ingestDocument.js`<br>• `src/services/sql.js` (`findDocumentByContentHash`) | • `tests/wp2-scope-idempotency.test.js`<br>  - *1. Format Gating*<br>  - *2. ContentHash Idempotency*<br>• `tests/wp-batch4-package7.test.js`<br>  - *1. EncryptedFileNotSupported*<br>  - *2. ExternalLinksNotSupported* | **Done+tested** |
| **WP3** | Pure SQL Fact Store View & Decimal Math Engine | • `src/services/sql.js` (`vw_FinancialFacts_Complete`)<br>• `src/utils/decimal.js` (`Decimal`)<br>• `src/services/calculation-engine.js` (`computeVariance`, `computeCategorySum`, `resolveQuestionToDimensions`) | • `tests/wp3-effective-facts-math.test.js`<br>  - *1. Decimal Math Precision*<br>  - *2. Zero-base denominator*<br>  - *9. Half-Up Rounding of Negatives (-2.675 -> -2.68)*<br>  - *10. Division Precision*<br>  - *11. Extreme Values (1e15, 1e-6)*<br>  - *13-16. Question-to-Fact Resolution* | **Done+UNVERIFIED**<br>*(SQL view on real database UNVERIFIED)* |
| **WP4** | Dynamic Ingestion Router & Azure Search Allow-List | • `src/services/content-normalizer.js` (`normalizeContent`, `toText`)<br>• `src/services/azure-search.js` (`searchSimilar`)<br>• `src/services/sql.js` (`getSearchAllowList`) | • `tests/wp4-search-allowlist.test.js`<br>  - *1. Empty allow-list returns []*<br>  - *2. search.in OData filter*<br>  - *3. Excludes held/pending/partially approved*<br>• `tests/wp4-wp5-router-arabic.test.js` | **Done+tested** |
| **WP5** | Arabic Normalization & Bilingual Aliases | • `src/services/arabic-normalizer.js` (`normalizeArabicText`, `normalizeArabicDigits`, `parseArabicNumber`)<br>• `src/services/unit-normalizer.js` (`extractScaleFromText`) | • `tests/wp4-wp5-router-arabic.test.js`<br>  - *1. normalizeArabicText*<br>  - *3. Eastern Arabic numerals*<br>• `tests/wp-batch4-package7.test.js`<br>  - *4. Persian digits and scale words* | **Done+UNVERIFIED**<br>*(Arabic RTL PDF order UNVERIFIED)* |
| **WP6** | Dynamic Conflict Detection & AppLock | • `src/services/conflict-resolver.js` (`detectAndResolveConflicts`, `buildFactIdentityKey`)<br>• `src/services/sql.js` (`acquireFactAppLock`, `createFactConflict`) | • `tests/wp6-conflict-engine.test.js`<br>  - *1. 8-Field Fact Identity*<br>  - *2. Tolerance Boundary D4*<br>  - *5. AppLock Serialization* | **Done+UNVERIFIED**<br>*(sp_getapplock on real SQL UNVERIFIED)* |
| **WP7** | Uploader Conflict Email & Domain Validation | • `src/services/conflict-notifier.js` (`sendConflictNotification`, `formatConflictEmailNotification`, `resolveAndValidateRecipient`) | • `tests/wp7-conflict-notifier.test.js`<br>  - *1. Recipient domain validation*<br>  - *2. Dual Links (SharePoint + Blob SAS)* | **Done+UNVERIFIED**<br>*(Graph access policy UNVERIFIED)* |
| **WP8** | Cryptographic Decision Tokens & Safe HTTP Handlers | • `src/services/conflict-token.js` (`generateDecisionToken`, `verifyDecisionToken`, `hashToken`)<br>• `src/functions/confirmConflict.js` | • `tests/wp8-decision-tokens.test.js`<br>  - *1. GET read-only preview*<br>  - *2. POST decision execution*<br>  - *3. 409 replay protection*<br>  - *4. 410 token expiry* | **Done+tested** |
| **WP9** | Reconciler & Strict Soft-Delete Policy | • `src/services/reconciler.js` (`runReconciliationScan`, `softDeleteFact`, `softDeleteDocument`)<br>• `src/functions/reconcilerTimer.js` (`app.timer`) | • `tests/wp9-reconciler.test.js`<br>  - *1. Releases orphaned hold*<br>  - *2. Supersedes document with 0 approved facts*<br>  - *3. SoftDelete NEVER deletes row* | **Done+tested** |
| **WP10** | Data Leak Guard & Hold Isolation | • `src/functions/chat.js`<br>• `src/services/sql.js` (`getSearchAllowList`)<br>• `src/services/azure-search.js` (`searchSimilar`) | • `tests/wp10-wp17-chat-hold-leak-guard.test.js`<br>  - *1. Chat hold blocks unapproved facts*<br>  - *2. PartiallyApproved narrative exclusion* | **Done+tested** |
| **WP11** | SharePoint Library Scanner & Uploader Notification | • `src/services/sharepoint-scanner.js` (`scanSharePointLibrary`, `scanAndProcessSharePointFiles`)<br>• `src/functions/sharepointScanner.js` (`app.timer`, `app.http`) | • `tests/wp11-sharepoint-scanner.test.js`<br>• `tests/wp-batch4-package7.test.js`<br>  - *3. eTag, SourceRemoved, 429 backoff, 9-min timeout* | **Done+UNVERIFIED**<br>*(Live SharePoint Graph UNVERIFIED)* |
| **WP12** | Master Acceptance Test Suite | • `tests/acceptance/run-acceptance.js`<br>• `tests/acceptance/acceptance-dataset.json` | • `tests/acceptance/run-acceptance.js`<br>  - *13 Categories evaluated with PASS output*<br>• `tests/acceptance/wp12-acceptance.test.js` | **Done+tested** |
| **WP13** | Fact Integrity & Master Schema Migration | • `src/services/sql.js` (`ensureDatabaseSchema`)<br>• `database/migrations/003_master_schema_migration.sql`<br>• `src/services/extracted-facts-validator.js` | • `tests/fact-integrity-schema.test.js`<br>• `tests/phase4-4-conflict-detection.test.js` (`needsReview-on-missing-fields`) | **Done+tested** |
| **WP14** | Read-Only Blob SAS URL Generation | • `src/services/blob-storage.js` (`generateBlobSasUrl`, `uploadBufferToBlob`) | • `tests/wp14-blob-sas.test.js`<br>  - *1. 72h SAS generation*<br>  - *2. Read-only permissions* | **Done+UNVERIFIED**<br>*(Live Azure Storage UNVERIFIED)* |
| **WP15** | Durable Queue Decoupling & Poison Guard | • `src/services/durable-queue.js` (`DurableQueue`, `enqueueIngestionJob`)<br>• `src/functions/processDocumentQueue.js` (`app.storageQueue`) | • `tests/wp15-durable-queue.test.js`<br>• `tests/wp2-wiring.test.js` (`app.storageQueue`, poison cap 5) | **Done+UNVERIFIED**<br>*(Live Storage Queue UNVERIFIED)* |
| **WP16** | Conflict Lifecycle, Reminders & Outbox Retry | • `src/services/conflict-notifier.js` (`reissueDecisionToken`, `processConflictReminders`, `checkMaxHoldAlerts`, `processNotificationOutbox`) | • `tests/wp16-conflict-lifecycle.test.js`<br>  - *2. Reissue count & expiry*<br>  - *3. Escalated + admin link*<br>  - *4. 24h/48h reminders*<br>  - *5. Max hold alert*<br>  - *6. Outbox PendingRetry cap 5*<br>  - *7. Hold never released* | **Done+tested** |
| **WP17** | Chat Governance Statuses & Hold Enforcement | • `src/functions/chat.js` (`governanceStatus`: `NO_APPROVED_EVIDENCE`, `OUT_OF_SCOPE_QUESTION`, `NEEDS_CLARIFICATION`, `DOCUMENT_BEING_PREPARED`) | • `tests/wp17-chat-governance.test.js`<br>• `tests/wp10-wp17-chat-hold-leak-guard.test.js`<br>• `tests/wp-batch4-package7.test.js` | **Done+tested** |
| **WP18** | Observability, Telemetry & Audit Logs | • `src/services/observability.js` (`getSystemGovernanceMetrics`, `getAuditTrail`)<br>• `src/functions/getIngestionStatus.js` | • `tests/wp18-observability.test.js`<br>  - *1. Governance metrics*<br>  - *2. Audit trail exporter* | **Done+tested** |
| **WP19** | Final Gate Verification & Runbook Sign-off | • `MANUAL_RUNBOOK.md`<br>• `BACKLOG.md`<br>• `KNOWN_LIMITATIONS.md`<br>• `tests/acceptance/run-acceptance.js` | • `npm run test:unit` (357/357 PASS, 0 failures)<br>• `node tests/acceptance/run-acceptance.js` (13/13 PASS) | **Done+tested** |

---

## 2. Invariable Operating Rules (A.1 – A.8)

| Rule ID | Rule Name | Core Invariant | Key Implementation & Test | Status |
| :--- | :--- | :--- | :--- | :---: |
| **A.1** | Human Authority | Conflicts are ALWAYS decided by human authority. Never auto-resolved by rank, recency, or value. | `conflict-resolver.js`, `confirmConflict.js`<br>Verified by `tests/phase4-4-conflict-detection.test.js` | **Done+tested** |
| **A.2** | Uploader Decision | Conflict notification sent to document uploader with file-level choices (keep existing / accept incoming). | `conflict-notifier.js`, `confirmConflict.js`<br>Verified by `tests/wp7-conflict-notifier.test.js` | **Done+tested** |
| **A.3** | Soft Delete | Delete = soft-delete. Remove from answers and Search index; preserve SQL rows for audit; never delete files. | `reconciler.js`, `sql.js`<br>Verified by `tests/wp9-reconciler.test.js` | **Done+tested** |
| **A.4** | Zero Data Leaks | Only Approved facts reach chat answers, calculations, or search indexes. Pending/Held/Rejected must never leak. | `chat.js`, `azure-search.js`, `sql.js`<br>Verified by `tests/wp4-search-allowlist.test.js` | **Done+tested** |
| **A.5** | Deterministic Arithmetic | Numbers come from SQL facts and code arithmetic via arbitrary-precision decimal library; never from LLM. | `decimal.js`, `calculation-engine.js`<br>Verified by `tests/wp3-effective-facts-math.test.js` | **Done+tested** |
| **A.6** | Strict Scope | PDF and Excel (.xlsx, .xls) IFRS and HR reports only. Macros, encrypted, and external links rejected upfront. | `validation.js`, `ingestDocument.js`<br>Verified by `tests/wp-batch4-package7.test.js` | **Done+tested** |
| **A.7** | Phase 2 Boundary | Auth, document-level authorization, and authority verification deferred to Phase 2 with `ENFORCE_AUTH=false`. | `config.js`, `KNOWN_LIMITATIONS.md`<br>Verified by `tests/phase2-guardrails.test.js` | **Done+tested** |
| **A.8** | Conflict Hold | While conflict is open, NO answers given about either conflicted file. Returns 409 `CONFLICT_PENDING`. | `chat.js`, `sql.js`<br>Verified by `tests/wp10-wp17-chat-hold-leak-guard.test.js` | **Done+tested** |

---

## 3. Architectural Decisions (D1 – D8)

| Decision ID | Description | Key Implementation & Test | Status |
| :--- | :--- | :--- | :---: |
| **D1** | HTTP Uploader Email: extracted from `x-user-email` header; validated against `ALLOWED_UPLOADER_EMAIL_DOMAINS` config; falls back to `FINCHAT_ADMIN_EMAIL`. | `ingestDocument.js`, `conflict-notifier.js`<br>Verified by `tests/wp7-conflict-notifier.test.js` | **Done+tested** |
| **D2** | File-Level Decisions: "Keep incoming" supersedes all facts of the existing file. Figures lost disclosed before decision. Documented in `KNOWN_LIMITATIONS.md`. | `confirmConflict.js`, `sql.js`<br>Verified by `tests/wp8-decision-tokens.test.js` | **Done+tested** |
| **D3** | Email Channel: Microsoft Graph `sendMail` from shared mailbox (`CONFLICT_MAILBOX_SENDER`). | `conflict-notifier.js`<br>Verified by `tests/wp7-conflict-notifier.test.js` | **Done+UNVERIFIED**<br>*(Graph access policy UNVERIFIED)* |
| **D4** | Conflict Tolerance: Absolute difference $\le 0.001$ OR percentage difference $\le 0.01\%$. Single configuration constants. | `conflict-resolver.js`<br>Verified by `tests/wp6-conflict-engine.test.js` | **Done+tested** |
| **D5** | PartiallyApproved Narrative Hold: Chat answers only approved SQL facts; narrative RAG chunks of `PartiallyApproved` documents are NOT searchable. | `chat.js`, `azure-search.js`<br>Verified by `tests/wp4-search-allowlist.test.js` | **Done+tested** |
| **D6** | Multilingual Embeddings: Standardize on `text-embedding-3-small` (1536 dims) across code, docs, schemas, and tests. | `embeddings.js`, `azure-search.js`<br>Verified by `tests/model-client.test.js` | **Done+tested** |
| **D7** | Search Allow-List Exclusion: Chat queries SQL for allowed document IDs (`IngestionStatus = 'Succeeded' AND IndexingStatus = 'Indexed' AND ConflictHold = 0`) and applies `$filter = search.in(documentId, '...')`. | `chat.js`, `azure-search.js`, `sql.js`<br>Verified by `tests/wp4-search-allowlist.test.js` | **Done+tested** |
| **D8** | Pure Environment-Driven Model Deployments: Model deployment names come exclusively from environment variables (`AZURE_OPENAI_FAST_DEPLOYMENT`, `AZURE_OPENAI_STRONG_DEPLOYMENT`). Zero third-party LLMs. | `model-client.js`<br>Verified by `tests/model-client.test.js` | **Done+tested** |

---

## 4. Unverified Real-World Cloud Dependencies (Live Tenant Verification Items)

1. **Azure SQL `sp_getapplock` Multi-Pod Concurrency**: Concurrency serialization is verified in local and mock suites; physical Azure SQL locking contention under multiple concurrent Functions instances requires live Azure SQL Database execution.
2. **Real Database SQL View Execution**: `dbo.vw_FinancialFacts_Complete` view is defined and verified in sql.js schema; physical execution plans and index hints require verification on live Azure SQL.
3. **Azure AI Foundry / OpenAI Live Quota & Rate Limits**: Environment-driven routing is verified; live rate limits and TPM token throttling require verification on Azure OpenAI live resources.
4. **Arabic RTL PDF Multi-Column Reading Order**: Character and numeral normalizations are tested; complex visual multi-column reading order depends on Azure Document Intelligence layout extraction in live tenant.
5. **Microsoft Graph Application Access Policy**: Graph API queries are implemented; tenant-wide access restriction via Exchange/SharePoint application access policy requires tenant admin PowerShell configuration.
6. **Cross-Language Semantic Hybrid Retrieval Quality**: Mathematically supported via 1536-dim embeddings; end-to-end bilingual hybrid search relevance tuning requires live Azure AI Search index evaluation.
