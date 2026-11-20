# NEXUS HR — PHASE 3.12A: SECURITY ARCHITECTURE FINALIZATION (REMEDIATION V2.6)

**Role:** Senior Supabase Security Architect, PostgreSQL Security Engineer, Distributed Backend Systems Architect  
**Project:** NEXUS HR  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`  
**Mode:** STRICT READ-ONLY INVESTIGATION & SPECIFICATION (NO SQL EXECUTED, NO MIGRATIONS MODIFIED)  
**Target Nodes:**
- **Central (`nexus-central`):** `wcmevigbqsmzsdqidjel` (`ap-southeast-1`, PostgreSQL 17.11)
- **Branch A (`nexus-branch-a`):** `uneycmbqqpkifwhwzbes` (`ap-southeast-1`, PostgreSQL 17.11)
- **Legacy Projects (`bolt`, `cbt`, `nusantara`):** Strictly untouched and off-limits.

---

## 1. CRITICAL RE-AUDIT OF PHASE 3.11

Phase 3.11 concluded `READY FOR FINAL AUTHORIZATION`. Re-verifying that conclusion against live PostgreSQL catalog evidence on `uneycmbqqpkifwhwzbes` and `wcmevigbqsmzsdqidjel` plus repository contents reveals that **Phase 3.11's readiness verdict was premature**:

| Issue Discovered in Phase 3.12A Audit | Live Evidence Observed | Security Impact |
| :--- | :--- | :--- |
| **1. `vault.decrypted_secrets` Readable by `service_role`** | `information_schema.role_table_grants` on Branch A shows `service_role` holds `SELECT, DELETE` on `vault.secrets` and `vault.decrypted_secrets`. | Any component holding `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` (such as the Sync Worker) could read a Vault-stored Gateway HMAC secret and forge actor assertions. |
| **2. All 16 `public` Functions Callable by `PUBLIC`/`anon`/`authenticated`** | `information_schema.routine_privileges` shows `EXECUTE` granted to `PUBLIC`, `anon`, and `authenticated` on all 16 functions, including `SECURITY DEFINER` worker functions (`claim_outbox_batch`, `mark_outbox_published`, `mark_outbox_failed`, `recalculate_attendance_summary`). | Unauthenticated (`anon`) or standard (`authenticated`) callers can invoke `/rest/v1/rpc/claim_outbox_batch` or `mark_outbox_published` directly via PostgREST to hijack or corrupt replication events. |
| **3. Excessive Table Grants (`TRUNCATE` & Broad DML) to `anon`/`authenticated`** | `role_table_grants` shows `anon` holds `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` on `branch_config`, `departments`, `employee_schedules`, `leave_requests`, `positions`, `shifts`, and `TRUNCATE` on `attendance` and `employees`. | PostgreSQL RLS does **not** govern `TRUNCATE`. While PostgREST does not expose `TRUNCATE`, defense-in-depth requires revoking `TRUNCATE` and all unnecessary privileges from `anon` and `authenticated`. |
| **4. `get_auth_role()` Fails Open to `'EMPLOYEE'`** | Live definition of `public.get_auth_role()` returns `'EMPLOYEE'` on `NULL` claim or `EXCEPTION`. | Violates fail-closed security: a missing, malformed, or unverified JWT state silently maps to `'EMPLOYEE'` instead of `NULL` / rejection. |
| **5. Unverified `p_actor_id` / Session Variable Risk** | Phase 3.11 suggested an RPC accepting `p_actor_id` / `p_actor_role` under `service_role` without proving cryptographic separation from `service_role` or blocking writable session GUCs (`SET LOCAL`). | Without cryptographic verification + unforgeable internal transaction state, `service_role` callers or GUC-manipulation paths cannot be distinguished from trusted Gateway requests. |
| **6. Absent Gateway Implementation & Unprovisioned Secret** | Workspace contains only `docs/` and `supabase/migrations/`. `vault.secrets` count is `0`. `.env.example` contains `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` but no Gateway actor signing key. | Runtime end-to-end verification cannot pass until the secret is provisioned out-of-band and the Gateway is implemented against this specification. |

---

## 2. ACTOR IDENTITY PROPAGATION ARCHITECTURE

### 2.1 Evaluation of Candidate Mechanisms

#### Option A: Short-Lived Branch A JWT Issued by Trusted Gateway
- **How it works:** Gateway verifies Central JWT via Central JWKS, queries Central `user_profiles` + Branch A `employees`, mints a 60s JWT signed with Branch A's JWT signing key (`role: authenticated`, `sub: user_id`, `app_metadata`), and calls Branch A PostgREST.
- **Why it is NOT selected as the primary standalone mechanism:**
  1. **Key Custody & Asymmetric Auth Constraint:** `.env.example` does not provision `BRANCH_A_JWT_SECRET`. Modern Supabase projects may use asymmetric ECC JWT signing keys managed inside GoTrue whose private key is not exportable, whereas holding a symmetric Branch A JWT secret also grants capability to mint `service_role` tokens.
  2. **No Native Anti-Replay:** PostgREST JWT validation is stateless (`exp` check only) and does not track single-use `jti` nonces; a leaked 60-second JWT could be replayed directly against Branch A PostgREST if `SUPABASE_BRANCH_A_ANON_KEY` is known.
  3. **GoTrue Exposure Surface:** Direct Branch A `authenticated` access requires ensuring Branch A GoTrue public signup is disabled so attackers cannot self-register a Branch A `authenticated` JWT.

#### Option B+C (SELECTED): Cryptographically Signed Gateway Actor Envelope + Isolated Signing Key (`nexus_internal`) + `SECURITY DEFINER` RPC Boundary
- **Why it IS cryptographically provable and enforceable inside PostgreSQL 17:**
  1. **Separation of Duties from `service_role`:** `service_role` has `rolsuper = false` (`rolbypassrls = true`), meaning `rolbypassrls` only bypasses RLS — it does **not** bypass PostgreSQL `SCHEMA` or `TABLE` ACLs (`GRANT`/`REVOKE`). By placing `gateway_signing_keys`, `used_actor_nonces`, and `tx_actor_context` inside a private schema `nexus_internal` owned by `postgres` with `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`, **even a compromised Sync Worker holding `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` cannot read the HMAC key, cannot forge an actor signature, and cannot write to `tx_actor_context`.**
  2. **No Reliance on Trusting Raw RPC Parameters:** `p_actor_user_id`, `p_actor_role`, `p_branch_id`, and `p_employee_id` are never trusted as plain arguments. They are cryptographically bound into a canonical HMAC-SHA256 signature alongside `p_action_scope`, `p_target_id`, `p_exp`, and single-use `p_nonce`, verified via `extensions.hmac(..., 'sha256')` inside a `SECURITY DEFINER` function owned by `postgres`.
  3. **No Reliance on Freely Writable Session Variables (`SET LOCAL`):** Triggers (`enforce_leave_decision_integrity()` and `record_branch_audit_log()`) do **not** read user-writable custom GUCs (`current_setting('nexus.*', true)`). Instead, after cryptographic + live DB verification succeeds, the RPC records an atomic row in `nexus_internal.tx_actor_context` keyed by `pg_current_xact_id()`. Triggers read `nexus_internal.tx_actor_context WHERE txid = pg_current_xact_id()`, which no client, `anon`, `authenticated`, or `service_role` session can insert into directly.
  4. **Anti-Replay & Short TTL Enforcement:** Every envelope requires `p_exp` within `[now(), now() + 120s]` and a unique UUID `p_nonce` atomically inserted into `nexus_internal.used_actor_nonces`. Any duplicate `p_nonce` fails immediately.
  5. **Direct Client RPC Access Blocked at Catalog Gate:** `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role;` ensures any untrusted client calling `/rest/v1/rpc/...` fails with SQLSTATE `42501 (permission denied)` before PL/pgSQL execution begins.

> [!NOTE]
> Even if direct `service_role` DML (`PATCH /rest/v1/leave_requests`) is attempted without calling the verified RPC, `tx_actor_context` has no row for `pg_current_xact_id()`, so `enforce_leave_decision_integrity()` **fails closed** and aborts the transaction.

---

## 3. SEPARATION OF GATEWAY VS POSTGRESQL RESPONSIBILITIES

### 3.1 Gateway-Side Requirements (Node/TypeScript API Server)
The Backend API Gateway acts as the **Identity & Session Verification Boundary** between Central Supabase Auth and Branch A:
1. **Cryptographic Verification of Central JWT:** Validate incoming `Authorization: Bearer <central_jwt>` against Central JWKS (`https://wcmevigbqsmzsdqidjel.supabase.co/auth/v1/.well-known/jwks.json`), strictly enforcing:
   - Allowed asymmetric/configured signing algorithms (reject `alg: none` or key confusion).
   - `iss === 'https://wcmevigbqsmzsdqidjel.supabase.co/auth/v1'`
   - `aud === 'authenticated'`
   - `exp > now_epoch` (zero tolerance for expired tokens)
   - Valid non-null UUID `sub`.
