# Phase 3.12D.2 — PostgreSQL 17 Test & Blocker Report

**Date:** 2026-11-12  
**Status:** **NOT VERIFIED — POSTGRESQL 17 UNAVAILABLE**

---

## 1. Environment Discovery

Executed local checks:
- `where.exe psql docker pg_ctl postgres` -> None found in `PATH`.
- `wsl --list --quiet` -> No PostgreSQL 17 runtime provisioned.
- `C:\Program Files\PostgreSQL\18` -> Directory exists, but `bin\psql.exe` and `bin\pg_ctl.exe` are missing (and PostgreSQL 18 is not PostgreSQL 17).

Per Section 7 ("If PostgreSQL 17 is unavailable: Record NOT VERIFIED. Do not claim success. Do not install untrusted binaries. Continue only with static analysis and produce a separate blocker report."):
- **Zero** SQL statements were executed against a live PostgreSQL 17 engine.

---

## 2. Unexecuted PG17 Test Matrix (Blocked Pending PG17 Environment)

The following 12 required validation suites remain **NOT VERIFIED**:

1. SQL parsing and migration execution (`002_branch_a_schema.sql` + `001_branch_a_security_remediation_v2_7_1.sql`).
2. Fresh-schema execution & idempotent re-run.
3. Upgrade-path execution (`tx_actor_context` pre-existing table without `key_id`, stale vs recent `NULL` rows).
4. `SECURITY DEFINER` behavior & `OWNER TO postgres`.
5. `current_setting('role', true)` and `request.jwt.claims` under simulated PostgREST `authenticator` -> `service_role`.
6. Bit-cast / UUID checks (note: 5% bit-cast nonce sampling was removed in `v2.7.1` per `D1-04`).
7. Function `OWNER TO postgres` and `SET search_path = ..., pg_temp` safety.
8. Trigger execution and deterministic ordering (`trg_01_*`..`trg_05_*`, `BEFORE DELETE`, `BEFORE TRUNCATE`, `AFTER INSERT OR UPDATE OR DELETE`).
9. Effective privilege queries (`service_role`, `authenticated`, `anon`, `PUBLIC`).
10. RPC success and rejection paths (including all 7 `D1-03` `CORRECTION` combinations).
11. Transaction rollback on `P0002` and trigger failures.
12. Central seed and `FOR UPDATE` 4-table rollback (`002_central_seed_and_rollback_v2_7_1.sql` on `001_central_schema.sql`).
