# NEXUS HR — SQL REMEDIATION V2.7 CONTRACT SPECIFICATION

**Baseline Spec:** `docs/architecture/phase_3_12c/` + `gateway/src/`  
**SQL Draft Files:**
- `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql`
- `supabase/remediation/v2.7/002_central_seed_and_rollback_v2_7.sql`

---

## 1. Versioned Canonical HMAC Payload Contract (v2.7)

**Breaking Upgrade from v2.6:**
- **v2.6 (Deprecated, 10 fields):** `action_scope|target_id|operation_mode|actor_user_id|actor_email|actor_role|branch_id|employee_id|exp|nonce`
- **v2.7 (Active, 12 fields):**
  ```text
  v2.7|<key_id>|<action_scope>|<target_id>|<operation_mode>|<actor_user_id>|<actor_email>|<actor_role>|<branch_id>|<employee_id>|<exp>|<nonce>
  ```
- **Compatibility:** Legacy v2.6 10-field envelopes and v2.6 11/20-arg RPC signatures are explicitly dropped and rejected under v2.7. Gateway and SQL v2.7 MUST roll out together.

### Field Normalization Rules (Identical in TypeScript & PostgreSQL)
1. `version`: Literal `'v2.7'`
2. `key_id`: `trim(key_id)`, validated against `^[A-Za-z0-9._-]{1,64}$`
3. `action_scope`: `'LEAVE_DECIDE'` | `'LEAVE_SUPERADMIN_UPDATE'`
4. `target_id`: lowercase UUID string
5. `operation_mode`: `'DECISION'` | `'CORRECTION'`
6. `actor_user_id`: lowercase UUID string
7. `actor_email`: `lower(trim(actor_email))`, rejecting `|`, `\r`, `\n`, `\0`
8. `actor_role`: `'BRANCH_MANAGER'` | `'SUPERADMIN'`
9. `branch_id`: lowercase UUID string or `''` if `NULL`
10. `employee_id`: lowercase UUID string or `''` if `NULL`
11. `exp`: integer Unix epoch seconds string
12. `nonce`: lowercase UUID string

**Secret Representation:** Raw UTF-8 bytes of the identical shared 256-bit+ key string (`Buffer.from(secret, 'utf8')` in Node.js; `convert_to(hmac_secret, 'UTF8')` in PostgreSQL).

---

## 2. Production Key Rotation & Nonce Cleanup Operations

### Key Rotation Lifecycle (`nexus_internal.gateway_signing_keys`)
1. Generate cryptographically random `>= 256-bit` key out-of-band (never commit to Git/migrations).
2. Insert new key (`key_id = 'gw-hmac-v2'`, `is_active = TRUE`, `activated_at = now()`, `expires_at = NULL`, `revoked_at = NULL`).
3. Set `rotated_at = now()` and optional `expires_at = now() + INTERVAL '5 minutes'` on `gw-hmac-v1` while keeping `is_active = TRUE` during grace window.
4. Deploy new key ring to Gateway with `GATEWAY_ACTOR_HMAC_KEY_ID=gw-hmac-v2`. In-flight `v1` requests and new `v2` requests both succeed cleanly.
5. After grace window, revoke `v1` (`UPDATE nexus_internal.gateway_signing_keys SET is_active = FALSE, revoked_at = now() WHERE key_id = 'gw-hmac-v1'`).

### Nonce Maintenance (`nexus_internal.cleanup_expired_actor_nonces`)
- Only expired nonces older than `now() - INTERVAL '5 minutes'` are eligible for cleanup.
- Cleanup runs opportunistically in micro-batches (`LIMIT 50`, `FOR UPDATE SKIP LOCKED`) on ~5% of RPCs AND can be invoked via scheduled `pg_cron` (e.g., `SELECT nexus_internal.cleanup_expired_actor_nonces(500);` every 5 minutes as `postgres`) once approved in production deployment.
- Never scheduled or executed during Phase 3.12C.

---

## 3. Expected Object Inventory (Branch A v2.7)

| Schema | Object | Type | Privileges / Notes |
|---|---|---|---|
| `nexus_internal` | `gateway_signing_keys` | Table | `REVOKE ALL` from `PUBLIC, anon, authenticated, service_role` |
| `nexus_internal` | `used_actor_nonces` | Table | Indexed on `expires_at`; `REVOKE ALL` from app roles |
| `nexus_internal` | `tx_actor_context` | Table | `txid XID8 PK`; `REVOKE ALL` from app roles |
| `nexus_internal` | `cleanup_expired_actor_nonces(INTEGER)` | `SECURITY DEFINER` Function | Owned by `postgres`; `REVOKE ALL` from app roles |
| `nexus_internal` | `verify_gateway_actor(...)` (12 args) | `SECURITY DEFINER` Function | Owned by `postgres`; `REVOKE ALL` from app roles |
| `public` | `rpc_branch_decide_leave_request(...)` (12 args) | `SECURITY DEFINER` Function | `EXECUTE` granted ONLY to `service_role` |
| `public` | `rpc_superadmin_update_leave_request(...)` (24 args) | `SECURITY DEFINER` Function | `EXECUTE` granted ONLY to `service_role` |
| `public` | `enforce_leave_decision_integrity()` | `SECURITY DEFINER` Trigger Fn | Trigger `trg_01_enforce_leave_decision` on `leave_requests` |
| `public` | `leave_deny_direct_update` | `RESTRICTIVE` RLS Policy | `FOR UPDATE TO authenticated USING (FALSE) WITH CHECK (FALSE)` |
| `public` | `trg_01_employees_generate_code` / `_02_` / `_03_` | Triggers on `employees` | Deterministic code -> updated_at -> outbox order |