2. **Authoritative Profile & Branch Lookup (Central Node):** Query `nexus-central.public.user_profiles` (via `SUPABASE_CENTRAL_SERVICE_ROLE_KEY`) joined with `public.branches` using `id = central_jwt.sub`.
   - Reject HTTP `401`/`403` if profile missing or `user_profiles.is_active IS NOT TRUE`.
   - Never trust `role`, `branch_id`, `actor_id`, or `employee_id` from request headers, query params, or JSON body.
   - For non-enterprise roles (`BRANCH_MANAGER`, `BRANCH_HR`, `EMPLOYEE`), verify `user_profiles.branch_id = '00000000-0000-0000-0000-000000000001'` (`BRANCH-A`) and `branches.is_active = TRUE`.
3. **Authoritative Employee Resolution (Branch A Node):** Query `nexus-branch-a.public.employees` by `user_auth_id = central_jwt.sub`.
   - For `BRANCH_MANAGER` and `EMPLOYEE`: require exactly 1 row with `is_active = TRUE AND is_deleted = FALSE`; reject HTTP `403` if missing, inactive, or soft-deleted.
   - For `SUPERADMIN`: resolve `employee_id` if present (`is_deleted = FALSE`), else `NULL`.
4. **Canonical Envelope Signing & Dispatch:** Construct canonical payload (`action_scope|target_id|actor_user_id|actor_email|actor_role|branch_id|employee_id|exp|nonce`), sign with `GATEWAY_ACTOR_HMAC_KEY` (`HMAC-SHA256`, `exp = now + 60s`), and invoke ONLY the scoped Branch A RPC (`rpc_branch_decide_leave_request` or `rpc_superadmin_update_leave_request`) over HTTPS TLS using `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY`.

