# NEXUS HR — PHASE 4.3: COMPLETE FRONTEND APPLICATION IMPLEMENTATION

## 1. Executive Summary

Phase 4.3 delivers a fully responsive, enterprise-grade Single Page Application (SPA) for **NEXUS HR — Distributed Human Resource & Attendance Management System**. The application has been designed, built, and verified to run both locally and in preparation for Netlify edge hosting.

The frontend operates on top of a modular, type-safe API adapter layer (`src/services/api.ts`) with realistic stateful mock data, ensuring seamless transition to the live Backend API Gateway and PostgreSQL RPCs without rewriting UI components or user flows.

---

## 2. Technology Stack & Toolchain

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Framework** | React | `^19.0.0` | UI component library with Concurrent Mode |
| **Runtime / DOM** | React DOM | `^19.0.0` | DOM rendering engine |
| **Language** | TypeScript | `~5.7.0` | Strict static type safety & domain modeling |
| **Bundler & Dev Server**| Vite | `^6.0.0` | High-speed ESM bundling and HMR |
| **Styling Engine** | Tailwind CSS | `^4.0.0` | Utility-first responsive styling via `@tailwindcss/vite` |
| **Iconography** | Lucide React | `^1.16.0` | Enterprise iconography |
| **Deployment Target** | Netlify SPA | — | Static CDN with SPA redirect fallbacks |

---

## 3. Architecture & Directory Structure

```
nexus-hr/
├── frontend/
│   ├── public/
│   │   ├── _redirects               # Netlify SPA 200 rewrite rule
│   │   └── favicon.svg              # SVG branding icon
│   ├── src/
│   │   ├── components/
│   │   │   ├── Sidebar.tsx          # Multi-role navigation with live role switcher
│   │   │   └── Topbar.tsx           # Context header, notifications, search & node tag
│   │   ├── context/
│   │   │   ├── AuthContext.tsx      # IAM session state & demo role provider
│   │   │   └── ToastContext.tsx     # Toast notification dispatch provider
│   │   ├── pages/
│   │   │   ├── OverviewPage.tsx     # Executive KPIs, attendance charts & activity feed
│   │   │   ├── EmployeesPage.tsx    # Employee directory, filtering & onboarding modal
│   │   │   ├── DepartmentsPage.tsx  # Organizational hierarchy & position grades
│   │   │   ├── ShiftsPage.tsx       # Shift templates & overnight schedule policies
│   │   │   ├── SchedulesPage.tsx    # Shift assignments, roster calendar & filters
│   │   │   ├── AttendancePage.tsx   # Live attendance logs, clock-in widget & CSV export
│   │   │   ├── LeavesPage.tsx       # Leave applications, reviews & self-approval guard
│   │   │   ├── ReportsPage.tsx      # Workforce analytics, CSV generator & print layout
│   │   │   ├── UserManagementPage.tsx # IAM directory, role grants & security audit banner
│   │   │   ├── SettingsPage.tsx     # Node telemetry, credentials & session reset
│   │   │   └── LoginPage.tsx        # Enterprise authentication & one-click role selector
│   │   ├── services/
│   │   │   ├── api.ts               # Abstracted in-memory stateful data adapter
│   │   │   └── mock-data.ts         # Realistic branch & central employee records
│   │   ├── types/
│   │   │   └── index.ts             # Strict domain TypeScript definitions
│   │   ├── App.tsx                  # Main router & tab navigation coordinator
│   │   ├── main.tsx                 # Root application mount point
│   │   ├── index.css                # Tailwind CSS v4 styling entrypoint
│   │   └── vite-env.d.ts            # Vite client type references
│   ├── package.json                 # Dependency manifests & build scripts
│   ├── tsconfig.json                # Strict TypeScript configuration
│   └── vite.config.ts               # Vite configuration with Tailwind CSS v4 plugin
├── netlify.toml                     # Netlify root build & redirect configuration
└── docs/architecture/phase_4_3/     # Phase 4.3 architecture documentation
```

---

## 4. Key Architectural Highlights

### 4.1 Abstraction of Network Layer (`api.ts`)
The presentation layer communicates exclusively through `api.*` methods. This architecture guarantees:
1. Complete isolation between UI views and backend communication protocols.
2. In-memory state persistence across user interactions (new employees, clock-ins, shift assignments, and approved leaves stay updated during the session).
3. Ready for Phase 4.4 / Phase 5 drop-in replacement by an HTTP client targeting the Node.js API Gateway (`http://localhost:3000/api/v1`).

### 4.2 Security Policy Enforcement at Client Level
The UI reflects and reinforces the PostgreSQL security rules established in Phase 3 and Phase 4.1:
- **Self-Approval Prohibition:** `BRANCH_MANAGER` cannot approve their own leave requests; the review button is disabled with an explanatory banner citing `rpc_branch_decide_leave_request`.
- **HMAC Audit Indicators:** Attendance records and leave approvals feature cryptographic audit badges indicating verification through HMAC SHA-256 signing keys and actor nonces.
- **Node Jurisdiction:** Displays branch node boundaries (`wcmevigbqsmzsdqidjel` for Central and `uneycmbqqpkifwhwzbes` for Branch A).

### 4.3 Netlify Production Readiness
- Built with standard ESM bundles (`dist/index.html`, `dist/assets/`).
- SPA fallback configured simultaneously in `frontend/public/_redirects` and root `netlify.toml` with `/* -> /index.html 200`.
- Zero environment variable dependencies required for core UI rendering.
