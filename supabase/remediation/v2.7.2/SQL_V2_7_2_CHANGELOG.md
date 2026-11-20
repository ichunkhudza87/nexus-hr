# SQL Compatibility Remediation v2.7.2 — Changelog

**Date:** 2026-11-12  
**Target:** Branch A (`uneycmbqqpkifwhwzbes`)  
**Resolves:** Phase 3.12E Finding `E-01`

---

## Summary of Changes

- Added [`000_branch_a_config_compatibility_v2_7_2.sql`](file:///D:/Antigravity_Projects/nexus-hr/supabase/remediation/v2.7.2/000_branch_a_config_compatibility_v2_7_2.sql):
  - Runs **before** `001_branch_a_security_remediation_v2_7_1.sql`.
  - Verifies `public.branch_config` exists and contains exactly 1 canonical `BRANCH-A` singleton row (`00000000-0000-0000-0000-000000000001`).
  - Adds `is_active BOOLEAN NOT NULL DEFAULT TRUE` if missing, or validates `boolean` type, backfills `NULL` to `TRUE` (preserving explicit `FALSE`), and enforces `DEFAULT TRUE` + `NOT NULL` if already present.
  - Verifies catalog attributes (`boolean`, `NOT NULL`, `DEFAULT true`) and confirms no unrelated `branch_config` fields were altered.
- Preserved all baseline migrations, `v2.7` drafts, and `v2.7.1` scripts unmodified.
