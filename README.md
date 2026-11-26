# Finora AI (FinChat) — Enterprise Financial & HR RAG Platform

> **Version:** `1.0.0`  
> **Runtime:** Node.js (Azure Functions v4)  
> **Status:** Production-Ready Core Engine

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Project Objectives](#project-objectives)
3. [System Architecture](#system-architecture)
4. [Technology Stack](#technology-stack)
5. [Key Features](#key-features)
6. [Project Structure](#project-structure)
7. [Branching Strategy](#branching-strategy)
8. [Installation and Setup](#installation-and-setup)
9. [Configuration and Environment Variables](#configuration-and-environment-variables)
10. [API Endpoints](#api-endpoints)
11. [Deployment Instructions](#deployment-instructions)
12. [Documentation Maintenance](#documentation-maintenance)
13. [Current Project Version & Changelog](#current-project-version--changelog)

---

## Project Overview

**Finora AI** (internal codename: `finchat`) is an enterprise-grade Retrieval-Augmented Generation (RAG) and structured fact-extraction engine tailored for financial reports and Human Resources documentation. Built on the **Azure Functions v4 Node.js runtime**, the system ingests financial statements, board packs, audit sheets, headcount trackers, and policy records across Microsoft SharePoint and direct file uploads.

Unlike conventional semantic-only RAG systems, Finora AI employs a **Dual-Lane Architecture**:
- **Deterministic SQL Lane:** Automatically extracts, normalizes, and stores structured financial facts in a relational schema (Azure SQL / Microsoft SQL Server) for zero-hallucination calculations, entity breakdowns, and period comparisons.
- **Hybrid Semantic Lane:** Chunks narrative disclosures, management commentary, and footnotes into vector embeddings indexed in **Azure AI Search** for contextual, conceptual, and regulatory queries.

The platform includes authority-based conflict auditing, multi-currency conversion, bilingual English/Arabic numeral parsing, calculation verification, and Microsoft Teams integration via Azure Bot Service.

---

## Project Objectives

1. **Eliminate Financial Hallucination:** Guarantee that numeric answers (revenues, EBITDA, net profits, headcounts, variances) are retrieved directly from verified relational fact records with exact citations.
2. **Automate Document Ingestion:** Provide scheduled ingestion from SharePoint document libraries (`DocumentIngestQueue_new`) using Microsoft Graph API, alongside high-throughput HTTP upload capabilities.
3. **Multi-Source Authority Hierarchy:** Implement a 4-tier source authority rank (Audited Financials > Board Packs > Drafts > Synthetic/Test Data) to govern data precedence without blind data overwrites.
4. **Detect & Stage Conflicts:** Automatically flag conflicting metrics between documents across the same entity and period, staging discrepancies for human governance rather than silently replacing data.
5. **Support Global Enterprise Formats:** Accurately parse PDF and Excel spreadsheets (`.xlsx`, `.xls`, `.xlsm`), normalize Western and Arabic-Indic numerals (`٠-٩`), detect scale factors (thousands, millions, billions), and handle multi-currency accounting.
6. **Seamless Workplace Integration:** Deliver insights directly to enterprise communication channels, specifically Microsoft Teams.

---

## System Architecture

Finora AI decouples ingestion and retrieval into robust asynchronous pipelines:

```
                           +----------------------------------------+
                           |  Ingestion Sources:                     |
                           |  - SharePoint Queue (Scheduled Timer)  |
                           |  - HTTP Upload (/api/ingestDocument)   |
                           +-------------------+--------------------+
                                               |
                                               v
                           +----------------------------------------+
                           |  Document Extraction & Normalization    |
                           |  - Local Extractor / Doc Intelligence  |
                           |  - Content Normalizer (Markdown + Grid)|
                           +-------------------+--------------------+
                                               |
                     +-------------------------+-------------------------+
                     |                                                   |
                     v                                                   v
+------------------------------------------+    +------------------------------------------+
|  Structured Fact Extraction Pipeline     |    |  Semantic Chunking & Embedding Pipeline  |
|  - Unit & Scale Normalizer               |    |  - Token Window Chunking                 |
|  - Currency & Period Resolution          |    |  - Azure OpenAI (text-embedding-3-small) |
|  - Authority Conflict Detection          |    |  - Azure AI Search (Hybrid Vector/BM25)  |
+--------------------+---------------------+    +--------------------+---------------------+
                     |                                                   |
                     v                                                   v
+------------------------------------------+    +------------------------------------------+
|  Relational Storage (Azure SQL / MSSQL)  |    |  Azure AI Search Index                   |
|  - dbo.FinancialFacts                    |    |  - finance-hr-documents                  |
|  - dbo.Documents & dbo.IngestionRuns     |    |  - 1536-dimensional dense vectors        |
|  - dbo.FactConflicts & dbo.FactAudit     |    |  - Document metadata & ACL filters       |
+--------------------+---------------------+    +--------------------+---------------------+
                     |                                                   |
                     +-------------------------+-------------------------+
                                               |
                                               v
                           +----------------------------------------+
                           |  Unified Retrieval & Query Engine      |
                           |  - Intent Classifier & Router          |
                           |  - Direct SQL Execution                |
                           |  - Hybrid Semantic Search Retrieval    |
                           |  - Calculation Engine (Formulas)       |
                           |  - LLM Synthesis (Azure OpenAI / Groq) |
                           |  - Response Validation (Fact Grounding)|
                           +-------------------+--------------------+
                                               |
                     +-------------------------+-------------------------+
                     |                                                   |
                     v                                                   v
+------------------------------------------+    +------------------------------------------+
|  Web API Clients                         |    |  Microsoft Teams Client                  |
|  POST /api/chat                          |    |  POST /api/messages (Azure Bot Service)  |
+------------------------------------------+    +------------------------------------------+
```

---

## Technology Stack

| Layer | Component | Technologies & Packages |
|---|---|---|
| **Serverless Runtime** | Function App Host | **Node.js 20 / 22**, `@azure/functions` (v4 Model) |
| **Relational Database** | Fact & Metadata Store | **Azure SQL Database / Microsoft SQL Server 2022+**, `mssql`, `tedious` |
| **Search & Indexing** | Hybrid Vector Search | **Azure AI Search** (`@azure/search-documents`), dense vector + BM25 keyword search |
| **AI & Embeddings** | Language Models | **Azure OpenAI** (`text-embedding-3-small`, `gpt-4o`), **Groq** (`qwen/qwen3.8-27b`), `openai` SDK |
| **Document Processing** | Extraction & Parsing | `xlsx` (SheetJS), `pdfjs-dist`, `pdf-parse`, Azure AI Document Intelligence |
| **Enterprise Services** | Microsoft Graph & Teams | `@microsoft/microsoft-graph-client`, `botbuilder` (v4.23.3), `@azure/identity` |
| **Testing & Quality** | Test Framework | Node.js Native Test Runner (`node:test`, `node:assert`) |

---

## Key Features

### 1. Dual-Lane Retrieval Engine
- **Direct SQL Lane:** Queries structured metrics (`Revenue`, `EBITDA`, `Operating Expenses`, `Headcount`) directly against `dbo.FinancialFacts` using canonical entity, metric, and period aliases.
- **Semantic Vector Lane:** Leverages 1536-dimensional hybrid search in Azure AI Search to retrieve unstructured policies, footnote caveats, and management analyses.
- **Calculation Engine:** Executes accurate mathematical calculations (sums, growth rates, ratios, variances) using verified numbers without relying on LLM arithmetic.

### 2. Multi-Tier Source Authority
All ingested files and facts are tagged with an Authority Rank:
- **Rank 1 — Audited Financials:** Statutory filings, auditor reports (highest authority).
- **Rank 2 — Board Packs / Final:** Executive presentations, approved board packs.
- **Rank 3 — Drafts / Working Files:** Unaudited ledgers, interim working models.
- **Rank 4 — Sample / Test:** Synthetic records and local testing sets.

### 3. Automated Conflict Detection & Governance
- Evaluates incoming facts against existing records across metric, entity, period, reporting basis, scope, unit, and currency.
- Applies absolute (`0.001`) and percentage (`0.01%`) tolerance filters.
- Staged facts with genuine discrepancies are held in `PendingApproval` status with single-use decision tokens, ensuring that no conflicting fact automatically overwrites approved data.

### 4. Bilingual & Multi-Currency Processing
- Translates Arabic-Indic numerals (`٠١٢٣٤٥٦٧٨٩`) to standard ASCII numerals.
- Identifies and normalizes ISO currencies: `USD`, `EUR`, `GBP`, `INR`, `SAR`, `AED`, `EGP`, `KWD`, `BHD`, `OMR`.
- Parses scaled financial shorthand: `18.5M`, `2.4B`, `500k`, and negative accounting formats `(1,234)`.

### 5. Automated SharePoint Integration
- A timer-triggered background worker (`processDocumentQueue`) polls SharePoint lists, downloads queued files via Microsoft Graph, processes them through the 10-step pipeline, and writes completion status back to SharePoint.

### 6. Microsoft Teams Bot Connectivity
- Built using `botbuilder` (`CloudAdapter`) conforming to Azure Functions v4.
- Validates Bot Framework JWT authentication, processes conversational mentions, forwards queries to the core `/api/chat` engine, and delivers answers back into Teams chats and channels.

---

## Project Structure

```text
finchat/
├── .github/
│   └── workflows/              # GitHub Actions CI/CD deployment pipelines
├── database/
│   └── schema.sql              # Master DDL schema (14 relational tables + views)
├── frontend/                   # React management and upload interface
│   └── .env                    # Frontend environment configuration
├── scripts/
│   ├── run-migrations.js       # SQL database migration runner
│   └── update-search-index.js  # Azure AI Search index schema creator/updater
├── src/
│   ├── functions/              # Azure Functions v4 Endpoint Triggers
│   │   ├── chat.js             # POST /api/chat (Retrieval and synthesis)
│   │   ├── dbHealth.js         # GET /api/dbHealth (Database health check)
│   │   ├── getIngestionStatus.js # GET /api/getIngestionStatus (Processing status)
│   │   ├── ingestDocument.js   # POST /api/ingestDocument (HTTP upload endpoint)
│   │   ├── messages.js         # POST /api/messages (Teams Bot Framework endpoint)
│   │   └── processDocumentQueue.js # Timer Trigger: Scheduled SharePoint processor
│   ├── services/               # Core Enterprise Business Logic
│   │   ├── answer-generation.js    # LLM prompt synthesis & formatting
│   │   ├── azure-search.js         # Azure AI Search chunk indexing & querying
│   │   ├── calculation-engine.js   # Deterministic financial math calculations
│   │   ├── chunking.js             # Document text splitting & windowing
│   │   ├── conflict-resolver.js    # Multi-fact conflict detection & staging
│   │   ├── content-normalizer.js   # Extractor output normalization
│   │   ├── document-intelligence.js # Azure Form Recognizer / Doc Intel integration
│   │   ├── embeddings.js           # Azure OpenAI vector generation
│   │   ├── evidence-validation.js  # Grounding & hallucination check service
│   │   ├── fact-extraction.js      # Structured financial table & text extraction
│   │   ├── ingestion-pipeline.js   # 10-step master ingestion orchestrator
│   │   ├── intent-classifier.js    # Query classification & router
│   │   ├── local-extractor.js      # Local PDF and Excel stream parser
│   │   ├── model-client.js         # Unified client for Azure OpenAI & Groq
│   │   ├── query-preprocessor.js   # Entity, metric, and period extraction
│   │   ├── response-validator.js   # Fact grounding check before answer output
│   │   ├── retrieval-pipeline.js   # 11-stage retrieval coordinator
│   │   ├── search-document.js      # Search document schema builder
│   │   ├── search-index.js         # Index definition management
│   │   ├── sharepoint-queue.js     # Microsoft Graph SharePoint queue driver
│   │   ├── sql.js                  # Database connection pool & data access layer
│   │   └── unit-normalizer.js      # Currency, scale, and numeral normalizer
│   └── utils/
│       ├── config.js           # Centralized environment variable loader
│       ├── errors.js           # Structured application error types
│       └── validation.js       # Input buffer & parameter schema validators
├── tests/                      # Automated Test Suite
│   ├── chat-retrieval.test.js      # Retrieval query tests
│   ├── chunking.test.js            # Text chunking unit tests
│   ├── messages-endpoint.test.js   # Bot messages endpoint unit tests
│   ├── retrieval-pipeline.test.js  # End-to-end retrieval validation tests
│   └── search-document.test.js     # Search document construction tests
├── host.json                   # Azure Functions host configuration
├── local.settings.json         # Local Azure Functions runtime settings
├── package.json                # Project dependencies and script definitions
└── README.md                   # System documentation
```

---

## Branching Strategy

The repository follows a structured Git branching strategy to ensure code quality, isolated testing, and traceability:

```text
main (Production Releases)
  ^
  |  (Pull Request with full test validation)
dev (Active Development Integration)
  ^
  |-- feat/ingestion-chat-workflow-enhancements
  |-- feat/conflict-detection
  |-- feat/conflict-handling
  |-- feat/financial-fact-extraction
  |-- azure-bot-integration
  |-- data/golden-financial-facts
  |-- fix/<bug-description>
```

### 1. `main` Branch
- **Role:** Represents production-ready, stable code.
- **Rules:** Protected branch. Direct pushes are disabled. Code enters `main` only via approved Pull Requests merged from `dev` with all automated verification tests passing.

### 2. `dev` Branch
- **Role:** Main integration branch where feature developments converge.
- **Rules:** Feature branches are rebased or merged into `dev` after local verification. Integration tests run against `dev`.

### 3. Feature Branches (`feat/*`, `fix/*`, `data/*`)
- **Naming Conventions:**
  - `feat/<feature-name>`: Implementation of new functional capabilities (e.g., `feat/conflict-detection`, `feat/chat-financial-engine`).
  - `fix/<bug-name>`: Bug fixes or security vulnerability patches.
  - `data/<dataset-name>`: Benchmark datasets and evaluation suites (e.g., `data/golden-financial-facts`).
  - Integration branches: Dedicated integration branches for specific capabilities (e.g., `azure-bot-integration`, `sharepoint-imporvments`).
- **Lifecycle:** Branch off `dev`, implement isolated changes, pass unit tests, and create a Pull Request back to `dev`.

---

## Installation and Setup

### Prerequisites
- **Node.js:** `v20.x` or `v22.x` (LTS recommended)
- **Azure Functions Core Tools:** `v4.x` (`npm install -g azure-functions-core-tools@4 --unsafe-perm true`)
- **Database:** Microsoft SQL Server 2022 / SQL Server Express (locally) or an Azure SQL Database instance.
- **Git**

### Step 1: Clone Repository & Install Dependencies
```powershell
# Clone the repository
git clone <repository-url>
cd finchat

# Install dependencies
npm install
```

### Step 2: Configure Environment Settings
Create a `local.settings.json` file in the root directory (or use `.env`):
```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "DOCUMENT_QUEUE_CRON": "0 */5 * * * *",

    "AZURE_SQL_SERVER": "localhost",
    "AZURE_SQL_DATABASE": "financial-chatbot",
    "AZURE_SQL_PORT": "1433",
    "AZURE_SQL_USER": "sa",
    "AZURE_SQL_PASSWORD": "YourStrongPassword123!",
    "AZURE_SQL_ENCRYPT": "false",

    "AZURE_SEARCH_ENDPOINT": "https://<your-search-service>.search.windows.net",
    "AZURE_SEARCH_API_KEY": "<your-search-api-key>",
    "AZURE_SEARCH_ADMIN_KEY": "<your-search-admin-key>",
    "AZURE_SEARCH_INDEX": "finance-hr-documents",

    "AZURE_OPENAI_ENDPOINT": "https://<your-openai-resource>.openai.azure.com/openai/v1",
    "AZURE_OPENAI_API_KEY": "<your-openai-api-key>",
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT": "text-embedding-3-small",
    "AZURE_OPENAI_CHAT_DEPLOYMENT": "gpt-4o",

    "GROQ_API_KEY": "<optional-groq-fallback-key>",
    "GROQ_MODEL": "qwen/qwen3.8-27b",
    "GROQ_BASE_URL": "https://api.groq.com/openai/v1",

    "FINORA_CHAT_URL": "http://localhost:7071/api/chat",
    "MicrosoftAppId": "",
    "MicrosoftAppPassword": "",
    "MicrosoftAppType": "MultiTenant",
    "MicrosoftAppTenantId": ""
  }
}
```

### Step 3: Initialize Database Schema
The database engine automatically verifies and self-heals table definitions upon connection. To run or inspect migrations manually:
```powershell
node scripts/run-migrations.js
```

### Step 4: Run the Application Locally
```powershell
# Start Azure Functions Host
npm start
# or: func start
```
The local runtime will initialize and expose endpoints on `http://localhost:7071`.

### Step 5: Run Automated Tests
```powershell
# Run file syntax checks across all JS sources
npm test

# Run unit test suite
npm run test:unit
```

---

## Configuration and Environment Variables

| Variable Name | Required | Default | Description |
|---|---|---|---|
| `FUNCTIONS_WORKER_RUNTIME` | Yes | `node` | Azure Functions language worker runtime |
| `DOCUMENT_QUEUE_CRON` | Yes | `0 */5 * * * *` | Cron schedule expression for the SharePoint queue processor |
| `AZURE_SQL_SERVER` | Yes | — | SQL Server hostname (`localhost` or `*.database.windows.net`) |
| `AZURE_SQL_DATABASE` | Yes | — | Database name (e.g. `financial-chatbot`) |
| `AZURE_SQL_PORT` | No | `1433` | SQL port (set specifically if using SQL Server dynamic port) |
| `AZURE_SQL_USER` | Yes | — | Database authentication username |
| `AZURE_SQL_PASSWORD` | Yes | — | Database authentication password |
| `AZURE_SQL_ENCRYPT` | Yes | `true` | Set `false` for local SQL Server without TLS certificates |
| `AZURE_SEARCH_ENDPOINT` | Yes | — | Azure AI Search service URL |
| `AZURE_SEARCH_API_KEY` | Yes | — | Azure AI Search query / admin key |
| `AZURE_SEARCH_INDEX` | No | `finance-hr-documents` | Name of the hybrid vector index |
| `AZURE_OPENAI_ENDPOINT` | Yes | — | Azure OpenAI base endpoint |
| `AZURE_OPENAI_API_KEY` | Yes | — | Azure OpenAI API key |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Yes | `text-embedding-3-small` | Name of the embedding deployment model |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | No | `gpt-4o` | Primary chat completion model |
| `GROQ_API_KEY` | No | — | Groq API key (used if Azure OpenAI chat deployment is omitted) |
| `GROQ_MODEL` | No | `qwen/qwen3.8-27b` | Model identifier for Groq LLM fallback |
| `TENANT_ID` | Yes* | — | Microsoft Entra Tenant ID (*required for SharePoint sync) |
| `CLIENT_ID` | Yes* | — | App Registration Client ID (*required for SharePoint sync) |
| `CLIENT_SECRET` | Yes* | — | App Registration Secret (*required for SharePoint sync) |
| `SHAREPOINT_SITE_URL` | Yes* | — | Root SharePoint site URL |
| `SHAREPOINT_QUEUE_LIST` | Yes* | `DocumentIngestQueue_new` | Name of the SharePoint ingestion queue list |
| `FINORA_CHAT_URL` | No | `http://localhost:7071/api/chat` | Target URL used by the Teams bot to invoke the chat endpoint |
| `MicrosoftAppId` | No | — | Bot Client ID for Azure Bot Service integration |
| `MicrosoftAppPassword` | No | — | Bot Client Secret for Azure Bot Service integration |
| `MicrosoftAppType` | No | `MultiTenant` | Bot registration type (`MultiTenant` or `SingleTenant`) |
| `MicrosoftAppTenantId` | No | — | Microsoft Entra Tenant ID (required if `SingleTenant`) |
| `MAX_UPLOAD_SIZE_MB` | No | `10` | Maximum file upload size in megabytes |
| `CHUNK_SIZE` | No | `1000` | Target token/character window per search chunk |
| `CHUNK_OVERLAP` | No | `200` | Overlap between consecutive search chunks |

---

## API Endpoints

### 1. `POST /api/chat`
The primary conversational answering endpoint. Accepts user questions, executes intent routing, accesses SQL facts and AI Search vector chunks, and returns a verified answer.

- **Request Body:**
  ```json
  {
    "question": "What was the total revenue for Contoso Logistics in Q1 2026?",
    "documentId": 7,
    "conversationHistory": []
  }
  ```
- **Response Body (`200 OK`):**
  ```json
  {
    "status": "success",
    "routeUsed": "DIRECT_SQL",
    "intentType": "SINGLE_PERIOD_FACT",
    "entitiesDetected": ["Contoso Logistics"],
    "periodsDetected": ["Q1 2026"],
    "metricsDetected": ["revenue"],
    "answer": "The total revenue for Contoso Logistics in Q1 2026 was **8,720,000 AED**.",
    "grounded": true,
    "sources": [
      {
        "fileName": "03_Contoso_Logistics_Income_Statement_Q1_2026_Audited.pdf",
        "authorityRank": 1,
        "sourceLocation": "Sheet: Income Statement; Row 3"
      }
    ],
    "hasUnresolvedConflict": false,
    "insufficientEvidence": false,
    "correlationId": "chat-1732085400000-abc12"
  }
  ```

---

### 2. `POST /api/ingestDocument`
Manual file ingestion endpoint supporting binary uploads (`application/pdf`, `.xlsx`, `.xls`), raw text, and `multipart/form-data`.

- **Headers / Query Parameters:**
  - `fileName`: Name of the document (e.g. `FY2026_Q1_Financials.pdf`).
  - `authorityRank`: Integer rank (`1` = Audited, `2` = Board, `3` = Draft, `4` = Sample).
  - `allowedUserGroups`: Comma-separated ACL groups (e.g. `Finance,Executive`).
  - `async`: `true` (default) for background ingestion, `false` for blocking wait.
- **Response Body (`202 Accepted`):**
  ```json
  {
    "status": "Accepted",
    "message": "File received and background ingestion initiated.",
    "documentId": 12,
    "runId": 4,
    "fileName": "FY2026_Q1_Financials.pdf",
    "correlationId": "ingest-1732085400000-xyz89"
  }
  ```

---

### 3. `GET /api/getIngestionStatus`
Retrieves execution status, fact counts, and errors for a specific document.

- **Query Parameters:** `?documentId=12`
- **Response Body (`200 OK`):**
  ```json
  {
    "documentId": 12,
    "fileName": "FY2026_Q1_Financials.pdf",
    "sourceType": "ManualUpload",
    "authorityRank": 1,
    "ingestionStatus": "Succeeded",
    "factsCount": 42,
    "lastProcessedAt": "2026-11-20T10:15:30.000Z",
    "correlationId": "status-1732085500000"
  }
  ```

---

### 4. `GET /api/dbHealth`
Health probe for database connectivity, active database identification, and table presence.

- **Response Body (`200 OK`):**
  ```json
  {
    "status": "healthy",
    "database": "financial-chatbot",
    "connected": true,
    "tablesFound": 14,
    "tables": [
      "Documents", "Entities", "EntityAliases", "FactAudit", 
      "FactConflictRecords", "FactConflicts", "FinancialFacts", 
      "IngestionRuns", "MetricAliases", "Metrics", "Periods", "SourceAuthorityRanks"
    ],
    "timestamp": "2026-11-20T10:20:00.000Z"
  }
  ```

---

### 5. `POST /api/messages`
Bot Framework activity receiver for Microsoft Teams connectivity.

- **Payload:** Bot Framework Activity JSON from Azure Bot Service (`finchat-teams`).
- **Processing:** Validates JWT signature via `CloudAdapter`, extracts question text (stripping bot `@mentions`), calls `/api/chat`, and sends the grounded answer back into the Teams conversation.

---

### 6. `TIMER processDocumentQueue`
- **Trigger:** Schedule defined by `DOCUMENT_QUEUE_CRON` (e.g. every 5 minutes: `0 */5 * * * *`).
- **Functionality:** Queries SharePoint list `DocumentIngestQueue_new` for items where `Status = 'Pending'`, downloads files, triggers ingestion, and updates item status to `Completed` or `Failed`.

---

## Deployment Instructions

### 1. Azure Resource Requirements
Ensure the following Azure resources are provisioned in your subscription:
- **Azure Function App:** Linux or Windows Consumption/Elastic Premium running Node.js 20 or 22.
- **Azure SQL Database:** General Purpose or Serverless tier.
- **Azure AI Search:** Basic or Standard tier with semantic search enabled.
- **Azure OpenAI Service:** Deployments of `text-embedding-3-small` and `gpt-4o`.
- **Azure Bot Service:** Multi-tenant or Single-tenant registration (`finchat-teams`) with Microsoft Teams channel enabled.

### 2. Configure Azure Application Settings
Set the values from [Configuration and Environment Variables](#configuration-and-environment-variables) in the Function App's **Configuration -> Application Settings** panel via the Azure Portal or Azure CLI:

```powershell
az functionapp config appsettings set `
  --name "finchat-functions-dmapdhggdwfhdtet" `
  --resource-group "<your-resource-group>" `
  --settings "AZURE_SQL_SERVER=finchat-dbserver.database.windows.net" `
             "AZURE_SQL_DATABASE=financial-chatbot" `
             "AZURE_SQL_USER=finchat-admin" `
             "AZURE_SQL_PASSWORD=<your-db-password>" `
             "AZURE_SQL_ENCRYPT=true" `
             "AZURE_SEARCH_ENDPOINT=https://finchat-search.search.windows.net" `
             "AZURE_SEARCH_API_KEY=<search-key>" `
             "AZURE_OPENAI_ENDPOINT=https://finchat-foundry.openai.azure.com/openai/v1" `
             "AZURE_OPENAI_API_KEY=<openai-key>"
```

### 3. Deploy via Azure Functions Core Tools
```powershell
# Ensure working directory is finchat root
cd finchat

# Publish function app
func azure functionapp publish finchat-functions-dmapdhggdwfhdtet
```

### 4. Configure Azure Bot Service Messaging Endpoint
1. Open the Azure Bot resource (`finchat-teams`) in Azure Portal.
2. Under **Configuration**, set the **Messaging endpoint**:
   ```text
   https://finchat-functions-dmapdhggdwfhdtet.southindia-01.azurewebsites.net/api/messages
   ```
3. Save changes and verify Teams channel health under the **Channels** tab.

---

## Documentation Maintenance

Project documentation must be maintained and updated periodically across all development branches to ensure consistency with the latest implementation:

- **Continuous Updates:** Update relevant technical documentation whenever new features, enhancements, integrations, or architectural changes are implemented.
- **Atomic Commits:** Ensure documentation changes are committed alongside their corresponding code changes in the respective feature branches.
- **Branch-Specific Accuracy:** Maintain branch-specific technical updates in relevant documentation files without creating conflicting versions across branches.
- **Consolidation on Merge:** Consolidate documentation changes when feature branches are merged into `dev` and subsequently promoted to `main`.
- **Changelog Tracking:** Maintain a changelog to track significant developments, bug fixes, configuration changes, and architectural decisions.
- **Periodic Reviews:** Periodically review the `README.md` and supporting documentation to ensure accuracy, completeness, and clarity.
- **Reality-First Documentation:** Ensure documentation reflects the **actual implemented functionality** rather than unverified or planned features.

---

## Current Project Version & Changelog

### Current Version: `1.0.0` (Production Release)

#### Recent Enhancements & Releases
- **v1.0.0 (Current):**
  - **Microsoft Teams Bot Integration:** Implemented `/api/messages` endpoint utilizing `botbuilder@4.23.3` with `CloudAdapter`, securely bridging Azure Bot Service to `/api/chat`.
  - **Dual-Lane Retrieval Engine:** Consolidated deterministic SQL fact retrieval (`DIRECT_SQL`) with Azure AI Search hybrid vector search (`HYBRID_FALLBACK`).
  - **Bilingual Intent Classifier:** Natural language routing for English and Arabic financial queries.
  - **Dynamic Relational Fact Schema:** 14-table relational architecture in `dbo` with automated self-healing schema initialization.
  - **Authority Ranking & Conflict Auditing:** 4-tier source authority precedence and automated value conflict staging with decision tokens.
  - **Asynchronous SharePoint Ingestion:** Resilient timer processing for SharePoint queue lists with automated batch tracking and error rollback.
  - **High-Precision Calculations:** Calculation engine for dynamic mathematical operations across extracted facts.
  - **Model Client Flexibility:** Dual LLM support featuring primary Azure OpenAI clients with automatic Groq fallback capabilities.

---

*Finora AI — Empowering Enterprise Financial Decisions with Verified Intelligence.*
