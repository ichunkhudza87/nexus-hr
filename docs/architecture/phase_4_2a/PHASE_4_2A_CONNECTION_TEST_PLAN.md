# NEXUS HR — PHASE 4.2A CONNECTION TEST PLAN

**Target Infrastructure:**
- Central: `nexus-central` (`wcmevigbqsmzsdqidjel`)
- Branch A: `nexus-branch-a` (`uneycmbqqpkifwhwzbes`)
- Gateway: Local instance (`http://localhost:3000`)
**Status:** **PLANNING ONLY — NO REMOTE CALLS IN THIS PHASE**

---

## 1. Test Suite A — Central Node Live Connectivity

| Test ID | Objective | Endpoint / Action | Expected Result | Pass Criteria |
|---|---|---|---|---|
| **CONN-C01** | Central JWKS Fetch | `GET /auth/v1/.well-known/jwks.json` on Central | HTTP 200; returns array of JWKs containing valid public keys. | Central JWT Verifier successfully caches JWK. |
| **CONN-C02** | Central User Profile Read | Gateway calls `getUserProfileWithBranch(userId)` | HTTP 200; returns profile row with `id, email, role, branch_id, is_active, branch:branches(...)`. | Matches Central `user_profiles` row. |
| **CONN-C03** | Central Employee Directory Read | `GET /api/employees/directory?page=1&page_size=10` via Gateway | HTTP 200; returns paginated directory projection (`public.employee_directory`). | Content-Range header parsed; non-enterprise scoped to Branch A. |
| **CONN-C04** | Central Daily Summary Read | `GET /api/dashboard/summary?page=1&page_size=10` via Gateway | HTTP 200; returns corporate rollups (`public.attendance_daily_summaries`). | Content-Range header parsed; non-enterprise scoped to Branch A. |

---

## 2. Test Suite B — Branch A Node Live Connectivity

| Test ID | Objective | Endpoint / Action | Expected Result | Pass Criteria |
|---|---|---|---|---|
| **CONN-B01** | Branch A Employee Auth Lookup | Gateway calls `getEmployeesByAuthId(userAuthId)` | HTTP 200; returns active non-deleted `employees` row. | Verified `user_auth_id` matches Central `sub`. |
| **CONN-B02** | Branch A Employees Directory Read | `GET /api/employees` via Gateway | HTTP 200; returns paginated employees. | `EMPLOYEE` role sees own row only; Manager/Admin sees branch rows. |
| **CONN-B03** | Branch A Shifts Read | `GET /api/shifts` via Gateway | HTTP 200; returns shift definitions from `public.shifts`. | Pagination and `is_active` filter verified. |
| **CONN-B04** | Branch A Schedules Read | `GET /api/schedules` via Gateway | HTTP 200; returns roster from `public.employee_schedules`. | `EMPLOYEE` role sees own schedules only. |
| **CONN-B05** | Branch A Attendance Read | `GET /api/attendance` via Gateway | HTTP 200; returns records from `public.attendance`. | `EMPLOYEE` role sees own records only. |
| **CONN-B06** | Branch A Leave Requests Read | `GET /api/leave-requests` via Gateway | HTTP 200; returns records from `public.leave_requests`. | `EMPLOYEE` role sees own requests only; Manager sees branch requests. |

---

## 3. Test Suite C — Secure Remote RPC Live Integration

| Test ID | Scenario | Input & Envelope Parameters | Expected Result | Security Invariant Verified |
|---|---|---|---|---|
| **RPC-01** | Valid Branch Manager Decision | Valid Central JWT for `BRANCH_MANAGER`; target leave request in `PENDING`; valid HMAC envelope. | HTTP 200; leave request status updated to `APPROVED` or `REJECTED`. | Nonce recorded in `used_actor_nonces`; audit log generated with `leave_requests_MANAGER_DECIDED`. |
| **RPC-02** | Nonce Replay Rejection | Resend exact same RPC payload with already consumed `p_nonce`. | SQLSTATE `42501` / Gateway HTTP 403 `Replayed Gateway actor credential (nonce already consumed)`. | Single-use anti-replay verified in remote DB. |
| **RPC-03** | Key ID Tampering / Mismatch | Alter `p_key_id` to unknown ID or mismatch digest. | SQLSTATE `42501` / Gateway HTTP 403 `Unknown Gateway HMAC signing key` or `Forged or invalid Gateway actor signature`. | Key ID cryptographic binding verified. |
| **RPC-04** | Expired Credential | Envelope `p_exp` is past or `> 120s` from current database epoch. | SQLSTATE `42501` / Gateway HTTP 403 `Expired Gateway actor credential` or `TTL exceeds 120s maximum`. | Strict TTL window enforced in remote DB. |
| **RPC-05** | Unauthorized Role Boundary | `EMPLOYEE` JWT calls manager decision endpoint or superadmin endpoint. | Gateway rejects before RPC dispatch (HTTP 403 `FORBIDDEN_ROLE`). | Fail-closed RBAC boundary. |
| **RPC-06** | Manager Self-Approval Block | Branch Manager attempts to approve own leave request. | SQLSTATE `42501` / Gateway HTTP 403 `Self-approval by BRANCH_MANAGER is strictly prohibited`. | Business rule enforced inside database trigger. |
| **RPC-07** | Branch Mismatch Block | Actor branch does not match Branch A (`00000000-0000-0000-0000-000000000001`). | Gateway rejects during `IdentityResolver` (HTTP 403 `BRANCH_MISMATCH`). | Multi-branch tenant isolation. |
