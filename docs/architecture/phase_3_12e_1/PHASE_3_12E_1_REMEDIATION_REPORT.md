# Phase 3.12E.1 — Targeted SQL Compatibility Remediation Report (v2.7.2)

**Date:** 2026-11-12  
**Project:** NEXUS HR (`D:\Antigravity_Projects\nexus-hr`)  
**Mode:** STRICTLY LOCAL-ONLY  
**Resolves:** Phase 3.12E Finding `E-01` (`public.branch_config.is_active` missing on `nexus-branch-a`)

---

## 1. Exact Files Created

- `supabase/remediation/v2.7.2/000_branch_a_config_compatibility_v2_7_2.sql` (`SHA-256: B7D9FA212BCC09561E61E8C9B17212CCF29F16DFCDBD272AB25336BDBD702F07`)
- `supabase/remediation/v2.7.2/SQL_V2_7_2_CHANGELOG.md`
- `supabase/remediation/v2.7.2/SQL_V2_7_2_COMPATIBILITY_CONTRACT.md`
- `supabase/remediation/v2.7.2/SQL_V2_7_2_ROLLBACK_PLAN.md`
- `supabase/remediation/v2.7.2/SQL_V2_7_2_VALIDATION_RESULTS.md`
- `docs/architecture/phase_3_12e_1/PHASE_3_12E_1_REMEDIATION_REPORT.md`
- `docs/architecture/phase_3_12e_1/PHASE_3_12E_1_COMPATIBILITY_AUDIT.md`
- `docs/architecture/phase_3_12e_1/PHASE_3_12E_1_READINESS_DECISION.md`

---

## 2. Exact SQL Behavior (`000_branch_a_config_compatibility_v2_7_2.sql`)

1. Runs in a single `BEGIN; ... COMMIT;` transaction **before** `001_branch_a_security_remediation_v2_7_1.sql`.
2. Verifies `public.branch_config` exists, contains **exactly 1 row**, and has canonical identity `id = '00000000-0000-0000-0000-000000000001'::uuid` and `branch_code = 'BRANCH-A'` (snapshots all 6 baseline columns into `v_before`).
3. Checks `pg_attribute` for `is_active`:
   - If absent: executes `ALTER TABLE public.branch_config ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE`.
   - If present: rejects non-`boolean` types, backfills `NULL` to `TRUE` (`WHERE is_active IS NULL`, preserving any explicit `FALSE`), and enforces `DEFAULT TRUE` + `NOT NULL`.
4. Post-check verifies row count = `1`, all 6 baseline columns unchanged, and `pg_attribute` + `pg_attrdef` confirm `boolean`, `NOT NULL`, and `DEFAULT true`.

---

## 3. Preserved Unmodified Files (Verified SHA-256)

- `supabase/migrations/001_central_schema.sql`: `02447A8F2923ED49235DDD77D5EED33D47B0E023F0108A6495BDD7CC1C9C0260`
- `supabase/migrations/002_branch_a_schema.sql`: `F1C8960FA8504E6AC9DD134FAC9BE68768DBDAF33FAED4A5B3F402D541874EC1`
- `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql`: `7F062E115B7A680C9913579072B3BE1694F374F6EA4E7988D0363E38C4EC5CB4`
- `supabase/remediation/v2.7/002_central_seed_and_rollback_v2_7.sql`: `8C60141CF1660F7E2D3102590A07586C6824E8647EEBA99F5DED0E13F8A6DB81`
- `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql`: `10394258BA64D8F1B1DA5847C5D3349209291FF384063F7EB03D2E2DCBFDE756`
- `supabase/remediation/v2.7.1/002_central_seed_and_rollback_v2_7_1.sql`: `C4A9742D7030D4BDD93C7E0487F03EE9827DC27EABF691A976F6C559ED69DE54`
