readme_content = """# Industry Management System (IMS) — Management Control System (MCS)

[![FastAPI Backend](https://img.shields.io/badge/Backend-FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](./main.py)
[![React Frontend](https://img.shields.io/badge/Frontend-React%20%28Vite%29-61DAFB?style=for-the-badge&logo=react&logoColor=black)](./App.jsx)
[![GenAI Core](https://img.shields.io/badge/AI%20Engine-Google%20GenAI-4285F4?style=for-the-badge&logo=google-gemini&logoColor=white)](./test_gemini.py)
[![Database](https://img.shields.io/badge/Database-Google%20Sheets%20API-34A853?style=for-the-badge&logo=googlesheets&logoColor=white)](https://sheets.google.com)

An enterprise-grade, distributed software platform engineered to eliminate fragmented communication paper trails and optimize task tracking on industrial manufacturing floors. IMS captures real-time multilingual shift-review transcripts ("Hinglish"/Hindi/English), parses them via advanced Generative AI (Google GenAI SDK v2+), extracts structural action items, and serializes updates down to a highly optimized decentralized data layer.

---

## 📑 Table of Contents
- [Core Architecture & Operational Intent](#-core-architecture--operational-intent)
- [Industrial Accountability Framework](#-industrial-accountability-framework)
- [Technical Stack & Components](#-technical-stack--components)
- [Backend Pipeline Deep-Dive (`main.py`)](#-backend-pipeline-deep-dive-mainpy)
- [Frontend Architecture (`App.jsx`)](#-frontend-architecture-appjsx)
- [Installation & Environment Setup](#-installation--environment-setup)
- [Database Schema & Google Apps Script Setup](#-database-schema--google-apps-script-setup)
- [API Endpoints Reference](#-api-endpoints-reference)

---

## 🏗 Core Architecture & Operational Intent

The system acts as an autonomous data routing engine, transforming real-time spoken audio logs from factory floor shift meetings directly into structured, trackable, and verifiable action rows inside an enterprise accountability database.
```python
# Let's create a highly professional, beautifully formatted README.md file for the Industry Management System (IMS) / Management Control System (MCS).
# We'll save it to the workspace as 'README.md'.

readme_content = """# Industry Management System (IMS) — Management Control System (MCS)

