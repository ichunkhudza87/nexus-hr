# NEXUS HR — PHASE 3.12D.1 HMAC & ACTOR CONTEXT AUDIT

**Inspected Sources:**
- `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql` (L73-448, L512-718, L750-977)
- `gateway/src/security/hmac-signer.ts` (L1-190)

---

## 1. Canonical Payload & HMAC-SHA256 Verification (Section 3D)

| Check | Gateway (`hmac-signer.ts`) | SQL v2.7 (`verify_gateway_actor()`) | Verdict |
|---|---|---|---|
| Field ordering (12 fields) | `v2.7\|keyId\|actionScope\|targetId\|operationMode\|actorUserId\|actorEmail\|actorRole\|branchId\|employeeId\|exp\|nonce` | `concat_ws('\|', 'v2.7', v_key_rec.key_id, p_action_scope, p_target_id::text, p_operation_mode, p_actor_user_id::text, v_norm_email, p_actor_role, COALESCE(p_branch_id::text, ''), COALESCE(p_employee_id::text, ''), p_exp::text, p_nonce::text)` (`L322-335`) | **MATCH** |
| UTF-8 encoding | `Buffer.from(..., 'utf8')` | `convert_to(..., 'UTF8')` (`L338`) | **MATCH** |
| UUID normalization | `.trim().toLowerCase()` | `UUID::text` (PostgreSQL always formats lowercase hyphenated UUIDs) | **MATCH** |
| Email normalization | `.trim().toLowerCase()`, rejects `\|,\r,\n,\0` | `lower(btrim(COALESCE(p_actor_email, '')))`, rejects `~ '[\|\r\n]'` (`L266-269`) | **MATCH** |
| Empty string vs NULL | `branchId ? ... : ''`, `employeeId ? ... : ''` | `COALESCE(p_branch_id::text, '')`, `COALESCE(p_employee_id::text, '')` | **MATCH** |
| Expiration & TTL | `String(exp)` (`<= 120s`) | `p_exp::text`, `p_exp >= v_now_epoch` and `(p_exp - v_now_epoch) <= 120` (`L291-297`) | **MATCH** |
| Key ID handling | `^[A-Za-z0-9._-]{1,64}$`, exact `keys.get(keyId)` lookup, no fallback | `~ '^[A-Za-z0-9._-]{1,64}$'`, exact `WHERE key_id = v_norm_key_id`, no fallback (`L246, L300-318`) | **MATCH** |
| Key lifecycle checks | Rejects unknown, `!isActive`, `revokedAt !== null`, `expiresAt <= now` | Rejects `NOT FOUND`, `revoked_at IS NOT NULL`, `is_active IS NOT TRUE`, `expires_at <= now()`, `< 32` bytes (`L304-318`) | **MATCH** |
| Digest equality | `timingSafeEqual(expectedBuf, actualBuf)` | `encode(extensions.digest(convert_to(v_expected_hex, 'UTF8'), 'sha256'), 'hex') IS DISTINCT FROM ...` (`L342-344`) | **MATCH** |

---

## 2. HMAC Key Provisioning Isolation (Section 3E)

- **Readable Roles:** ONLY `postgres` (table owner, `SECURITY DEFINER` function owner) can read `nexus_internal.gateway_signing_keys`.
- **Sync Worker / `service_role`:** `REVOKE ALL ON SCHEMA nexus_internal`, `REVOKE ALL ON TABLE nexus_internal.gateway_signing_keys`, and `ALTER DEFAULT PRIVILEGES` ensure neither Sync Worker nor PostgREST `service_role` can read `hmac_secret` via REST or SQL.
- **Controlled Provisioning / Rotation:** Out-of-band administrative SQL execution as `postgres` (never committed in VCS/migrations) can `INSERT` new keys, set `rotated_at`/`expires_at` on grace-window keys, and set `is_active = FALSE, revoked_at = now()` for immediate revocation without exposing secrets to logs or PostgREST.

---

## 3. Actor Context, `pg_current_xact_id()` & Nonce Ledger (Section 3F, 3H)

- **Atomic Nonce Claim (`L349-356`):** `INSERT INTO nexus_internal.used_actor_nonces ... ON CONFLICT (nonce) DO NOTHING RETURNING nonce` atomically allows at most one concurrent transaction to claim a given UUID nonce; a second concurrent call fails with `42501: Replayed Gateway actor credential`.
- **Transaction Isolation (`L418-436`):** `pg_current_xact_id()` returns a unique 64-bit `XID8` per transaction, isolating concurrent transactions in `nexus_internal.tx_actor_context`. Context is deleted on both normal RPC return (`L803`, `L955`) and `EXCEPTION WHEN OTHERS` (`L807`, `L959`).
- **Exception Rollback:** Any failure in `UPDATE` or triggers rolls back the transaction (including `tx_actor_context` and `used_actor_nonces`). Note `D1-04`: `P0002` target-not-found check at `L408-415` also rolls back the nonce claim.
- **Can Untrusted SQL Fabricate Context?** No — `nexus_internal.tx_actor_context` has `REVOKE ALL` from `PUBLIC, anon, authenticated, service_role`, and `verify_gateway_actor()` has `REVOKE ALL` from all non-`postgres` roles.
- **Bounded Nonce Cleanup (`L142-190`):** `cleanup_expired_actor_nonces(p_batch_size)` clamps batch `1..1000`, deletes only rows with `expires_at < now() - INTERVAL '5 minutes'` using `ORDER BY expires_at ASC LIMIT v_limit FOR UPDATE SKIP LOCKED`, never deletes unexpired nonces, and cannot be executed by `service_role`/`authenticated`/`anon`/`PUBLIC`.
- **PG17 Verification Note (`D1-06`):** `current_setting('role', true)` inside `SECURITY DEFINER` under PostgREST `authenticator` -> `SET LOCAL ROLE service_role` and `('x' || ...)::bit(32)::bigint` modulo expression (`L358`) require live PG17 confirmation.
