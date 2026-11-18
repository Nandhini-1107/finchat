# Finora AI (FinChat) – Operational Manual Runbook

This runbook provides complete operational procedures, disaster recovery protocols, administrator workflows, and an exhaustive query-by-query leak audit for the Finora AI financial fact ingestion and reporting engine.

---

## 1. System Architecture & Component Overview

Finora AI is a sovereign financial fact extraction, conflict resolution, and conversational reporting platform built on Azure Functions (Node.js 24), Azure SQL Database, and Azure AI Search.

### Key Governance Invariants
1. **Zero Silent Approvals**: Unresolved conflicting facts and held documents are never returned to users or included in reporting views.
2. **Strict Currency Isolation**: Currencies are never implicitly converted; currency mismatches throw explicit errors.
3. **Decoupled Asynchronous Processing**: HTTP 202 acceptance decouples client uploads from queue workers; zero detached in-process background promises.
4. **Single-Use Decision Tokens**: Replay protection via SHA-256 token hashing and immediate invalidation.
5. **SQL Search Allow-List (`search.in`)**: Azure AI Search enforces SQL allow-list filtering; negative block-lists are strictly prohibited.

---

## 2. Environment Configuration Checklist

| Environment Variable | Required | Description / Default |
| :--- | :---: | :--- |
| `AZURE_OPENAI_ENDPOINT` | Yes | Azure OpenAI Service endpoint |
| `AZURE_OPENAI_API_KEY` | Yes | Azure OpenAI API key or Managed Identity |
| `AZURE_OPENAI_FAST_DEPLOYMENT` | Yes | Fast tier deployment name (`gpt-4o-mini`) |
| `AZURE_OPENAI_STRONG_DEPLOYMENT` | Yes | Strong tier deployment name (`gpt-4o`) |
| `AZURE_EMBEDDING_DEPLOYMENT` | Yes | Single embedding model (`text-embedding-3-small`) |
| `AZURE_SEARCH_ENDPOINT` | Yes | Azure AI Search endpoint URL |
| `AZURE_SEARCH_ADMIN_KEY` | Yes | Azure AI Search admin/query key |
| `AZURE_SQL_CONNECTION_STRING` | Yes | Connection string for Azure SQL Database |
| `FINCHAT_ADMIN_EMAIL` | Yes | Governance administrator email (`finance-governance@contoso.com`) |
| `FINCHAT_MAX_TOKEN_REISSUES` | No | Max token reissue count before admin escalation (Default: `3`) |
| `CONFLICT_MAX_HOLD_DAYS` | No | Max conflict hold duration before daily governance alert (Default: `14`) |
| `ALLOWED_UPLOADER_EMAIL_DOMAINS` | No | Comma-separated list of permitted uploader email domains |

---

## 3. Operational Workflows & Procedures

### Workflow 1: Admin Conflict Review & Escalation Resolution
When an uploader fails to resolve a conflict after `FINCHAT_MAX_TOKEN_REISSUES` (default 3) attempts, the conflict transitions to `ConflictStatus = 'Escalated'`:
1. Navigate to admin conflict endpoint: `GET /api/admin/conflicts`.
2. Inspect conflicting figures, sources, and discrepancy values.
3. Admin uses the signed escalation decision link:
   - `GET /api/confirmConflict?token=<admin_token>&action=keep_existing` (Retain existing fact)
   - `GET /api/confirmConflict?token=<admin_token>&action=accept_incoming` (Accept incoming fact)
4. Verify audit trail in `dbo.FactAudit` and confirm hold release on associated document.

### Workflow 2: Manual Triggering of Ingestion Reconciler
If a document appears held despite conflicts being resolved:
1. Trigger reconciler via HTTP or execute `runReconciliationScan()`:
   ```bash
   node -e "require('./src/services/reconciler').runReconciliationScan().then(console.log)"
   ```