### 3.2 PostgreSQL-Side Requirements (Branch A Database)
Branch A PostgreSQL treats the Gateway as a **cryptographically authenticated but non-infallible caller** and independently enforces:
1. **Privilege Isolation:** Only `service_role` (or dedicated `nexus_gateway_role`) can `EXECUTE` the leave decision/admin RPCs. `PUBLIC`, `anon`, and `authenticated` are revoked.
2. **HMAC & Replay Verification (`nexus_internal.verify_gateway_actor`):** Verifies HMAC against `nexus_internal.gateway_signing_keys`, verifies expiry bounds (`<= 120s`), consumes single-use `nonce` in `nexus_internal.used_actor_nonces`.
3. **Live Database Cross-Checks:** Independently queries `branch_config` (`BRANCH-A` ID match) and `public.employees` (`user_auth_id = p_actor_user_id AND is_active AND NOT is_deleted`) before trusting `employee_id`.
4. **Transaction-Bound Trigger Enforcement (`enforce_leave_decision_integrity`):**
   - Resolves verified actor strictly from `nexus_internal.tx_actor_context WHERE txid = pg_current_xact_id()` (or authentic `authenticated` PostgREST session if direct client policy is enabled; **never** `service_role` without `tx_actor_context`, **never** writable GUCs).
   - Fails closed on any NULL or invalid actor/role/employee/branch state.
