# NEXUS HR — PHASE 3.13 EXECUTION REPORT

**Date:** 2026-11-12 (UTC+7)  
**Classification:** **`ALL STAGES SUCCESSFUL`** (`STAGE 3 VERIFIED — PHASE 3 COMPLETE`)  
**Authorized Targets:**
- **Branch A (`nexus-branch-a`):** `uneycmbqqpkifwhwzbes`
- **Central (`nexus-central`):** `wcmevigbqsmzsdqidjel`

**Legacy Projects (`bolt`, `cbt`, `nusantara`):** Untouched / not accessed.

---

## 1. Executive Summary

All authorized Phase 3.13 database migration stages have been executed and independently verified via read-only SQL inspection:
1. **Stage 0 (Preflight):** Verified SHA-256 hashes, PostgreSQL 17.11 versions, and baseline schema/data state on both `uneycmbqqpkifwhwzbes` and `wcmevigbqsmzsdqidjel`.
2. **Stage 1 (Branch A v2.7.2 Compatibility):** Applied `000_branch_a_config_compatibility_v2_7_2.sql` on `uneycmbqqpkifwhwzbes` and verified `public.branch_config.is_active` (`boolean NOT NULL DEFAULT true`, row value `true`).
3. **Stage 2 (Branch A v2.7.1 Security Remediation):** Executed `001_branch_a_security_remediation_v2_7_1.sql` on `uneycmbqqpkifwhwzbes` via Supabase Dashboard SQL Editor (after MCP client confirmation auto-cancellation) and verified all 8 security/schema/privilege checks in `STAGE_2_POST_EXECUTION_VERIFICATION.md`.
4. **Stage 3 (Central Branch Seed):** Executed lines 9–64 (seed block only) of `002_central_seed_and_rollback_v2_7_1.sql` on `wcmevigbqsmzsdqidjel` via Supabase Dashboard SQL Editor (rollback block lines 66–116 excluded) and verified all 4 uniqueness, constraint, and cross-DB consistency checks in `STAGE_3_CENTRAL_SEED_VERIFICATION.md`.

No production HMAC secrets were provisioned, no live leave mutations were performed, and the Gateway has not been deployed.

---

## 2. File Integrity Verification (SHA-256)

| File | SHA-256 |
|---|---|
| `supabase/remediation/v2.7.2/000_branch_a_config_compatibility_v2_7_2.sql` | `B7D9FA212BCC09561E61E8C9B17212CCF29F16DFCDBD272AB25336BDBD702F07` |
| `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql` | `10394258BA64D8F1B1DA5847C5D3349209291FF384063F7EB03D2E2DCBFDE756` |
| `supabase/remediation/v2.7.1/002_central_seed_and_rollback_v2_7_1.sql` | `C4A9742D7030D4BDD93C7E0487F03EE9827DC27EABF691A976F6C559ED69DE54` |

---

## 3. Stage-by-Stage Execution & Verification Summary

### Stage 0 — Read-Only Preflight (`PASSED`)
- **Branch A (`uneycmbqqpkifwhwzbes`):** PostgreSQL 17.11, `branch_config_rows = 1`, `has_nexus_internal = false`, `employees_cnt = 0`, `leave_requests_cnt = 0`, `audit_logs_cnt = 0`.
- **Central (`wcmevigbqsmzsdqidjel`):** PostgreSQL 17.11, `branches_cnt = 0`, `user_profiles_cnt = 0`, `emp_dir_cnt = 0`.

### Stage 1 — Branch A Compatibility (`000_branch_a_config_compatibility_v2_7_2.sql`) (`EXECUTED & VERIFIED`)
- **Target:** `uneycmbqqpkifwhwzbes` (`nexus-branch-a`)
- **Result:** Committed cleanly (`2026-11-12T22:04:59+07:00`–`22:05:08+07:00`).
- **Verification:** `public.branch_config` has 1 row (`00000000-0000-0000-0000-000000000001`, `BRANCH-A`, `Branch A - Jakarta`, `Asia/Jakarta`, `is_active = true`); `is_active` is `boolean NOT NULL DEFAULT true`.

### Stage 2 — Branch A Security Remediation (`001_branch_a_security_remediation_v2_7_1.sql`) (`EXECUTED & VERIFIED`)
- **Target:** `uneycmbqqpkifwhwzbes` (`nexus-branch-a`)
- **Execution:** Executed via Supabase Dashboard → SQL Editor after MCP auto-cancellation.
- **Verification (`2026-11-12T22:26:32+07:00`–`22:27:04+07:00`, see `STAGE_2_POST_EXECUTION_VERIFICATION.md`):**
  - `nexus_internal` schema and `gateway_signing_keys`, `used_actor_nonces`, `tx_actor_context` tables exist and deny access to `anon`, `authenticated`, and `service_role`.
  - `verify_gateway_actor` & `cleanup_expired_actor_nonces` deny `EXECUTE` to all application roles; `rpc_branch_decide_leave_request` & `rpc_superadmin_update_leave_request` grant `EXECUTE` only to `service_role`.
  - `leave_requests`: `service_role` has `SELECT` only; `authenticated` has `SELECT` + `INSERT` only (`leave_deny_direct_update` RESTRICTIVE policy active).
  - `audit_logs`: `service_role` and `authenticated` have `SELECT` only.
  - All decision, audit (`INSERT`/`UPDATE`/`DELETE`), `DELETE`/`TRUNCATE` guards, and ordered `employees` triggers (`trg_01` → `trg_02` → `trg_03`) verified active.
  - `tx_actor_context.key_id` is `character varying(64) NOT NULL`; `seq_branch_a_employee_code` is `MAXVALUE 999999999999 NO CYCLE`; RLS enabled on all 10 `public` tables; `gateway_signing_keys` structure & 3 CHECK constraints verified (`0` rows).

### Stage 3 — Central Branch Seed (`002_central_seed_and_rollback_v2_7_1.sql`, Lines 9–64) (`EXECUTED & VERIFIED`)
- **Target:** `wcmevigbqsmzsdqidjel` (`nexus-central`)
- **Execution:** Executed via Supabase Dashboard → SQL Editor (rollback block lines 66–116 excluded).
- **Verification (`2026-11-12T22:30:28+07:00`–`22:30:38+07:00`, see `STAGE_3_CENTRAL_SEED_VERIFICATION.md`):**
  - Exactly 1 row in `public.branches`: `id = 00000000-0000-0000-0000-000000000001`, `code = 'BRANCH-A'`, `name = 'Branch A - Jakarta'`, `timezone = 'Asia/Jakarta'`, `is_active = true`, `address IS NULL`, `phone_number IS NULL`.
  - `branches_pkey` (`PRIMARY KEY (id)`) and `uq_branches_code` (`UNIQUE (code)`) intact; `user_profiles = 0`, `employee_directory = 0`.
  - 100% cross-database consistency confirmed against `nexus-branch-a.public.branch_config`.

---

## 4. Phase 3 Completion Status

**`ALL STAGES SUCCESSFUL — STAGE 3 VERIFIED — PHASE 3 COMPLETE`**