[![FastAPI Backend](https://img.shields.io/badge/Backend-FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](./main.py)
[![React Frontend](https://img.shields.io/badge/Frontend-React%20%28Vite%29-61DAFB?style=for-the-badge&logo=react&logoColor=black)](./App.jsx)
[![GenAI Core](https://img.shields.io/badge/AI%20Engine-Google%20GenAI-4285F4?style=for-the-badge&logo=google-gemini&logoColor=white)](./test_gemini.py)
[![Database](https://img.shields.io/badge/Database-Google%20Sheets%20API-34A853?style=for-the-badge&logo=googlesheets&logoColor=white)](https://sheets.google.com)

An enterprise-grade, distributed software platform engineered to eliminate fragmented communication paper trails and optimize task tracking on industrial manufacturing floors. IMS captures real-time multilingual shift-review transcripts ("Hinglish"/Hindi/English), parses them via advanced Generative AI (Google GenAI SDK v2+), extracts structural action items, and serializes updates down to a highly optimized decentralized data layer.

---

## 📑 Table of Contents
- [Core Architecture & Operational Intent](#-core-architecture--operational-intent)
- [Industrial Accountability Framework](#-industrial-accountability-framework)
- [Technical Stack & Components](#-technical-stack--components)
- [Backend Pipeline Deep-Dive (`main.py`)](#-backend-pipeline-deep-dive-mainpy)
- [Frontend Architecture (`App.jsx`)](#-frontend-architecture-appjsx)
- [Installation & Environment Setup](#-installation--environment-setup)
- [Database Schema & Google Apps Script Setup](#-database-schema--google-apps-script-setup)
- [API Endpoints Reference](#-api-endpoints-reference)

---

## 🏗 Core Architecture & Operational Intent

The system acts as an autonomous data routing engine, transforming real-time spoken audio logs from factory floor shift meetings directly into structured, trackable, and verifiable action rows inside an enterprise accountability database. 


```

```text
README.md file successfully created and saved.


```

```
                                  ┌───────────────────────┐
                                  │   Real-Time Speech    │
                                  │ (Hinglish/Hindi/Mixed)│
                                  └───────────┬───────────┘
                                              │ (Web Speech API)
                                              ▼

```

┌───────────────────────────┐        ┌────────────────────────┐        ┌───────────────────────────┐
│     Google Sheets DB      │◄───────┤   Vite-React Frontend  ├───────►│  FastAPI Analytics Engine │
│   (Low-Cost Data Layer)   │  POST  │      (`App.jsx`)       │  POST  │        (`main.py`)        │
└───────────────────────────┘        └────────────────────────┘        └─────────────┬─────────────┘
│
├─► google-genai SDK
├─► SMTP Notification Relay
└─► wacrm WhatsApp Node

```

### High Availability & Offline Resiliency
Operating inside unpredictable heavy industrial environments, the application is decoupled into an agile web-client and a failover-supported server core. To protect against WAN network dropped connections, the backend architecture features an **automatic tiered LLM fallback model router**:

1. **`gemini-2.0-flash` (Primary):** Utilized for fast structural extraction and native JSON schema processing.
2. **`gemini-2.0-flash-lite` (Secondary):** Lowers execution latency and provides high availability during token bottlenecks.
3. **Local Ollama Node (`llama3`):** Intercepts local traffic natively if the internet connection is broken entirely, avoiding operational disruptions.

---

## 🎖 Industrial Accountability Framework

IMS maps organizational assets directly to strict software constructs to mimic precise industrial line commands:
* **Objects (Machines):** The explicit physical equipment, lines, or floor zones monitored for compliance, breakdowns, or preventative maintenance.
* **Masters (HODs / Head of Departments):** Chair departmental review cycles, monitor active workflows, adjust operational schedules, and manage sector clearances.
* **OMs (Maintenance & Supervisor Teams):** Interface directly with live floor operations, respond to automated system triggers, clear pending line entries, and record notes.
* **Admin (Corporate Executive Management):** Global visibility. Admin accounts retain comprehensive read/write master setup control over notification limits, user registries, and corporate hierarchy logic.

### ⏱ Time-Sensitive Escalation Matrix
Any open operational item initiates a deterministic background tracking daemon. If a task exceeds its assigned due-date, it escalates automatically along the corporate chain of command:

| Escalation Level | Threshold Trigger | Triggered Channels | Action Target |
| :---: | :--- | :--- | :--- |
| **Level 1** | `+ 0 Hours` Past Due | In-App Dashboard Alerts | Line Supervisor Immediate Reminder |
| **Level 2** | `+ 24 Hours` Past Due | In-App + SMTP Automated Email | Department Head (HOD / Master) Review |
| **Level 3** | `+ 72 Hours` Past Due | In-App + SMTP Structural Alert | Factory Site Director / Plant Head Action |
| **Level 4** | `+ 168 Hours` Past Due | In-App + Email + WhatsApp Node | Managing Director (MD / Executive Board) |

---

## 🛠 Technical Stack & Components

### Backend Infrastructure
* **Framework:** FastAPI (Python 3.10+) — Selected for its async performance, native Pydantic validation, and automatic OpenAPI generation.
* **AI SDK:** `google-genai>=0.8.0` — Implements Google’s v2+ developer framework for structured execution profiling.
* **Utilities:** `python-dotenv`, `requests` (for WhatsApp `wacrm` REST triggers), and `smtplib` (for enterprise multi-tier email escalation).

### Frontend Presentation Tier
* **Core:** React 18+ inside a high-speed Vite bundling pipeline.
* **Styling:** Tailwind CSS — Implements clean, desaturated typography, zebra-striped technical tables, and intuitive layout panels.
* **Core APIs:** Browser Web Speech API (`webkitSpeechRecognition`) for local, zero-latency continuous voice streaming.

---

## 🔍 Backend Pipeline Deep-Dive (`main.py`)

The backend microservice handles telemetry transformation and AI ingestion. When text snippets or entire meeting transcript blocks are received, the `google-genai` client utilizes structured prompt instructions to force the model to respond in strict JSON formats.

```python
# main.py core client initialization
from google import genai as google_genai

# Initializes the newly released v2+ unified Google AI Client 
gemini_client = google_genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

```

### JSON Processing Safeguard

The microservice implements structural regex sanitizers (`clean_json_response`) to remove unintended raw LLM markdown outputs (like ````json` tags) before passing payloads back to the web application.

---

## 💻 Frontend Architecture (`App.jsx`)

The frontend layout acts as a single-page reactive dashboard, providing operators with intuitive split panes for action routing.

### Key Architectural Mechanisms

1. **Dynamic Permissions Matrix (`getPerms`)**: Evaluates logged-in identities against a loaded permissions configuration table. Features like project generation, escalation adjustments, or critical deletion pathways are hidden unless explicit clearance matches the user's role.
2. **`useSheetDB` React Synchronization Hook**: Connects the UI to a low-cost, zero-maintenance data layer.
* **Reads:** Fetches tables directly via public CSV links to avoid slow OAuth authorization handshakes.
* **Writes:** Buffers state mutations into structural arrays before dispatching payloads to a custom Google Apps Script endpoint via HTTP POST.


3. **Transient Staging Buffer (`StagingArea`)**: Protects the system from raw AI errors. Extracted items are placed into an intermediate review panel, allowing human operators to review descriptions, change owners, adjust due dates, or dismiss entries before writing to production rows.

---

## 🚀 Installation & Environment Setup

### 1. Prerequisites

Ensure you have the following installed locally on your system:

* Python 3.10 or higher
* Node.js v18 or higher (with `npm` or `yarn`)

### 2. Backend Installation

```bash
# Clone or navigate into the backend module directory
cd mcs-backend

# Initialize and activate virtual environment
python -m venv venv
source venv/bin/activate  # On Windows use: venv\\Scripts\\activate

# Install exact pin requirements
pip install -r requirements.txt

```

Create a `.env` file in the root backend directory:

```env
GEMINI_API_KEY=your_google_gemini_api_key_here
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_escalation_email@gmail.com
SMTP_PASSWORD=your_app_specific_password_here
WACRM_API_URL=https://api.wacrm.example.com/send
WACRM_TOKEN=your_whatsapp_gateway_token_here

```

Start the async server:

```bash
uvicorn main:app --reload --port 8000

```

### 3. Frontend Installation

```bash
# Navigate to the frontend workspace
cd mcs-frontend

# Install node dependencies
npm install

# Create environment configuration file
cp .env.example .env.local

```

Configure your local `.env.local` file:

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_SHEET_ID=1OR4J17WrhQg9rqFV3uIhLCDG9UDCoQ5lc9-8ZXoNSOo
VITE_SHEET_SCRIPT_URL=https://script.google.com/macros/s/.../exec

```

Launch the frontend Vite development server:

```bash
npm run dev

```

---

## 📊 Database Schema & Google Apps Script Setup

To bind the web client to the Google Sheets data engine, create a target workbook with the following worksheets:

* `Actions` (Columns: `id`, `sn`, `plant`, `dept`, `machine`, `action`, `allocatedTo`, `allocatedBy`, `dateOfAction`, `dueDate`, `status`, `revisions`, `revisionHistory`, `messages`, `closedOn`)
* `Users` (Columns: `id`, `username`, `name`, `role`, `plant`, `dept`, `phone`, `email`)
* `Plants` | `Depts` | `Machines` | `Permissions` | `EscMatrix`

### Deployment Code (`Code.gs`)

Create a Google Apps Script linked to your spreadsheet and deploy it as a **Web App with access configured for 'Anyone'**:

```javascript
function doPost(e) {
  var param = JSON.parse(e.postData.contents);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(param.targetSheet);
  
  if (param.action === "INSERT") {
    sheet.appendRow(param.rowData);
    return ContentService.createTextOutput(JSON.stringify({status: "SUCCESS"}));
  }
  
  if (param.action === "UPDATE") {
    // Find row by primary id matching param.id and overwrite cells
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0].toString() === param.id.toString()) {
        var rowNum = i + 1;
        for (var colName in param.updateData) {
          var colIdx = data[0].indexOf(colName) + 1;
          if (colIdx > 0) {
            sheet.getRange(rowNum, colIdx).setValue(param.updateData[colName]);
          }
        }
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({status: "SUCCESS"}));
  }
}

```

---

## ⚡ API Endpoints Reference

### 1. Extract Stream Paragraph Insights

* **Route:** `POST /api/meetings/analyze-paragraph`
* **Payload:**
```json
{ "text": "Line 3 mixing motor overheating. Operator Mohit to replace bearing before Friday shift." }

```


* **Response:** Returns structured compliance blocks containing isolated arrays of `actions`, `decisions`, `risks`, and `keyPoints`.

### 2. Comprehensive Meeting Analysis

* **Route:** `POST /api/meetings/extract-insights`
* **Payload:**
```json
{
  "transcript": "Full text aggregation...",
  "historyContext": "Previous uncompleted tasks context..."
}

```



### 3. Translation Layer

* **Route:** `POST /api/translate`
* **Payload:**
```json
{ "text": "मशीन नंबर 4 का बेल्ट टूट गया है", "source": "hi", "target": "en" }

```


* **Response:**
```json
{ "translated": "Machine number 4 belt is broken", "original": "मशीन नंबर 4 का बेल्ट टूट गया है" }

```



