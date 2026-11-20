# NEXUS HR — PHASE 3.12A: SECURITY & RELIABILITY REGRESSION TEST MATRIX

**Purpose:** Exhaustive test suite validating actor identity propagation, leave authorization, privilege boundaries, employee code/outbox integrity, and Central seed/rollback safety under Remediation v2.6.  
**Execution Status:** Specification only (NOT yet executed; all tests run in disposable transactions or staging verification after Owner Authorization).

---

## 1. AUTHORIZATION & ACTOR IDENTITY SECURITY TESTS

### TC-01: Valid `SUPERADMIN` Decision & Retroactive Correction
- **Setup:** Existing `leave_requests` row `R1` (`status = 'PENDING'`, `employee_id = E1`). Verified Central user `U_SA` (`role = 'SUPERADMIN'` in Central `user_profiles`, `is_active = TRUE`). Gateway builds signed HMAC envelope (`p_operation_mode = 'DECISION'`, then second call `'CORRECTION'`).
- **Action:**
  1. Call `rpc_superadmin_update_leave_request` with `p_operation_mode = 'DECISION'`, `p_status = 'APPROVED'`.
  2. Call `rpc_superadmin_update_leave_request` with `p_operation_mode = 'CORRECTION'`, changing `employee_id = E2`, `leave_type = 'SICK'`, `start_date`, `end_date`, `total_days = 2.0`, `reason = 'Retroactive HR correction'`, `approved_by = U_MGR`, `approved_at = '2026-11-10T08:00:00Z'`.
- **Expected Result:** Both calls succeed. All fields update as requested.
- **Evidence:** `leave_requests` reflects modified fields; `audit_logs` has 2 immutable rows: row 1 (`action = 'leave_requests_SUPERADMIN_DECIDED'`, `actor_id = U_SA`), row 2 (`action = 'leave_requests_SUPERADMIN_CORRECTED'`, `actor_id = U_SA`, capturing full `old_values` / `new_values` diff).

### TC-02: Valid `BRANCH_MANAGER` Approval & Rejection
- **Setup:** `leave_requests` row `R2` (`status = 'PENDING'`, `employee_id = E1`), `leave_requests` row `R3` (`status = 'PENDING'`, `employee_id = E2`). Manager `U_MGR` (`role = 'BRANCH_MANAGER'`, `branch_id = 00000000-0000-0000-0000-000000000001`, active `employees.id = E_MGR != E1, E2`).
- **Action:** Gateway calls `rpc_branch_decide_leave_request` to `APPROVE` `R2` and `REJECT` `R3` (`p_rejection_reason = 'Peak coverage week'`).
- **Expected Result:** `R2.status = 'APPROVED'`, `R2.rejection_reason IS NULL`; `R3.status = 'REJECTED'`.
- **Evidence:** Both rows have `approved_by = U_MGR`, `approved_at` stamped by DB `now()`; `audit_logs` shows `action = 'leave_requests_MANAGER_DECIDED'`, `actor_id = U_MGR`.

### TC-03: `EMPLOYEE` Attempting Approval
- **Setup:** Standard employee `U_EMP` (`role = 'EMPLOYEE'`, `employees.id = E1`).
- **Action:**
  1. Gateway rejects before DB call (role guard), OR
  2. Test direct RPC `rpc_branch_decide_leave_request` with `p_actor_role = 'EMPLOYEE'` or as `authenticated` JWT (`role = 'EMPLOYEE'`).
- **Expected Result:** Fails closed. Gateway returns HTTP `403`. Direct `authenticated` RPC returns `42501 permission denied for function`. Trigger/RPC rejects `EMPLOYEE` role.
- **Evidence:** `leave_requests.status` remains `'PENDING'`; zero new `audit_logs` rows.

### TC-04: `BRANCH_MANAGER` Self-Approval Attempt
- **Setup:** `leave_requests` row `R_SELF` submitted by `E_MGR` (`employees.user_auth_id = U_MGR`, `status = 'PENDING'`).
- **Action:** Gateway signs valid HMAC envelope for `U_MGR` (`BRANCH_MANAGER`, `employee_id = E_MGR`) calling `rpc_branch_decide_leave_request(R_SELF, 'APPROVED', ...)`.
- **Expected Result:** Rejected by trigger `enforce_leave_decision_integrity()` with `'42501: Self-approval by BRANCH_MANAGER is strictly prohibited.'`.
- **Evidence:** Transaction rolls back; `R_SELF.status` remains `'PENDING'`, `approved_by IS NULL`.

