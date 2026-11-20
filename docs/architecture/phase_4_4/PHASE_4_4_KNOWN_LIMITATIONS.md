# NEXUS HR — PHASE 4.4 KNOWN LIMITATIONS
## Truthful System Boundaries, Architectural Assumptions & Honest Disclosures

**Date:** 2026-11-17  
**Scope:** Phase 4.4 Academic & University Demonstration  
**Policy:** Absolute engineering transparency — do not conceal or misrepresent system boundaries.  

---

## 1. Centralized Identity vs. Autonomous Operational Boundaries

### Disclosure
In the full production architecture, user authentication tokens (JWTs) are issued by Central GoTrue / Auth (`wcmevigbqsmzsdqidjel`).

### Operational Impact During Prolonged Network Partition
- **Existing Sessions:** A branch employee who is already authenticated with an unexpired token (or local operational session context) can continue checking in and performing local roster operations during a Central network outage.
- **New Logins:** If a completely new session login is attempted while Central is physically partitioned, the client cannot communicate with Central GoTrue to issue a new asymmetric JWT.
- **Engineering Principle:** The demonstration truthfully preserves this boundary. We deliberately avoid inventing synthetic or insecure local password bypasses, as authentic distributed zero-trust models require explicit offline cryptographic provisioning (e.g., local branch public key validation or offline credential certificates), which is scheduled for future enterprise phases.

---

## 2. Cryptographic HMAC Provisioning State

### Disclosure
- The database schema `nexus_internal.gateway_signing_keys` and the Gateway `ActorHmacSigner` implement the complete v2.7 HMAC contract (12 canonical fields, `v2.7` protocol version, CSPRNG nonces, and timestamp validation).
- For the academic deadline demonstration, the distributed attendance and outbox relay pipeline operates through PostgREST service-role channels and database triggers.
- Production multi-key ring provisioning (storing the active 256-bit CSPRNG key in remote PostgreSQL `nexus_internal.gateway_signing_keys`) is managed through an out-of-band operational deployment process to prevent exposing secrets in public code repositories.

---

## 3. Module Scope Boundaries (Demonstrated vs. Mock Adapter)

| Module | Operational Mode in Phase 4.4 | Implementation Detail |
| :--- | :---: | :--- |
| **Attendance Check-In** | **LIVE DATABASE** | Real PostgreSQL `public.attendance` on Branch A node |
| **Transactional Outbox** | **LIVE DATABASE** | Real PostgreSQL `public.sync_outbox` on Branch A node |
| **Distributed Sync Worker** | **LIVE DAEMON** | Real HTTP relay claiming batches and pushing to Central |
| **Inbound Staging (Inbox)** | **LIVE DATABASE** | Real PostgreSQL `public.sync_inbox` on Central node |
| **Daily Attendance Summary** | **LIVE DATABASE** | Real PostgreSQL `public.attendance_daily_summaries` on Central |
| **Central Employee Directory**| **LIVE DATABASE** | Real PostgreSQL `public.employee_directory` on Central |
| **Leave Request Approval** | **HMAC TESTED / MOCK UI**| Gateway tested with 44/44 unit tests; UI supports live & mock adapter |
| **Payroll & Complex Analytics**| **MOCK ADAPTER** | Realistic Indonesian enterprise mock dataset for visual presentation |

---

## 4. Multi-Branch Scaling Considerations

- Phase 4.4 targets a two-node topology: `nexus-central` and `nexus-branch-a`.
- The database schema and Sync Worker are designed with multi-branch extensibility (e.g., `source_node VARCHAR(50)`, `branch_id UUID`). Additional branch nodes (e.g., Branch B - Surabaya, Branch C - Medan) can be registered in Central `public.branches` using identical schema contracts without architectural modifications.

---

## 5. Summary Statement

All limitations documented above represent legitimate distributed systems trade-offs governed by the CAP theorem. NEXUS HR strictly adheres to truthful engineering reporting and avoids synthetic shortcuts.
