# Phase 3.12D.3 — Findings and Recommendations

**Date:** 2026-11-12  
**Audit Scope:** `supabase/remediation/v2.7.1/` & `gateway/src/`

---

## 1. Summary

- **Critical / High / Medium Blocking Findings:** **0**
- **Low / Informational Parity Observations:** **1 (`D3-01`)**
- **Verification Blockers (External Runtime):** **1 (`D3-02` — PostgreSQL 17 unavailable locally)**

---

## 2. Detailed Findings

### `D3-01` — `SUPERADMIN` Assigned a Non-Branch-A `branch_id` in Central `user_profiles` Fails Closed at Branch A
- **Finding ID:** `D3-01`
- **Severity:** **LOW (Informational / Operational Parity Note)**
- **Exact File & Line Number:**
  - `gateway/src/auth/identity-resolver.ts:L47-L60, L83`
  - `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql:L460-L462`
- **Evidence:** `IdentityResolver.resolveActor()` skips the `expectedBranchAId` check when `isEnterpriseRole` (`SUPERADMIN` or `CENTRAL_HR`) is true (`L47-L60`), forwarding `profile.branch_id` unchanged (`L83`). Meanwhile, `verify_gateway_actor()` (`L460-L462`) rejects any non-NULL `p_branch_id` that is distinct from Branch A (`00000000-0000-0000-0000-000000000001`) with `42501`.
- **Exploit / Failure Scenario:** Not a security vulnerability (fails closed with `403 FORBIDDEN`). However, if a `SUPERADMIN` account in Central `user_profiles` has `branch_id` set to a different branch (e.g., Branch B) rather than `NULL` or Branch A, Branch A admin RPCs will be rejected until `branch_id` is `NULL` or Branch A.
- **Impact:** Potential operational rejection for misconfigured `SUPERADMIN` profiles; zero unauthorized access risk.
- **Required Remediation:** Non-blocking. Either ensure `SUPERADMIN` profiles in Central have `branch_id IS NULL` (enterprise-wide) or normalize `branchId: isEnterpriseRole ? null : resolvedBranchId` in a future Gateway maintenance update if cross-branch `SUPERADMIN` profiles are ever introduced.
- **PostgreSQL 17 Execution Required to Verify?:** **No** (verified statically; runtime test optional).

---

### `D3-02` — PostgreSQL 17 Execution Environment Unavailable Locally
- **Finding ID:** `D3-02`
- **Severity:** **MEDIUM (Execution Verification Gap)**
- **Exact File & Line Number:** `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql:L1-L1300`, `002_central_seed_and_rollback_v2_7_1.sql:L1-L115`
- **Evidence:** Local environment check (`where.exe psql docker pg_ctl postgres`) confirmed no PostgreSQL 17 or Docker runtime is installed.
- **Exploit / Failure Scenario:** Unexecuted DDL/PLpgSQL cannot be guaranteed error-free at runtime until tested on a live PostgreSQL 17 instance.
- **Impact:** Blocks migration execution authorization until a disposable PG17 validation run completes, though it does **not** block read-only remote preflight (`Phase 3.12E`).
- **Required Remediation:** Execute the 12-part PG17 validation suite on an isolated disposable PostgreSQL 17 instance before any remote migration execution.
- **PostgreSQL 17 Execution Required to Verify?:** **Yes** (`NOT VERIFIED — POSTGRESQL 17 UNAVAILABLE`).
