# NEXUS HR — PHASE 4.2A SECURE PROVISIONING PLAN

**Status:** **PROPOSAL & READINESS PLAN ONLY — AWAITING PROJECT OWNER EXPLICIT AUTHORIZATION**  
**Safety Boundary:** No secrets generated, committed, displayed, or inserted during this phase.

---

## 1. Threat Model & Key Security Requirements

1. **Entropy & Cryptographic Strength:**
   - Secret must be generated using a Cryptographically Secure Pseudo-Random Number Generator (CSPRNG).
   - Minimum entropy: 256 bits (32 random bytes), formatted as a 64-character lowercase hexadecimal string.
2. **Key Identifier:**
   - Canonical `key_id` conforming to `^[A-Za-z0-9._-]{1,64}$` (e.g., `gw-hmac-v1`).
3. **No Hardcoded Literals in Source Code or VCS:**
   - Secret must never be committed to Git, documentation, `.env.example`, or terminal history.
4. **Supabase Vault Risk Avoidance:**
   - Storing the secret in Supabase Vault (`vault.decrypted_secrets`) was evaluated and rejected: `service_role` or database extensions with elevated roles might read Vault secrets directly.
   - The dedicated private schema `nexus_internal.gateway_signing_keys` with `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role` ensures only `SECURITY DEFINER` procedures owned by `postgres` can read the key.
5. **Fail-Closed Verification:**
   - If the key is missing from `nexus_internal.gateway_signing_keys` or Gateway configuration, Gateway operations fail closed (HTTP `503 SIGNING_KEY_UNAVAILABLE` on Gateway, SQLSTATE `42501` on PostgreSQL).

---

## 2. Recommended Provisioning Procedure (For Future Execution)

When the project owner authorizes Phase 4.2B provisioning:

### Step 1: Secure Local Secret Generation (Operator-Side Only)
Run locally in a private terminal session (do not log or output to shared tools):
```bash
# Generates 32 bytes (256-bit) of CSPRNG entropy as 64 hex characters
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```
*Note: Keep this terminal window open; do not save the output to disk.*

### Step 2: Database Key Injection on `nexus-branch-a` (`uneycmbqqpkifwhwzbes`)
The database insert must be performed via Supabase Dashboard SQL Editor (logged in as project owner/postgres) using a single parameterized transaction:

```sql
-- Target Database: nexus-branch-a (uneycmbqqpkifwhwzbes)
-- Execute via Supabase Dashboard -> SQL Editor
BEGIN;

-- Safety assertion: ensure table exists and has 0 active keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'nexus_internal' AND tablename = 'gateway_signing_keys') THEN
        RAISE EXCEPTION 'Table nexus_internal.gateway_signing_keys does not exist.';
    END IF;
END $$;

INSERT INTO nexus_internal.gateway_signing_keys (
    key_id,
    hmac_secret,
    is_active,
    activated_at,
    created_at,
    rotated_at,
    expires_at,
    revoked_at
) VALUES (
    'gw-hmac-v1',
    '[OPERATOR_PASTES_HEX_SECRET_HERE]',
    TRUE,
    now(),
    now(),
    NULL,
    NULL,
    NULL
)
ON CONFLICT (key_id) DO UPDATE SET
    hmac_secret = EXCLUDED.hmac_secret,
    is_active = TRUE,
    activated_at = now(),
    expires_at = NULL,
    revoked_at = NULL;

-- Verification check within transaction
DO $$
DECLARE
    v_cnt INT;
BEGIN
    SELECT count(*) INTO v_cnt
    FROM nexus_internal.gateway_signing_keys
    WHERE key_id = 'gw-hmac-v1' AND is_active = TRUE;

    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'Key insertion verification failed.';
    END IF;
END $$;

COMMIT;
```

### Step 3: Gateway Runtime Environment Configuration
Set the exact same secret in Gateway's private runtime environment (e.g. `.env` file on Gateway server, excluded from Git):
```ini
GATEWAY_ACTOR_HMAC_KEY_ID=gw-hmac-v1
GATEWAY_ACTOR_HMAC_KEY=[OPERATOR_PASTES_SAME_HEX_SECRET_HERE]
```

### Step 4: Verification of Readiness
1. Query `SELECT count(*), is_active FROM nexus_internal.gateway_signing_keys WHERE key_id = 'gw-hmac-v1' GROUP BY is_active;` via read-only SQL (never select `hmac_secret`).
2. Run Gateway startup: verify `GET /health` returns `activeSigningKeyId: "gw-hmac-v1"`.

---

## 3. Zero-Downtime Key Rotation Procedure (Future Operational Runbook)

To rotate from `gw-hmac-v1` to `gw-hmac-v2` without interrupting in-flight requests:

1. **Database Key Ingestion:**
   Insert `gw-hmac-v2` into `nexus_internal.gateway_signing_keys` with `is_active = TRUE`. Update `gw-hmac-v1` with `expires_at = now() + INTERVAL '15 minutes'`.
2. **Gateway Config Update:**
   Configure `GATEWAY_ACTOR_HMAC_KEYS_JSON` containing both keys, with `GATEWAY_ACTOR_HMAC_KEY_ID=gw-hmac-v2`. Gateway starts signing with `gw-hmac-v2` immediately while in-flight `gw-hmac-v1` requests complete during the 15-minute grace period.
3. **Grace Expiration:**
   After 15 minutes, PostgreSQL automatically rejects any `gw-hmac-v1` requests (`expires_at <= now()`). Remove `gw-hmac-v1` from Gateway JSON ring.

---

## 4. Emergency Revocation Procedure

If a key is suspected of compromise:
```sql
UPDATE nexus_internal.gateway_signing_keys
SET is_active = FALSE,
    revoked_at = now()
WHERE key_id = 'gw-hmac-v1';
```
PostgreSQL `verify_gateway_actor()` will reject any envelope using this key immediately with `42501: Gateway HMAC signing key has been revoked`.
