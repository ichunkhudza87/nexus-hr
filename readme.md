# NEXUS HR — Distributed Human Resource & Attendance Management System

NEXUS HR is a full-stack, distributed human resource and attendance management system designed around a **two-node horizontally fragmented PostgreSQL 17 architecture** (`nexus-central` and `nexus-branch-a`) and a **Zero-Trust Node.js API Gateway**. It prioritizes local branch autonomy, partition tolerance, cryptographic request verification, and strict data integrity.

## Architecture Overview

```text
+---------------------------+        HTTPS / Central JWT         +----------------------------------+
|     Frontend (React 19)   | ---------------------------------> |  Zero-Trust API Gateway (Node)   |
|  Vite + TS + Tailwind v4  |                                    | JWKS Verify + 256-bit HMAC Sign  |
+---------------------------+                                    +----------------+-----------------+
                                                                                  |
                                                           +----------------------+----------------------+
                                                           |                                             |
                                                           v                                             v
                                           +-------------------------------+             +-------------------------------+
                                           |   Node 1: nexus-central       |             |   Node 2: nexus-branch-a      |
                                           | Supabase Auth + Core HR (PG17)| <== Sync == | Operational Attendance (PG17) |
                                           | (7 tables + daily summaries)  | Outbox/Inbox| (Local autonomy + RLS)        |
                                           +-------------------------------+             +-------------------------------+
```

### Key Architectural Decisions
- **Physical Two-Node Separation (ADR 001):** Central HR directory and identity (`nexus-central`) are physically separated from branch operational attendance (`nexus-branch-a`) as independent Supabase PostgreSQL 17 projects.
- **Global UUIDv4 Identity (ADR 002):** All primary keys use UUIDv4 (`gen_random_uuid()`) with logical cross-node references, and timestamps are stored as `TIMESTAMPTZ` in UTC (displayed in `Asia/Jakarta` / UTC+7).
- **Transactional Outbox / Inbox Sync (ADR 003):** Unidirectional synchronization uses claiming, optimistic leases, lease recovery, idempotency, and monotonic versioning to keep `attendance_daily_summaries` consistent even across network partitions.
- **Zero-Trust & Defense-in-Depth Security:** Central Supabase Auth issues JWTs validated cryptographically via JWKS at the Backend API Gateway, which signs actor context using an out-of-band 256-bit HMAC key (`gw-hmac-v1`). Row-Level Security (RLS) is enforced across all 17 application tables on both nodes, and service-role keys are never exposed to the client.

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Frontend** | React 19, TypeScript 5.7, Vite 6, Tailwind CSS v4, Lucide React, `@supabase/supabase-js` |
| **API Gateway / Backend** | Node.js `>=22.12.0` (native TypeScript execution & `node --test`), `pg` (PostgreSQL driver) |
| **Database & Auth** | Supabase (PostgreSQL 17, PL/pgSQL RPCs, Row-Level Security, Central Auth / JWKS) |
| **Deployment** | Netlify (`netlify.toml`) |

## Repository Structure

```text
nexus-hr/
├── design-system/nexus-hr/   # UI design system assets and tokens
├── docs/architecture/        # Architecture specs, ADRs, data dictionary, security model & Mermaid ERDs
├── frontend/                 # React 19 + Vite + TypeScript web application
│   └── src/                  # components/, context/, pages/, services/, types/, utils/
├── gateway/                  # Zero-Trust Node.js API Gateway & distributed sync worker
│   ├── certs/                # TLS / certificate materials
│   ├── scripts/              # HMAC provisioning scripts
│   └── src/                  # __tests__/, auth/, clients/, config/, errors/, security/, services/, sync/, types/, validation/
├── supabase/                 # SQL migrations (001_central_schema.sql, 002_branch_a_schema.sql) & remediation scripts
├── .env.example              # Root environment template
└── netlify.toml              # Netlify build & deployment config
```

## Getting Started

### Prerequisites
- **Node.js `>=22.12.0`** (required by `gateway/` for native TypeScript execution and `node --test`)
- **npm**
- Two configured **Supabase (PostgreSQL 17)** projects (`nexus-central` and `nexus-branch-a`) with migrations applied from `supabase/migrations/`

### 1. Configure Environment Variables
Copy each `.env.example` file to `.env` and fill in your Supabase URLs, keys, JWKS/JWT settings, and a 256-bit hex secret for `GATEWAY_ACTOR_HMAC_KEY`:

```bash
cp .env.example .env
cp gateway/.env.example gateway/.env
cp frontend/.env.example frontend/.env
```

### 2. Run the Zero-Trust API Gateway
```bash
cd gateway
npm install
npm start
```

Available gateway scripts:
- `npm test` — Run the gateway test suite (`node --test src/__tests__/*.test.ts`)
- `npm run sync` — Run a single Outbox/Inbox synchronization cycle
- `npm run sync:watch` — Continuously poll and synchronize across nodes
- `npm run sync:partition` — Simulate a network partition during sync
- `npm run provision:preview` / `npm run provision:execute` — Preview or execute HMAC actor key provisioning

### 3. Run the Frontend Application
```bash
cd frontend
npm install
npm run dev
```

Available frontend scripts:
- `npm run dev` — Start the Vite development server
- `npm run build` — Run TypeScript type-checking (`tsc`) and build for production
- `npm run preview` — Preview the production build locally

## Architecture Documentation

Detailed technical specifications are maintained under `docs/architecture/`:
- [Distributed Database Architecture Specification](https://www.google.com/search?q=docs/architecture/DATABASE_ARCHITECTURE.md)
- [Architecture Decision Records (ADR)](https://www.google.com/search?q=docs/architecture/DATABASE_DECISIONS.md)
- [Comprehensive Data Dictionary](https://www.google.com/search?q=docs/architecture/DATA_DICTIONARY.md)
- [Security Architecture \& Access Control](https://www.google.com/search?q=docs/architecture/SECURITY_AND_ACCESS.md)
- [Architecture Review \& Changelog](https://www.google.com/search?q=docs/architecture/ARCHITECTURE_REVIEW_AND_CHANGELOG.md)
- [Migration Audit Report](https://www.google.com/search?q=docs/architecture/MIGRATION_AUDIT_REPORT.md)
