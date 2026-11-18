# Finora AI (FinChat) - Known Limitations & Phase 2 Security Boundaries

This document formalizes known limitations, architectural boundaries, and deferred security controls for Finora AI Phase 1. In accordance with **Operating Rule A.7**, enterprise authentication and authorization controls are explicitly deferred to Phase 2 with `ENFORCE_AUTH=false`.

---

## 1. Authentication & Caller Identity (Deferred to Phase 2)

### 1.1 Anonymous HTTP Triggers
- **Current Behavior (Phase 1)**: All Azure Functions HTTP endpoints (`/api/ingestDocument`, `/api/chat`, `/api/confirmConflict`) run with `authLevel: 'anonymous'`. Function keys or Entra ID Bearer token enforcement at the API gateway layer is not enabled.
- **Phase 2 Target**: Integrate Azure API Management (APIM) or Azure Functions App Service Authentication (Easy Auth) requiring Entra ID JWT Bearer tokens with validated issuer, audience, and signature.

### 1.2 `x-user-email` Header Trust
- **Current Behavior (Phase 1)**: Ingestion caller email is extracted from the `x-user-email` HTTP header (or query string). While domain validation against `ALLOWED_UPLOADER_EMAIL_DOMAINS` is enforced (with fallback to `FINCHAT_ADMIN_EMAIL`), the caller's email identity is not cryptographically bound to an authenticated session token.
- **Phase 2 Target**: Extract verified uploader identity directly from validated Microsoft Entra ID claims (`preferred_username` or `email`).

### 1.3 Conflict Decision Token POST Session Boundary
- **Current Behavior (Phase 1)**: Conflict resolution decisions (`POST /api/confirmConflict`) are authorized solely via a single-use cryptographically signed HMAC-SHA256 token with 72-hour validity. The decision POST does not require an active Entra ID user login session.
- **Phase 2 Target**: Enforce dual verification: caller must present the valid decision token AND an active Entra ID session matching the designated recipient or admin security group.

---

## 2. Authorization & Access Control (Deferred to Phase 2)

### 2.1 Document-Level ACL Enforcement & Client-Supplied `x-user-groups`
- **Current Behavior (Phase 1)**: Document security metadata (`AllowedUserGroups`) is ingested from SharePoint and HTTP headers and persisted in `dbo.Documents`. In `chat.js`, caller group membership is checked against `targetDoc.AllowedUserGroups` using the caller-supplied `x-user-groups` HTTP header or body property. In Phase 1, `x-user-groups` is client-supplied and untrusted; callers can provide arbitrary group values without cryptographic validation. Furthermore, broad search and SQL views do not enforce group membership filtering (`ENFORCE_AUTH=false`).
- **Phase 2 Target**: Query-time security trimming: evaluate caller's verified group memberships derived exclusively from validated Microsoft Entra ID directory claims against `dbo.Documents.AllowedUserGroups` in both Azure SQL views and Azure AI Search filter expressions.

### 2.2 SharePoint Item-Level Permission Sync
- **Current Behavior (Phase 1)**: Ingestion captures `AllowedUserGroups` list column values if specified. Fine-grained SharePoint item permissions (role assignments, unique permissions, group memberships) are not synchronized.
- **Phase 2 Target**: Ingest and synchronize full SharePoint access control lists (ACLs) using Microsoft Graph permissions API.

---

## 3. Data Lifecycle & Fact Governance Limitations

### 3.1 File-Level Decisions (Decision D2)
- **Current Behavior (Phase 1 & D2)**: When a reviewer chooses "Keep Incoming" on a conflicting document, the incoming document is approved and the existing document is superseded at the file level (`IngestionStatus = 'Superseded'`). All facts belonging to the existing document are marked `Superseded`, even if only a subset of facts had conflicting values.
- **Impact & Disclosure**: Any non-conflicting facts in the older document are no longer active if they were not repeated in the incoming file. The conflict email and review page explicitly disclose figures that will be lost before the reviewer confirms "Keep Incoming".
- **Phase 2 Consideration**: Optional sub-document or line-item level fact reconciliation where non-conflicting facts can be selectively retained across document versions.

### 3.2 In-Memory & Single-Turn Chat Context
- **Current Behavior (Phase 1)**: Each chat turn is independent with zero multi-turn conversational context retention. Conflict hold checks and allow-list leak checks execute fresh per request.
- **Phase 2 Consideration**: Conversational session state with audit tracking.

---

## 4. Environment & Deployment Configuration
- Guarded by `process.env.ENFORCE_AUTH`:
  - When `ENFORCE_AUTH=false` (Phase 1 default): Access control checks are bypassed to prevent false authorization guarantees.
  - When `ENFORCE_AUTH=true` (Phase 2): Stricter identity, group claim validation, and ACL filters become mandatory.
- Master Acceptance Suite explicitly records:
  `"unauthorized access: Deferred to Phase 2"` (Category 13).

---

## 5. Unverified Real-World Cloud Behaviors (Targeted for Live Tenant Verification)

The following items are structurally implemented and unit-tested via high-fidelity mocks, but remain **UNVERIFIED** on real-world cloud tenant infrastructure:
1. **Azure SQL `sp_getapplock` Multi-Pod Concurrency**: Concurrency serialization is implemented via `acquireFactAppLock()`, but physical locking contention under dozens of simultaneous Azure Functions instances has not been verified against a live Azure SQL Database.
2. **Real Database SQL View Execution**: `dbo.vw_FinancialFacts_Complete` and `dbo.vw_EffectiveFinancialFacts` views execute in sql.js mock environments, but physical query execution plans and index utilization require verification on Azure SQL.
3. **Azure AI Foundry / OpenAI Live Quota & Rate Limits**: Dual-tier deployment routing (`AZURE_OPENAI_FAST_DEPLOYMENT` / `AZURE_OPENAI_STRONG_DEPLOYMENT`) is enforced in code, but live HTTP 429 throttling curves depend on Azure subscription TPB (tokens per minute) allocations.
4. **Arabic RTL PDF Multi-Column Reading Order**: Arabic normalization handles Unicode characters and digits, but right-to-left visual reading order in complex multi-column annual report PDF layouts depends on Azure AI Document Intelligence layout analysis in live tenant.
5. **Microsoft Graph Application Access Policy**: Graph API scanner queries are implemented, but tenant-level scoping via `New-ApplicationAccessPolicy` in Exchange/SharePoint PowerShell requires tenant administrator configuration.
6. **Cross-Language Semantic Hybrid Retrieval Quality**: Vector queries across Arabic documents with English questions are supported mathematically via 1536-dim embeddings, but cross-lingual recall/precision requires production tuning.
