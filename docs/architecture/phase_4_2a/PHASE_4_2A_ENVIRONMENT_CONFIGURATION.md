# NEXUS HR — PHASE 4.2A ENVIRONMENT CONFIGURATION SPECIFICATION

**Target File:** `.env` (Excluded from Git; reference `.env.example`)  
**Status:** **SPECIFICATION & VERIFICATION ONLY — NO REAL SECRETS COMMIT**

---

## 1. Full Environment Configuration Matrix

```ini
# ==========================================
# NEXUS HR — ENVIRONMENT CONFIGURATION
# Distributed Two-Node PostgreSQL Setup
# ==========================================

# Application Runtime
NODE_ENV=production
APP_TIMEZONE=Asia/Jakarta
PORT=3000

# ------------------------------------------
# NODE 1 — CENTRAL DATABASE (nexus-central)
# ------------------------------------------
# Project Ref: wcmevigbqsmzsdqidjel
SUPABASE_CENTRAL_URL=https://wcmevigbqsmzsdqidjel.supabase.co
SUPABASE_CENTRAL_ANON_KEY=[OPERATOR_SETS_CENTRAL_ANON_KEY]
SUPABASE_CENTRAL_SERVICE_ROLE_KEY=[OPERATOR_SETS_CENTRAL_SERVICE_ROLE_KEY]

# ------------------------------------------
# NODE 2 — BRANCH A DATABASE (nexus-branch-a)
# ------------------------------------------
# Project Ref: uneycmbqqpkifwhwzbes
SUPABASE_BRANCH_A_URL=https://uneycmbqqpkifwhwzbes.supabase.co
SUPABASE_BRANCH_A_ANON_KEY=[OPERATOR_SETS_BRANCH_A_ANON_KEY]
SUPABASE_BRANCH_A_SERVICE_ROLE_KEY=[OPERATOR_SETS_BRANCH_A_SERVICE_ROLE_KEY]

# ------------------------------------------
# CENTRAL AUTH & JWKS VERIFICATION
# ------------------------------------------
CENTRAL_JWKS_URL=https://wcmevigbqsmzsdqidjel.supabase.co/auth/v1/.well-known/jwks.json
CENTRAL_JWT_ISSUER=https://wcmevigbqsmzsdqidjel.supabase.co/auth/v1
CENTRAL_JWT_AUDIENCE=authenticated
JWKS_CACHE_TTL_SECONDS=300
JWT_CLOCK_SKEW_SECONDS=5

# ------------------------------------------
# BRANCH A CANONICAL IDENTITY
# ------------------------------------------
BRANCH_A_ID=00000000-0000-0000-0000-000000000001
BRANCH_A_CODE=BRANCH-A

# ------------------------------------------
# CORS POLICY
# ------------------------------------------
# Comma-separated list of allowed origins. Wildcard '*' is strictly prohibited.
# Example: https://app.nexus.local,https://admin.nexus.local
CORS_ALLOWED_ORIGINS=

# ------------------------------------------
# HMAC v2.7 CRYPTOGRAPHIC SIGNING KEY
# ------------------------------------------
# Out-of-band 256-bit CSPRNG secret (matches nexus_internal.gateway_signing_keys)
GATEWAY_ACTOR_HMAC_KEY_ID=gw-hmac-v1
GATEWAY_ACTOR_HMAC_KEY=[OPERATOR_SETS_256BIT_HEX_SECRET]
GATEWAY_ACTOR_TTL_SECONDS=60
GATEWAY_REQUEST_TIMEOUT_MS=5000
```

---

## 2. Configuration Validation Invariants (`src/config/env.ts`)

1. **Protocol Constraint:** Both `SUPABASE_CENTRAL_URL` and `SUPABASE_BRANCH_A_URL` must use `https:` in production environments (non-localhost `http:` is immediately rejected).
2. **Secret Entropy:** `GATEWAY_ACTOR_HMAC_KEY` must have `Buffer.byteLength(secret, 'utf8') >= 32` bytes.
3. **Placeholder Shield:** Any environment variable containing placeholder keywords (`your_`, `replace_with`, `changeme`, `placeholder`, `_here`) triggers a fatal startup error (`CONFIG_ERROR`).
4. **TTL Maximum Cap:** `GATEWAY_ACTOR_TTL_SECONDS` is bounded between 5 and 120 seconds (the maximum enforced by PostgreSQL `verify_gateway_actor()`).
5. **Key ID Format:** `GATEWAY_ACTOR_HMAC_KEY_ID` must match `^[A-Za-z0-9._-]{1,64}$` (no whitespace, newlines, or delimiter injection).
