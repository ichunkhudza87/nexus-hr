# NEXUS HR — PHASE 4.4 DEMO GUIDE
## Step-by-Step University Demonstration & Assessment Guide

**Date:** 2026-11-17  
**Audience:** Academic Evaluators, University Assessors, System Presenters  
**Target Application:** NEXUS HR Distributed Human Resource Management System  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`  

---

## 1. Quick Start Demonstration Environment

### Terminal 1: Backend API Gateway
```bash
cd D:\Antigravity_Projects\nexus-hr\gateway
npm test # Confirms 44/44 tests pass
npm start
```
*Listens on port 3000.*

### Terminal 2: Distributed Sync Worker
```bash
cd D:\Antigravity_Projects\nexus-hr\gateway
npm run sync:watch
```
*Watches Branch A outbox and synchronizes events to Central every 5 seconds.*

### Terminal 3: Frontend Web Application
```bash
cd D:\Antigravity_Projects\nexus-hr\frontend
npm run dev
```
*Opens web application on http://localhost:5173.*

---

## 2. Demonstration Scenarios for Assessors

### Scenario 1: Autonomous Branch Attendance Recording (ACID Guarantees)
1. **Login as Branch Employee:**
   - On the web UI, select role **Karyawan Cabang (Budi Santoso - EMP-A-0002)**.
   - Navigate to **Pencatatan Kehadiran & Log Absensi** (`/attendance`).
2. **Execute Presensi Masuk (Check-In):**
   - Click the green button **Catat Presensi Masuk Sekarang**.
   - Notice the instant confirmation toast: `Presensi masuk tercatat (Terverifikasi HMAC)`.
3. **Database Evidence for Assessors:**
   - Explain to assessors: The record is committed directly to the Branch A PostgreSQL node (`uneycmbqqpkifwhwzbes`).
   - Simultaneously, Branch A trigger `trg_attendance_summary_rollup` automatically computes the branch daily summary and inserts an event into `public.sync_outbox` in status `PENDING`.

---

### Scenario 2: Simulating Central Network Outage (Network Partition)
1. **Simulate Connection Cut:**
   - In the Sync Worker terminal (or configuration), set `CENTRAL_SYNC_ENABLED=false` or run:
     ```bash
     npm run sync:partition
     ```
   - Sync Worker displays:
     ```
     [WARN] sync.partition.active: Central sync disabled by configuration (CENTRAL_SYNC_ENABLED=false). Events remain safely in Branch A outbox.
     ```
2. **Perform Branch Operation While Offline:**
   - Switch user to **Siti Rahmawati (EMP-A-0003)**.
   - Record Presensi Masuk for Siti.
   - Observe: **Branch A accepts attendance without any delay or failure!**
3. **Inspect Outbox Backlog:**
   - Query Branch A `sync_outbox`:
     ```sql
     SELECT event_id, event_type, status FROM public.sync_outbox WHERE status = 'PENDING';
     ```
   - Show the assessor: The pending events are safely staged in PostgreSQL storage. No data is lost, and the branch is completely autonomous.

---

### Scenario 3: Restoring Connectivity & Automated Reconciliation
1. **Restore Central Connection:**
   - Resume the Sync Worker with normal connectivity:
     ```bash
     npm run sync
     ```
2. **Observe Sync Worker Execution:**
   - Output displays:
     ```
     [INFO] sync.batch.claimed: 1 event claimed
     [INFO] sync.batch.completed: 1 published, 0 failed
     ```
3. **Inspect Central Database Projections (`wcmevigbqsmzsdqidjel`):**
   - Query Central `attendance_daily_summaries`:
     ```sql
     SELECT * FROM public.attendance_daily_summaries;
     ```
   - Show the assessor: Central daily summary has updated `late_count = 2`, `total_employees = 2`, and `source_version = 1794898923735`.
4. **Inspect Branch A Outbox Status:**
   - Outbox rows have transitioned from `PENDING` to `PUBLISHED`.

---

### Scenario 4: Demonstrating Idempotency (Replay Attack Defense)
1. **Explain the Principle to Assessors:**
   - In distributed networks, messages can be duplicated or delivered multiple times. NEXUS HR implements consumer-side idempotency.
2. **Re-execute the Sync Cycle on the Same Event:**
   - Re-run `npm run sync`.
3. **Verify Zero Duplicates:**
   - Central `SELECT count(*) FROM public.attendance_daily_summaries` remains strictly **1 row**.
   - No duplicates, no primary key conflicts, and no inflated counts.

---

## 3. Key Architectural Selling Points for Academic Evaluation

1. **True Distributed Architecture:**
   Two separate PostgreSQL 17.11 clusters in Singapore (`wcmevigbqsmzsdqidjel` and `uneycmbqqpkifwhwzbes`), not a single mock database.
2. **Transactional Outbox Pattern:**
   Guarantees that operational mutations (attendance) and event publishing share the exact same ACID transaction boundary.
3. **Partition Tolerance (CAP Theorem):**
   The branch prioritizes Availability and Partition Tolerance (AP) for operational roster logging, converging to strong eventual consistency once Central connectivity is restored.
4. **Monotonic Event Sequencing:**
   Projections are protected against stale out-of-order delivery using `WHERE EXCLUDED.source_version > target.source_version`.
5. **Zero-Trust HMAC Security:**
   Gateway and database enforce canonical cryptographic actor envelopes with replay prevention.
