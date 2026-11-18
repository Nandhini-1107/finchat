# Finora AI (FinChat) – Phase 2 Product & Architecture Backlog

This backlog documents deferred architectural enhancements, enterprise scalability items, and secondary platform capabilities scheduled for Phase 2 implementation.

---

## 1. Deferred Governance & Security Capabilities

| Item ID | Capability | Description | Target Phase | Rationale for Deferral |
| :--- | :--- | :--- | :---: | :--- |
| **SEC-01** | Fine-Grained Graph Application Access Policy | Scoping Microsoft Graph API daemon permissions strictly to designated finance document libraries rather than tenant-wide SharePoint access. | Phase 2 | Tenant administrator approval and custom Entra ID role assignment required. |
| **SEC-02** | Fine-Grained Fact-Level Dynamic Data Masking | Real-time cell-level and column-level masking of sensitive executive compensation facts based on Entra ID user security group attributes. | Phase 2 | Document-level and entity-level RBAC (`AllowedUserGroups`) is currently enforced; fine-grained column masking deferred to Phase 2. |
| **SEC-03** | Hardware Security Module (HSM) Token Signing | Moving cryptographic HMAC decision token signing from Azure Key Vault secret strings to managed Azure Dedicated HSM or Key Vault Premium HSM keys. | Phase 2 | Current SHA-256 HMAC tokens with 72h TTL and single-use database invalidation meet governance criteria. |

---

## 2. Infrastructure & Real-World Cloud Verification

| Item ID | Area | Work Item | Dependency |
| :--- | :--- | :--- | :--- |
| **CLOUD-01** | Concurrency Under Load | Real-world multi-pod concurrency load testing of `sp_getapplock` under high-contention simultaneous fact inserts. | Azure SQL Hyperscale / Business Critical Pool. |
| **CLOUD-02** | Azure AI Search Index Version Migration | Automated blue/green index aliasing and dual-writing during embedding model version migrations. | Azure AI Search dedicated partitions. |
| **CLOUD-03** | Arabic Right-to-Left Layout Reconstruction | Enhanced heuristic reading-order reconstruction for complex multi-column Arabic annual reports with reverse-flow footnotes. | Document Intelligence layout model v4.0 GA. |
| **CLOUD-04** | Cross-Language Vector Query Reranking | Fine-tuned cross-lingual semantic reranker (Arabic $\leftrightarrow$ English) to optimize hybrid search MRR. | Azure AI Search Semantic Ranker bilingual models. |

---

## 3. Operational & Analytics Improvements

- **OPS-01**: Admin UI Dashboard for bulk conflict review, batch token reissuing, and real-time reconciliation telemetry.
- **OPS-02**: PowerBI operational dashboard connected to `dbo.FactAudit` and `dbo.FactConflicts` for finance audit trail reporting.
- **OPS-03**: Automated webhook integrations with Microsoft Teams and Slack for immediate conflict notification dispatch.