2. Reconciler automatically:
   - Checks `dbo.FactConflicts` for remaining active conflicts.
   - Clears `ConflictHold` if 0 active conflicts remain.
   - Supersedes documents with 0 approved facts and active superseded facts.
   - Purges search chunks for documents in `PendingDelete` status.

### Workflow 3: Poison Message Quarantine & Recovery
If an ingestion job encounters persistent errors:
1. Message retries up to 5 times via Azure Storage Queue / Durable Queue.
2. Upon 5th dequeue (`dequeueCount >= 5`), the message is quarantined to the poison queue.
3. `dbo.Documents.IngestionStatus` is set to `'Failed'`.
4. Runbook action: Inspect error in `dbo.FactAudit`, remediate malformed document or network dependency, and re-enqueue via `durableQueue.enqueueIngestionJob({ documentId, ... })`.

---

## 4. Query-by-Query Leak Audit (Exhaustive SQL & Search Catalog)

Every SQL query and Azure Search query in the codebase has been audited to guarantee zero unauthorized fact or document leakage:

| Query ID | Component / File | Operation | Target Entity / Index | Governance Filter / Parameterization | Leak Prevention Proof |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Q-SQL-01** | `src/services/sql.js` (`vw_EffectiveFinancialFacts`) | `SELECT` | `dbo.FinancialFacts` | `WHERE MappingStatus = 'Approved' AND ISNULL(ConflictHold, 0) = 0 AND IngestionStatus = 'Succeeded' AND DocumentStatus NOT IN ('Superseded', 'Rejected', 'Held')` | Unapproved, held, pending, superseded, and rejected facts are completely excluded from reporting. |
| **Q-SQL-02** | `src/services/sql.js` (`getSearchAllowList`) | `SELECT` | `dbo.Documents` | `WHERE IngestionStatus = 'Succeeded' AND ISNULL(ConflictHold, 0) = 0 AND DocumentStatus NOT IN ('Superseded', 'Rejected', 'Held', 'PendingApproval', 'PartiallyApproved') AND IndexingStatus != 'NotIndexed'` | Returns strictly Approved, non-held documents. Explicitly excludes PartiallyApproved narrative chunks (Rule D5/D7). |
| **Q-SQL-03** | `src/services/conflict-resolver.js` (`getFactsWithConflictContext`) | `SELECT` | `vw_FinancialFacts_Complete` | `WHERE (DocumentId = @DocumentId OR @DocumentId IS NULL) AND AllowedUserGroups IN (@UserGroups)` | Enforces RBAC group isolation and filters held facts. |
| **Q-SQL-04** | `src/services/conflict-notifier.js` (`reissueDecisionToken`) | `SELECT` & `UPDATE` | `dbo.FactConflicts` | `WHERE ConflictId = @ConflictId` with parameterized BigInt | Parameterized ID lookup; prevents SQL injection and enforces reissue count cap. |
| **Q-SQL-05** | `src/services/conflict-notifier.js` (`checkMaxHoldAlerts`) | `SELECT` | `dbo.FactConflicts` | `WHERE ConflictStatus NOT IN ('Resolved', 'Moot') AND DATEDIFF(day, DetectedAt, SYSUTCDATETIME()) >= @MaxHoldDays` | Parameterized threshold query; generates admin governance alerts without releasing hold. |
| **Q-SEARCH-01** | `src/services/azure-search.js` (`searchSimilar`) | Vector + Hybrid Search | `finance-hr-documents` | `filter: search.in(documentId, '<allowedDocIds>', ',')` | Query is constrained strictly to the SQL allow-list. If allow-list is empty, query returns `[]` immediately without network call. |
| **Q-SEARCH-02** | `src/services/azure-search.js` (`deleteReplacedChunks`) | `DELETE` | `finance-hr-documents` | `filter: documentKey eq '<documentKey>'` | OData escaped string filtering; strictly deletes replaced chunks when document evolves. |

