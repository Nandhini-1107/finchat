# FinChat React Frontend

A modern, enterprise-grade React frontend for the Finora AI / FinChat platform, connecting to existing Azure Functions endpoints.

## 🚀 Features

- **💬 Conversational Chat**:
  - Connects to `POST /api/chat`
  - Preserves backend answers and renders markdown (headings, bold, lists, tables, code)
  - Displays Verified Facts (`factsUsed`), Authority Rankings, and Conflict badges
  - Displays Deterministic Calculations (`calculations`) and Source Citations (`sources`)
  - Target Document ID filter support
  - Suggested financial prompt chips
- **📤 Document Ingestion**:
  - Connects to `POST /api/ingestDocument`
  - Drag-and-drop or browse PDF, Excel (.xlsx/.xls), CSV, Text (.txt, .md)
  - Authority Rank configuration (Rank 1 Audited to Rank 4 Sample/Test)
  - Document classification types (ManualUpload, AuditedFinancials, ManagementPack, etc.)
  - Asynchronous pipeline with automatic status polling and real-time progress
  - Synchronous mode support (`?async=false`)
- **📊 Ingestion Status & Managed Documents**:
  - Connects to `GET /api/getIngestionStatus?documentId=<id>`
  - Real-time status lookup by Document ID
  - Tracks uploaded document history with extracted facts count
  - Instant action to query uploaded documents in chat
- **⚙️ API Settings & Environments**:
  - Switch between Azure Cloud Functions and Localhost (`http://localhost:7071/api`)
  - Test Connection button pinging `GET /api/dbHealth`
  - RBAC User Groups configuration (`x-user-groups` header)

---

## 🛠️ Setup & Local Execution

### 1. Start the Local Backend (Port 7071)
In a terminal, start the Azure Functions backend with CORS enabled:
```bash
cd finchat
func start --cors "*"
```

### 2. Install Frontend Dependencies & Start (Port 3000)
In another terminal:
```bash
cd frontend
npm install
npm run dev
```
The application will launch on [http://localhost:3000](http://localhost:3000).

### 3. Build for Production
```bash
npm run build
```

---

## ⚙️ Environment Configuration

Configuration is managed in `frontend/.env`:

```env
# Local Functions Endpoint (Default):
VITE_API_BASE_URL=http://localhost:7071/api
```

You can also dynamically switch endpoints or test connectivity in the **API & Settings** tab within the UI.