5. **Immutable Audit Logging (`record_branch_audit_log`):** Always stamps real `actor_id` and `actor_email` from `tx_actor_context` (never `NULL`), and records distinct actions (`leave_requests_MANAGER_DECIDED`, `leave_requests_SUPERADMIN_DECIDED`, `leave_requests_SUPERADMIN_CORRECTED`).

---

## 4. LEAVE REQUEST AUTHORIZATION SPECIFICATION

### 4.1 Path A: `SUPERADMIN` Full Authority (`rpc_superadmin_update_leave_request`)
- **Preconditions:** Verified actor role `= 'SUPERADMIN'`; `p_operation_mode IN ('DECISION', 'CORRECTION')`.
- **Capabilities:** May modify all data fields (`employee_id`, `leave_type`, `start_date`, `end_date`, `total_days`, `reason`, `status`, `rejection_reason`) and retroactive decision metadata (`approved_by`, `approved_at`).
- **Distinction Between Correction vs New Decision:**
  - **`DECISION` mode:** Requires `p_status IN ('APPROVED', 'REJECTED')`; stamps `approved_by = COALESCE(p_approved_by, v_actor_user_id)` and `approved_at = COALESCE(p_approved_at, now())`; records `audit_logs.action = 'leave_requests_SUPERADMIN_DECIDED'`.
  - **`CORRECTION` mode:** Allows full retroactive adjustment of any field (`employee_id`, dates, days, reason, status, `approved_by`, `approved_at`) with table `CHECK` invariants preserved; records `audit_logs.action = 'leave_requests_SUPERADMIN_CORRECTED'`.
- **Audit Guarantee:** Regardless of whether `leave_requests.approved_by` is retroactively adjusted in `CORRECTION` mode, `audit_logs.actor_id` and `audit_logs.actor_email` **unconditionally record the performing `SUPERADMIN` (`v_actor_user_id`, `v_actor_email`)**, and `old_values`/`new_values` capture the exact before/after JSON diff.

### 4.2 Path B: `BRANCH_MANAGER` Restricted Decision (`rpc_branch_decide_leave_request`)
- **Preconditions:** Verified actor role `= 'BRANCH_MANAGER'`, verified `branch_id = '00000000-0000-0000-0000-000000000001'`, verified non-null active `employee_id`.
- **Invariants Enforced in Both RPC and `BEFORE UPDATE` Trigger:**
  1. Target row must have `OLD.status = 'PENDING'` (finalized `APPROVED`, `REJECTED`, `CANCELLED` rows are rejected).
  2. Decision must be `NEW.status IN ('APPROVED', 'REJECTED')`.
  3. **No Self-Approval:** `OLD.employee_id IS DISTINCT FROM v_actor_employee_id` AND `NEW.employee_id IS DISTINCT FROM v_actor_employee_id`, plus redundant lookup verifying `OLD.employee_id` does not belong to `v_actor_user_id` in `public.employees`.
  4. **Zero Field Tampering (`IS DISTINCT FROM` checks):**
     - `NEW.employee_id IS DISTINCT FROM OLD.employee_id` $\to$ Reject
     - `NEW.leave_type IS DISTINCT FROM OLD.leave_type` $\to$ Reject
     - `NEW.start_date IS DISTINCT FROM OLD.start_date` $\to$ Reject
     - `NEW.end_date IS DISTINCT FROM OLD.end_date` $\to$ Reject
     - `NEW.total_days IS DISTINCT FROM OLD.total_days` $\to$ Reject
     - `NEW.reason IS DISTINCT FROM OLD.reason` $\to$ Reject
     - `NEW.submitted_at IS DISTINCT FROM OLD.submitted_at` $\to$ Reject
     - `NEW.created_at IS DISTINCT FROM OLD.created_at` $\to$ Reject
  5. **Server-Assigned Decision Metadata:** `NEW.approved_by := v_actor_user_id` and `NEW.approved_at := now()` unconditionally (never accepted from client payload). If `'REJECTED'`, `NULLIF(btrim(NEW.rejection_reason), '') IS NOT NULL` is required.
  6. **Audit Action:** `audit_logs.action = 'leave_requests_MANAGER_DECIDED'`, `actor_id = v_actor_user_id`.