### TC-05: `BRANCH_MANAGER` Attempting to Edit Application Fields
- **Setup:** `leave_requests` row `R2` (`status = 'PENDING'`, `employee_id = E1`).
- **Action:** Inside test transaction under verified `tx_actor_context` for `BRANCH_MANAGER`, execute `UPDATE public.leave_requests SET status = 'APPROVED', total_days = 0.5, start_date = start_date + 1 WHERE id = R2`.
- **Expected Result:** Rejected by `enforce_leave_decision_integrity()` via `IS DISTINCT FROM` checks: `'42501: BRANCH_MANAGER cannot modify leave application fields during approval/rejection.'`.
- **Evidence:** `R2` columns unchanged (`total_days`, `start_date`, `status = 'PENDING'`).

### TC-06: `BRANCH_MANAGER` Approving an Already Finalized Request
- **Setup:** `leave_requests` row `R_DONE` (`status = 'APPROVED'` or `'REJECTED'` or `'CANCELLED'`, `employee_id = E1`).
- **Action:** Call `rpc_branch_decide_leave_request(R_DONE, 'REJECTED', 'Late change', ...)` as `U_MGR`.
- **Expected Result:** Rejected with `'42501: BRANCH_MANAGER may only decide requests in PENDING status'`.
- **Evidence:** `R_DONE` remains unchanged; zero audit rows added.

### TC-07: `NULL` Actor (`p_actor_user_id IS NULL`)
- **Setup:** Attempt call to `verify_gateway_actor` or `rpc_branch_decide_leave_request` with `p_actor_user_id = NULL`.
- **Action:** Invoke RPC with `p_actor_user_id => NULL`.
- **Expected Result:** Fails closed with `'42501: Missing actor_user_id (fails closed).'`.
- **Evidence:** Zero DB mutations.

### TC-08: `NULL` Role (`p_actor_role IS NULL` and Missing JWT Claim)
- **Setup:** Empty/missing JWT claim in `get_auth_role()` AND `p_actor_role = NULL` in RPC.
- **Action:** Query `SELECT public.get_auth_role();` without valid `authenticated` JWT; call RPC with `p_actor_role => NULL`.
- **Expected Result:** `get_auth_role()` returns `NULL` (does NOT default to `'EMPLOYEE'`). RPC raises `'42501'`.
- **Evidence:** Return value is `NULL`; mutation rejected.

### TC-09: `NULL` Employee Identity (`BRANCH_MANAGER` without Active `employees` Row)
- **Setup:** Central `user_profiles` user `U_NO_EMP` has `role = 'BRANCH_MANAGER'`, `branch_id = 00000000-0000-0000-0000-000000000001`, but NO active/non-deleted row in Branch A `public.employees`.
- **Action:** Gateway attempts employee lookup; DB test invokes `verify_gateway_actor` with `p_employee_id = NULL` for `'BRANCH_MANAGER'`.
- **Expected Result:** Gateway returns `403`. DB raises `'42501: Active employee identity is required for role BRANCH_MANAGER.'`.
- **Evidence:** Mutation blocked at both layers.

### TC-10: Forged `actor_id` / `p_actor_user_id`
- **Setup:** Valid HMAC envelope generated for `U_MGR1`, then payload tampered before RPC (`p_actor_user_id` swapped to `U_MGR2` without re-signing).
- **Action:** Call `rpc_branch_decide_leave_request` with tampered `p_actor_user_id`.
- **Expected Result:** Rejected by SHA-256 HMAC check: `'42501: Forged or invalid Gateway actor signature.'`. Also rejected if `U_MGR2` does not own `p_employee_id`.
- **Evidence:** Exception raised; nonce table unaffected; `leave_requests` untouched.

### TC-11: Forged `actor_role` (Privilege Escalation `EMPLOYEE` $\to$ `SUPERADMIN`)
- **Setup:** Envelope signed for `role = 'EMPLOYEE'`, parameter mutated to `p_actor_role = 'SUPERADMIN'` in transit; OR user sends `app_metadata: { user_role: 'SUPERADMIN' }` in self-authored request body.
- **Action:** Submit to Gateway and/or Branch A RPC.
- **Expected Result:** Gateway reads role strictly from Central `user_profiles` (ignores body); DB rejects tampered parameter via HMAC check (`'42501: Forged or invalid Gateway actor signature.'`).
- **Evidence:** Escalation blocked; HTTP `403` / SQLSTATE `42501`.

