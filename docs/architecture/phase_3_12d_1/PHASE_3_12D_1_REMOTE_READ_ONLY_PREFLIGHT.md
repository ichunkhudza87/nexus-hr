# Phase 3.12D.1 — Remote Read-Only Preflight Report

**Date:** 2026-11-12  
**Project:** NEXUS HR  
**Status:** **NOT EXECUTED / NOT VERIFIED** (Stopped per Project Reference Discrepancy & Strict Safety Boundaries)

---

## 1. Strict Safety Boundary Compliance

Per Phase 3.12D.1 Section 1 & Section 8:
- **Zero** SQL statements were executed against `nexus-central` (`wcmevigbqsmzsdqidjel`) or `nexus-branch-a`.
- **Zero** remote Supabase RPCs were called.
- **Zero** legacy projects (`bolt`, `cbt`, `nusantara`) were accessed or inspected.

---

## 2. Project Reference Discrepancy (`D1-06`)

During preflight validation, a discrepancy was identified in the **Branch A** Supabase project reference:

| Source | Branch A Project Reference |
| :--- | :--- |
| Phase 3.12D.1 Prompt Section 5 | `uneycmbpkifwhwzbes` *(missing `qq`)* |
| `001_branch_a_security_remediation_v2_7.sql:L3` | `uneycmbqqpkifwhwzbes` |
| `002_branch_a_schema.sql:L3` | `uneycmbqqpkifwhwzbes` |
| `.env.example:L31` | `uneycmbqqpkifwhwzbes` |
| Prior Phases (3.7–3.12A) | `uneycmbqqpkifwhwzbes` |

**Action Taken:** Stopped immediately without attempting any remote connection or preflight query, per Section 5 instructions to stop and report any project reference discrepancy.

---

## 3. Read-Only Connection Eligibility

Even after confirming the canonical Branch A project reference (`uneycmbqqpkifwhwzbes`), no verified read-only remote database connection is currently configured for preflight execution in this session:
- `supabase_mcp` `execute_sql` is read-write capable and is **prohibited** under Phase 3.12D.1 Section 1 ("You MUST NOT: Execute SQL against `nexus-central` / `nexus-branch-a`").

---

## 4. Required Remote Preflight Checks (Deferred Pending Ref Confirmation & Read-Only Connection)

Once the owner confirms `uneycmbqqpkifwhwzbes` and authorizes a read-only inspection phase, preflight should verify:
1. Current deployed schemas (`public`, `nexus_internal`), tables, triggers, and functions on `nexus-branch-a` (`uneycmbqqpkifwhwzbes`) and `nexus-central` (`wcmevigbqsmzsdqidjel`).
2. Whether `nexus_internal.tx_actor_context` already exists without `NOT NULL` on `key_id` (relevant to `D1-02`).
3. Current `service_role` and `authenticated` table privileges on `public.leave_requests` and `public.audit_logs`.
4. Presence of `BRANCH-A` seed rows in `nexus-central`.

---

## 5. Conclusion

**Remote Read-Only Preflight Status: NOT EXECUTED / NOT VERIFIED.**  
Tracked as blocking preflight finding **`D1-06`**.