### 4.3 Fail-Closed Matrix for Invalid Security States

| Failure Condition | Enforcement Layer | Behavior |
| :--- | :--- | :--- |
| **NULL role** | `get_auth_role()` + Gateway + `verify_gateway_actor()` + Trigger | `get_auth_role()` returns `NULL` (not `'EMPLOYEE'`). RPC/Trigger raises `42501` / `P0001` and aborts transaction. |
| **NULL employee identity** | Gateway + `verify_gateway_actor()` + Trigger | Rejected for `BRANCH_MANAGER` (`employee_id IS NULL` or inactive/soft-deleted). |
| **Invalid branch membership** | Gateway + `verify_gateway_actor()` | Rejected if `branch_id IS DISTINCT FROM branch_config.id` (`00000000-0000-0000-0000-000000000001`) for branch-scoped roles. |
| **Missing actor context** | Trigger (`tx_actor_context` miss + `auth.uid() IS NULL`) | Rejected even under `service_role`. Zero rows modified. |
| **Forged actor identity (`p_actor_id`/`p_actor_role`)** | `verify_gateway_actor()` HMAC check + live DB employee check | Invalid HMAC signature rejected immediately; `nonce` not consumed unless valid signature first verified (or rejected before mutation). |
| **Writable GUC attempt (`SET LOCAL ...`)** | Trigger ignores custom GUCs | Triggers read ONLY `nexus_internal.tx_actor_context` (inaccessible to `anon`/`authenticated`/`service_role`), never user GUCs. |
| **Expired credential** | Gateway (`exp`) + RPC (`p_exp < epoch` or TTL $> 120\text{s}$) | Rejected with exception; zero DB changes. |
| **Replayed credential** | `nexus_internal.used_actor_nonces` PK violation | Second submission of same `p_nonce` aborts with replay exception. |
| **Direct RPC call outside Gateway** | PostgreSQL `REVOKE EXECUTE` + HMAC key isolation | `anon`/`authenticated` get `permission denied for function`; rogue `service_role` without HMAC secret fails signature check. |

---

## 5. EMPLOYEE CODE & OUTBOX RELIABILITY DESIGN

Verified against live Branch A catalog (`employees.employee_code` is `VARCHAR(50) NOT NULL`, `seq_branch_a_employee_code` is `BIGINT` `NO CYCLE`, `last_value = NULL`, `employees` row count `= 0`):
1. **Non-Truncating Code Format:** For `v_seq < 10000`, format `'EMP-A-' || lpad(v_seq::text, 4, '0')` (`EMP-A-0001` .. `EMP-A-9999`); for `v_seq >= 10000`, format `'EMP-A-' || v_seq::text` (`EMP-A-10000`, `EMP-A-10001`, ...).
2. **Bounded Non-Cycling Sequence:** Alter `seq_branch_a_employee_code` to `MAXVALUE 999999999999 NO CYCLE` (12 digits $\implies$ max 18 chars total, well within `VARCHAR(50)`).
3. **Deterministic Trigger Execution:** Replace alphabetically inverted triggers (`trg_employee_outbox_sync` firing before `trg_generate_employee_code`) with strictly ordered names:
   - `trg_01_employees_generate_code` (`BEFORE INSERT`)
   - `trg_02_employees_updated_at` (`BEFORE UPDATE`)
   - `trg_03_employees_outbox_sync` (`BEFORE INSERT OR UPDATE`)
