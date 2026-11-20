# SQL Remediation v2.7.1 — Validation Results

**Date:** 2026-11-12  
**PostgreSQL 17 Execution Status:** **NOT VERIFIED — POSTGRESQL 17 UNAVAILABLE**

---

## 1. Environment Check Results

- `where.exe psql docker pg_ctl postgres`: Not found in `PATH`.
- `C:\Program Files\PostgreSQL\18`: Directory exists, but `bin\psql.exe` and `bin\pg_ctl.exe` are not present (and PG18 is not PG17).
- **Conclusion:** No isolated disposable PostgreSQL 17 instance or Docker runtime is available in this environment.

---

## 2. Static Validation Summary

| Check | Status | Notes |
| :--- | :--- | :--- |
| `D1-01` `service_role` direct DML & `DELETE`/`TRUNCATE` defense | **Remediated in SQL (Static)** | Live PG17 negative test **NOT VERIFIED** |
| `D1-02` `tx_actor_context.key_id` `NOT NULL` upgrade + assertion | **Remediated in SQL (Static)** | Live PG17 upgrade test **NOT VERIFIED** |
| `D1-03` `SUPERADMIN` `CORRECTION` approval metadata rule | **Remediated in SQL (Static)** | Live PG17 transition matrix **NOT VERIFIED** |
| `D1-04` Nonce cleanup moved out of RPC path | **Remediated in SQL (Static)** | Live PG17 concurrency test **NOT VERIFIED** |
| `002_central_seed_and_rollback_v2_7_1.sql` | **Reviewed (Static)** | Live PG17 seed + rollback **NOT VERIFIED** |
| PostgreSQL 17 DDL/PLpgSQL execution | **NOT VERIFIED** | Blocked on absent local PG17 / Docker |

---

## 3. Artifact Integrity (SHA-256)

| File | SHA-256 | Status |
| :--- | :--- | :--- |
| `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql` | `10394258BA64D8F1B1DA5847C5D3349209291FF384063F7EB03D2E2DCBFDE756` | Created (new) |
| `supabase/remediation/v2.7.1/002_central_seed_and_rollback_v2_7_1.sql` | `C4A9742D7030D4BDD93C7E0487F03EE9827DC27EABF691A976F6C559ED69DE54` | Created (new) |
| `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql` | `7F062E115B7A680C9913579072B3BE1694F374F6EA4E7988D0363E38C4EC5CB4` | Preserved unmodified |
| `supabase/remediation/v2.7/002_central_seed_and_rollback_v2_7.sql` | `8C60141CF1660F7E2D3102590A07586C6824E8647EEBA99F5DED0E13F8A6DB81` | Preserved unmodified |
| `supabase/migrations/001_central_schema.sql` | `02447A8F2923ED49235DDD77D5EED33D47B0E023F0108A6495BDD7CC1C9C0260` | Preserved unmodified |
| `supabase/migrations/002_branch_a_schema.sql` | `F1C8960FA8504E6AC9DD134FAC9BE68768DBDAF33FAED4A5B3F402D541874EC1` | Preserved unmodified |