### TC-12: Invalid Branch Membership
- **Setup:** Central user `U_BR_B` assigned `branch_id = '00000000-0000-0000-0000-000000000002'` (`BRANCH-B`) with `role = 'BRANCH_MANAGER'`.
- **Action:** User sends Central JWT to Gateway for Branch A operation; DB test passes `p_branch_id = '00000000-0000-0000-0000-000000000002'` to Branch A `verify_gateway_actor`.
- **Expected Result:** Gateway rejects branch mismatch (`403`); Branch A DB rejects `'42501: Invalid or mismatched branch membership for role BRANCH_MANAGER.'`.
- **Evidence:** Request blocked on both nodes.

### TC-13: Expired Credential (Expired Central JWT & Expired HMAC Envelope)
- **Setup:**
  1. Central JWT with `exp < now_epoch`.
  2. HMAC envelope with `p_exp = floor(extract(epoch from now())) - 5` (or TTL $> 120\text{s}$).
- **Action:** Send expired Central JWT to Gateway; send expired `p_exp` envelope to RPC.
- **Expected Result:** Gateway rejects expired JWT (`401`); RPC rejects `'42501: Expired Gateway actor credential.'` (and rejects TTL $> 120\text{s}$).
- **Evidence:** Zero mutations; HTTP `401` / SQLSTATE `42501`.

### TC-14: Replayed Credential (Same `p_nonce` Submitted Twice)
- **Setup:** Valid signed Gateway envelope with `p_nonce = N1` executed once successfully on `R2` (or `R3`).
- **Action:** Resubmit exact same `(p_nonce = N1, p_actor_sig, ...)` within its 60s expiry window.
- **Expected Result:** First call succeeds and persists `N1` in `nexus_internal.used_actor_nonces`. Second call fails with `'42501: Replayed Gateway actor credential (nonce already consumed).'`.
- **Evidence:** `used_actor_nonces` has exactly 1 row for `N1`; second transaction rolled back.

### TC-15: Direct RPC Call Without Gateway Authentication (`anon` / `authenticated`)
- **Setup:** Obtain `anon` or `authenticated` session on Branch A PostgREST.
- **Action:** `POST /rest/v1/rpc/rpc_branch_decide_leave_request` (or `rpc_superadmin_update_leave_request`) using `anon` key or `authenticated` bearer token.
- **Expected Result:** PostgREST / PostgreSQL rejects immediately with SQLSTATE `42501 permission denied for function`.
- **Evidence:** HTTP `401`/`403`; function body never executes.

### TC-16: `service_role` Operation Without Verified Actor & Writable GUC Attempt
- **Setup:** Session running under `SET LOCAL ROLE service_role;`.
- **Action:**
  1. Execute `UPDATE public.leave_requests SET status = 'APPROVED' WHERE id = R2;` directly via PostgREST or SQL.
  2. Attempt GUC spoofing: `SET LOCAL nexus.actor_id = '<uuid>'; SET LOCAL request.jwt.claims = '{"sub":"<uuid>","app_metadata":{"user_role":"SUPERADMIN"}}'; UPDATE public.leave_requests SET status = 'APPROVED' WHERE id = R2;`.
  3. Attempt to read HMAC key: `SELECT * FROM nexus_internal.gateway_signing_keys;`.
- **Expected Result:**
  1. Direct `UPDATE` raises `'42501: Direct leave_requests UPDATE without verified Gateway actor context is prohibited.'`.
  2. GUC spoofing STILL raises `'42501'` because `session_user` is not `'authenticator'` with `role = 'authenticated'`, and triggers ignore custom `nexus.*` GUCs in favor of `nexus_internal.tx_actor_context`.
  3. `SELECT` on `nexus_internal.gateway_signing_keys` raises `42501 permission denied for schema nexus_internal`.
- **Evidence:** All 3 vectors fail closed.

### TC-17: Correct `approved_by` and `audit_logs.actor_id` Attribution
- **Setup:** `R2` (`status = 'PENDING'`) decided by `U_MGR` via `rpc_branch_decide_leave_request`.
- **Action:** Inspect resulting `leave_requests` and `audit_logs` rows.
- **Expected Result:** `leave_requests.approved_by = U_MGR`, `leave_requests.approved_at IS NOT NULL`, `audit_logs.actor_id = U_MGR`, `audit_logs.actor_email = U_MGR.email`, `audit_logs.action = 'leave_requests_MANAGER_DECIDED'`.
- **Evidence:** Query join confirms exact identity match across `leave_requests` and `audit_logs` (zero `NULL` actors).

---