4. **Fail-Fast Outbox Invariant (Zero Fallback Sequence Consumption):** Inside `emit_employee_outbox_event()`, assert `IF NEW.employee_code IS NULL OR btrim(NEW.employee_code) = '' THEN RAISE EXCEPTION ...; END IF;`. Never call `nextval()` inside `emit_employee_outbox_event()`.

---

## 6. CENTRAL SEED & ROLLBACK SAFETY SUMMARY

Verified against live Central catalog (`branches_count = 0`, all 4 child tables currently `0` rows):
- **Preconditions:** Assert neither UUID `00000000-0000-0000-0000-000000000001` (with another `code`) nor `code = 'BRANCH-A'` (with another `id`) exists.
- **Idempotent Seed:** `INSERT ... ON CONFLICT (id) DO NOTHING`, followed by assertion verifying row matches exact canonical fields (`code = 'BRANCH-A'`, `name = 'Branch A - Jakarta'`, `timezone = 'Asia/Jakarta'`, `is_active = TRUE`, `address IS NULL`, `phone_number IS NULL`) without overwriting any unrelated existing record.
- **Race-Safe Rollback:** Acquires `SELECT ... FROM public.branches WHERE id = ... FOR UPDATE` inside a transaction (which blocks concurrent child-table FK `FOR KEY SHARE` locks until resolved), inspects all 4 child tables (`employee_directory`, `attendance_daily_summaries`, `user_profiles`, `audit_logs`), and prefers **soft deactivation (`is_active = FALSE`)** rather than destructive `DELETE`.

---

## 7. FINAL DECISION STATUS

**STATUS: `NEEDS OWNER INPUT`**

### Why `NEEDS OWNER INPUT` (Not `READY FOR FINAL AUTHORIZATION` Yet)
Although every PostgreSQL privilege, trigger ordering, leave authorization invariant, cryptographic actor propagation model, and race-safe rollback design is now verified and specified in full (`PHASE_3_12A_REMEDIATION_V2_6.sql`), two concrete owner decisions/actions are required prior to Phase 3.12B execution:

1. **Out-of-Band HMAC Secret Provisioning (`nexus_internal.gateway_signing_keys`):**  
   A production-grade 256-bit random `GATEWAY_ACTOR_HMAC_KEY` must be generated outside version-controlled SQL files and provisioned into Branch A (`nexus_internal.gateway_signing_keys`) and the Gateway runtime secret manager (and documented in `.env.example` when authorized). Until inserted, `verify_gateway_actor()` intentionally fails closed on RPC calls.
2. **Direct `authenticated` Leave `UPDATE` Policy Confirmation:**  
   Confirm whether Remediation v2.6 should **revoke direct `authenticated` `UPDATE` on `leave_requests`** (enforcing Gateway-RPC-only mutations — recommended highest security posture) OR retain hardened `authenticated` RLS alongside the RPCs for future short-lived Branch JWT support. *(The draft SQL specification includes the recommended RPC-only hardening on `leave_requests` UPDATE and documents the toggle clearly.)*
3. **Gateway Codebase Scope:**  
   Confirm that Branch A operational write tests (`TC-01`..`TC-22`) requiring live HTTP Gateway JWT $\to$ HMAC translation will be executed once the Backend API Gateway service is scaffolded in the workspace (as no application source code exists yet in `D:\Antigravity_Projects\nexus-hr`).
