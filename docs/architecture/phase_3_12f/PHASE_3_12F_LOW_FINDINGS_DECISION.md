# Phase 3.12F — Decisions on Phase 3.12E.2 Low Findings (`E2-01` & `E2-02`)

**Date:** 2026-11-12

---

## 1. `E2-01` — Snapshot Query Precedes `ACCESS EXCLUSIVE` Lock Without `FOR UPDATE`

- **Source:** `000_branch_a_config_compatibility_v2_7_2.sql:L36-L44, L66`
- **Analysis:** `SELECT ... INTO v_before` reads `public.branch_config` before `ALTER TABLE` acquires `ACCESS EXCLUSIVE`. If a concurrent `UPDATE` modifies a baseline column between `L44` and `L66`, the post-check `v_after IS DISTINCT FROM v_before` (`L111-L117`) raises an exception and rolls back the entire transaction cleanly (zero silent corruption). Furthermore, Stage 1 runs in a controlled maintenance window on a 1-row config table.
- **Decision:** **Documented low-risk limitation — NO SQL code change required before execution.**

---

## 2. `E2-02` — Rollback `DROP COLUMN is_active` Discards Post-Deployment `FALSE` State

- **Source:** `supabase/remediation/v2.7.2/SQL_V2_7_2_ROLLBACK_PLAN.md:L15-L16`
- **Analysis:** Dropping `public.branch_config.is_active` would erase any operational `is_active = FALSE` deactivation state set after deployment, and would break `v2.7.1` if `v2.7.1` is still installed.
- **Decision:** **Adjust operational rollback strategy in Phase 3.12F (`PHASE_3_12F_ROLLBACK_AND_RECOVERY_PLAN.md`) without modifying existing `v2.7.2` SQL:**
  - During any partial rollback, **preserve `public.branch_config.is_active`**.
  - Only drop `is_active` if explicitly reverting all the way back to the pre-`v2.7.2` baseline schema after Stage 2 (`v2.7.1`) has already been rolled back.
