# Phase 3.12D.1 — PostgreSQL 17 Validation Report

**Date:** 2026-11-12  
**Project:** NEXUS HR  
**Status:** **NOT VERIFIED** (No local PostgreSQL 17 / `psql` / Docker runtime available)  
**Scope:** Local disposable PostgreSQL 17 syntax, DDL, PL/pgSQL, security, and rollback validation of `supabase/remediation/v2.7/`

---

## 1. Local Environment Availability Check

An environment check was executed via `where.exe psql docker pg_ctl postgres` and `Get-Service *postgres*`:

- **`psql`**: Not installed / not in `PATH`
- **`docker`**: Not installed / not in `PATH`
- **`pg_ctl` / `postgres`**: Not installed / not in `PATH`
- **Windows Postgres Services (`*postgres*`)**: None installed

**Result:** No local PostgreSQL 17 or container runtime is available in this environment. Consequently, **zero** SQL statements from `001_branch_a_security_remediation_v2_7.sql` or `002_central_seed_and_rollback_v2_7.sql` have been parsed or executed against a live PostgreSQL 17 engine.

---

## 2. Static Syntax & Compatibility Risk Areas Identified (`D1-05`)

While full engine execution is **NOT VERIFIED**, static inspection of `001_branch_a_security_remediation_v2_7.sql` (lines 1–1140) and `002_central_seed_and_rollback_v2_7.sql` (lines 1–115) highlights specific PostgreSQL 17 / Supabase-emulation behaviors that MUST be tested in a disposable PG17 instance before any remote execution:

1. **Nested `SECURITY DEFINER` Role Context (`001_branch_a_security_remediation_v2_7.sql:L236`):**
   - `verify_gateway_actor()` inspects `current_setting('role', true)`.
   - Must verify in PG17 whether `SET LOCAL ROLE service_role` / PostgREST `request.jwt.claim.role` semantics interact as expected inside nested `SECURITY DEFINER` functions with `SET search_path = nexus_internal, public, pg_temp`.
2. **UUID-to-Advisory-Lock Bit-Cast Expression (`001_branch_a_security_remediation_v2_7.sql:L358`):**
   - Expression: `('x' || substr(replace(p_nonce::text, '-', ''), 1, 8))::bit(32)::bigint`
   - Must verify PG17 hex string `bit(32)` cast and `::bigint` conversion across arbitrary UUIDv4 values (including high-bit-set hex prefixes `8`–`f`).
3. **Function Overload Drop & Recreation Order:**
   - Must verify clean execution on both (a) fresh `002_branch_a_schema.sql` baseline and (b) upgraded pre-v2.7 state without `cannot change return type of existing function` or dependent-policy errors.
4. **`tx_actor_context` Upgrade Path (`D1-02`, `001_branch_a_security_remediation_v2_7.sql:L115-L130`):**
   - Must verify upgrade from an existing `nexus_internal.tx_actor_context` table lacking `key_id` vs fresh creation.
5. **Central Seed & Rollback (`002_central_seed_and_rollback_v2_7.sql:L1-L115`):**
   - Must verify `FOR UPDATE` locking and rollback restoration behavior on `nexus-central` baseline schema (`001_central_schema.sql`).

---

## 3. Required Disposable PG17 Verification Suite (For Phase 3.12D.2 / Pre-Execution)

Before remote execution is authorized, the following must be executed and observed passing on an isolated disposable PostgreSQL 17 instance:

1. Apply `002_branch_a_schema.sql` -> apply `001_branch_a_security_remediation_v2_7.sql` (and re-run idempotently).
2. Apply `001_central_schema.sql` -> apply `002_central_seed_and_rollback_v2_7.sql` -> test rollback script.
3. Run privilege & RLS negative tests as `anon`, `authenticated`, `service_role`, and `sync_worker` (including verifying `D1-01` remediation once patched in v2.7.1/v2.8).
4. Run HMAC verification, expired `exp`, replay nonce, wrong `key_id`, revoked `key_id`, and `tx_actor_context` cleanup tests.
5. Run `BRANCH_MANAGER` self-approval denial, non-`PENDING` denial, and `SUPERADMIN` `CORRECTION` transition tests.

---

## 4. Conclusion

**PostgreSQL 17 Validation Status: NOT VERIFIED.**  
Tracked as blocking verification finding **`D1-05`**.