## 2. EMPLOYEE CODE, SEQUENCE & OUTBOX TESTS

### TC-18: Employee Code Generation at `9,999` and `10,000`
- **Setup:** Disposable transaction setting `setval('public.seq_branch_a_employee_code', 9998, true)`.
- **Action:** Insert two employees (`E_9999`, `E_10000`) with `employee_code = NULL`, then `ROLLBACK`.
- **Expected Result:**
  - `E_9999.employee_code = 'EMP-A-9999'` (length 10).
  - `E_10000.employee_code = 'EMP-A-10000'` (length 11 — **no truncation** to `'EMP-A-1000'`).
- **Evidence:** Returning values and `uq_employees_code` uniqueness verified.

### TC-19: Outbox Payload Integrity & Deterministic Trigger Ordering
- **Setup:** Insert new employee without explicit `employee_code` inside transaction.
- **Action:** Inspect `public.sync_outbox` row created in the same transaction; also test calling `emit_employee_outbox_event` scenario where `employee_code` is forced empty before `trg_03` (e.g., unit check).
- **Expected Result:**
  - `trg_01_employees_generate_code` runs before `trg_03_employees_outbox_sync`.
  - `sync_outbox.payload ->> 'employee_code'` is non-null (`'EMP-A-0001'`, matching `employees.employee_code`).
  - Missing `employee_code` raises `'Invariant Violation'` without calling `nextval()`.
- **Evidence:** `payload ->> 'employee_code' = employees.employee_code`; `currval('seq_branch_a_employee_code')` increments exactly once per employee.

### TC-20: Unauthorized Outbox RPC Execution
- **Setup:** Calls to `claim_outbox_batch`, `mark_outbox_published`, `mark_outbox_failed`, and `recalculate_attendance_summary`.
- **Action:** Attempt `POST /rest/v1/rpc/claim_outbox_batch` as `anon` and as `authenticated`; attempt as `service_role`.
- **Expected Result:** `anon` and `authenticated` receive `42501 permission denied for function` (and `recalculate_attendance_summary` denied to `service_role` as well). `service_role` succeeds on the 3 Sync Worker RPCs.
- **Evidence:** HTTP `401`/`403` for `anon`/`authenticated`; `pg_proc` ACL checks confirm `{postgres,service_role}` only.

---

## 3. CENTRAL SEED & RACE-SAFE ROLLBACK TESTS

### TC-21: Central Seed Idempotency & Conflict Detection
- **Setup:**
  - Case A: Empty `branches` table $\to$ execute seed twice.
  - Case B: Pre-existing conflicting row (`id = 00000000-0000-0000-0000-000000000001` with `code = 'OTHER'`, or `code = 'BRANCH-A'` with another UUID).
- **Action:** Execute Part 2 Central Seed script.
- **Expected Result:**
  - Case A: First run inserts `BRANCH-A`; second run succeeds idempotently without modifying timestamps or nullable columns.
  - Case B: Precondition guard raises `'Seed conflict: ...'` and aborts without overwriting existing rows.
- **Evidence:** Row count = 1 in Case A; rollback & preserved prior row in Case B.

### TC-22: Central Rollback with References in Each of the 4 Child Tables
- **Setup:** Insert seed `BRANCH-A`, then run 5 separate rollback test cases (each in isolated test state/transaction):
  1. Reference exists ONLY in `employee_directory`.
  2. Reference exists ONLY in `attendance_daily_summaries`.
  3. Reference exists ONLY in `user_profiles`.
  4. Reference exists ONLY in `audit_logs`.
  5. Concurrency test: Session A starts rollback and acquires `SELECT ... FOR UPDATE` on `branches(id)`; Session B simultaneously tries `INSERT INTO user_profiles (..., branch_id)` referencing `'00000000-0000-0000-0000-000000000001'`.
- **Action:** Execute Central rollback procedure (`PHASE_3_12A_ROLLBACK_PLAN.md`).
- **Expected Result:**
  - Cases 1–4: Rollback detects child reference, **does NOT delete** `branches` row (preserving `user_profiles.branch_id` and `audit_logs.branch_id` from `ON DELETE SET NULL`), and sets `branches.is_active = FALSE`.
  - Case 5: Session B's FK check (`FOR KEY SHARE`) blocks cleanly until Session A commits (`is_active = FALSE`) — zero orphaned references, zero lost audit links.
- **Evidence:** `branches.is_active = FALSE`; all 4 child tables retain exact non-null `branch_id = '00000000-0000-0000-0000-000000000001'`.
