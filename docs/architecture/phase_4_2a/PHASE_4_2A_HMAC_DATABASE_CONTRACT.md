# NEXUS HR — PHASE 4.2A HMAC DATABASE CONTRACT AUDIT

**Target Database:** `nexus-branch-a` (`uneycmbqqpkifwhwzbes`, PostgreSQL 17.11)  
**Schema & Table:** `nexus_internal.gateway_signing_keys`  
**SQL Source File:** `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql` (Lines 86–113)  
**Verification Record:** Verified in Phase 3.13 Stage 2 (`STAGE_2_POST_EXECUTION_VERIFICATION.md`, Check 6)  
**Status:** **AUDITED & VERIFIED (READ-ONLY)**

---

## 1. Table Schema: `nexus_internal.gateway_signing_keys`

Verified catalog structure from SQL v2.7.1 and remote database catalog:

| Column Name | Data Type | Nullable | Default | Description |
|---|---|---|---|---|
| `key_id` | `character varying(64)` | **NO** | *None* | Primary Key. Uniquely identifies the signing key across rotations. |
| `hmac_secret` | `text` | **NO** | *None* | Shared secret for HMAC-SHA256 digest computation (must be `>= 32` bytes). |
| `is_active` | `boolean` | **NO** | `true` | Active status flag. Must be `true` for valid key selection. |
| `activated_at` | `timestamp with time zone` | **NO** | `now()` | Key activation timestamp. |
| `created_at` | `timestamp with time zone` | **NO** | `now()` | Record creation timestamp. |
| `rotated_at` | `timestamp with time zone` | YES | `NULL` | Timestamp when a newer active key took precedence. |
| `expires_at` | `timestamp with time zone` | YES | `NULL` | Timestamp when rotation grace period expires. |
| `revoked_at` | `timestamp with time zone` | YES | `NULL` | Timestamp when the key was revoked (compromised or retired). |

---

## 2. Constraints and Privileges

### Primary Key
- `gateway_signing_keys_pkey`: `PRIMARY KEY (key_id)`

### CHECK Constraints
1. `chk_gateway_signing_key_id_format`:
   `CHECK (((key_id)::text ~ '^[A-Za-z0-9._-]{1,64}$'::text))`
   - Enforces 1–64 characters containing only alphanumeric, dot, underscore, or hyphen.
   - Strictly prohibits pipe delimiters (`|`), whitespace, newlines, and null bytes.
2. `chk_gateway_signing_key_secret_len`:
   `CHECK ((octet_length(hmac_secret) >= 32))`
   - Enforces a minimum entropy of 256 bits (32 octets) for the raw secret string.
3. `chk_gateway_signing_key_state`:
   `CHECK (((revoked_at IS NULL) OR (is_active = false)))`
   - Guarantees that any key with a `revoked_at` timestamp is forced to `is_active = false`.

### Privilege Isolation
- Schema `nexus_internal` has `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`.
- Table `nexus_internal.gateway_signing_keys` has `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`.
- Only `SECURITY DEFINER` functions owned by `postgres` (specifically `nexus_internal.verify_gateway_actor()`) have read access to this table. Neither the Gateway's `service_role` nor any client can read or modify this table directly via PostgREST.

---

## 3. SQL Key Lookup & Verification Behavior

In `nexus_internal.verify_gateway_actor()` (lines 374–392 of `001_branch_a_security_remediation_v2_7_1.sql`):

```sql
SELECT * INTO v_key_rec
FROM nexus_internal.gateway_signing_keys
WHERE key_id = v_norm_key_id;

IF NOT FOUND THEN
    RAISE EXCEPTION '42501: Unknown Gateway HMAC signing key (%).', v_norm_key_id;
END IF;
IF v_key_rec.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION '42501: Gateway HMAC signing key (%) has been revoked.', v_norm_key_id;
END IF;
IF v_key_rec.is_active IS NOT TRUE THEN
    RAISE EXCEPTION '42501: Gateway HMAC signing key (%) is inactive.', v_norm_key_id;
END IF;
IF v_key_rec.expires_at IS NOT NULL AND v_key_rec.expires_at <= now() THEN
    RAISE EXCEPTION '42501: Gateway HMAC signing key (%) grace period has expired.', v_norm_key_id;
END IF;
IF octet_length(v_key_rec.hmac_secret) < 32 THEN
    RAISE EXCEPTION '55000: Gateway HMAC signing key (%) violates 256-bit minimum length.', v_norm_key_id;
END IF;
```

**Key Execution Rules:**
1. **Exact Lookup Only:** Lookup matches `key_id = p_key_id` exactly. There is no fallback to other keys.
2. **Fail-Closed on Empty Table:** When the table is empty (`0` rows), `NOT FOUND` is raised immediately, halting the transaction before signature verification or nonce consumption.
3. **Revocation & Expiry:** Revoked keys and expired grace periods fail with `42501`.
4. **Digest Calculation:**
   - Canonical payload is built using `concat_ws('|', 'v2.7', v_key_rec.key_id, p_action_scope, p_target_id::text, p_operation_mode, p_actor_user_id::text, v_norm_email, p_actor_role, COALESCE(p_branch_id::text, ''), COALESCE(p_employee_id::text, ''), p_exp::text, p_nonce::text)`.
   - Expected digest: `encode(extensions.hmac(convert_to(v_canonical, 'UTF8'), convert_to(v_key_rec.hmac_secret, 'UTF8'), 'sha256'), 'hex')`.
   - Compared against `p_actor_sig` using constant-time digest comparison:
     `encode(extensions.digest(...), 'hex') IS DISTINCT FROM encode(extensions.digest(...), 'hex')`.

---

## 4. Contract Alignment with Gateway (`ActorHmacSigner`)

| Dimension | SQL Contract (`verify_gateway_actor`) | Gateway Contract (`ActorHmacSigner`) | Match |
|---|---|---|---|
| Version Tag | `'v2.7'` | `CANONICAL_ACTOR_PAYLOAD_VERSION = 'v2.7'` | **EXACT** |
| Field Count & Order | 12 fields (version, key_id, scope, target_id, mode, actor_user_id, email, role, branch_id, emp_id, exp, nonce) | 12 fields in identical order via `buildCanonicalActorPayload()` | **EXACT** |
| Key ID Format | `^[A-Za-z0-9._-]{1,64}$` | `KEY_ID_REGEX = /^[A-Za-z0-9._-]{1,64}$/` | **EXACT** |
| Minimum Secret Length | `octet_length(hmac_secret) >= 32` | `Buffer.byteLength(secret, 'utf8') >= 32` | **EXACT** |
| `activatedAt` Lifecycle | Key active check; default `now()` | `isKeyActivated()` validates `activatedAt <= now` | **EXACT** |
| `expiresAt` Grace Window | `expires_at IS NULL OR expires_at > now()` | `expiresAt === null OR Date.parse(expiresAt) > now` | **EXACT** |
| `revokedAt` Immediate Block | `revoked_at IS NULL AND is_active = true` | `revokedAt === null AND isActive = true` | **EXACT** |
| Secret UTF-8 Encoding | `convert_to(v_key_rec.hmac_secret, 'UTF8')` | `Buffer.from(secret, 'utf8')` | **EXACT** |
| RPC Parameter Name | `p_key_id TEXT` | `p_key_id: envelope.keyId` | **EXACT** |
