# NEXUS HR — PHASE 4.1 ENVIRONMENT VARIABLES

**Reference Template:** `.env.example` (root workspace `D:\Antigravity_Projects\nexus-hr\.env.example`)  
**Config Loader:** `gateway/src/config/env.ts` (`loadGatewayConfig`)

---

## 1. Required & Optional Gateway Environment Variables

| Variable | Required | Default | Validation / Constraint | Purpose |
|---|---|---|---|---|
| `PORT` | No | `3000` | Integer `1..65535` | HTTP listen port |
| `SUPABASE_CENTRAL_URL` | **Yes** | — | HTTPS (or HTTP localhost only) | Central Supabase base URL (`https://wcmevigbqsmzsdqidjel.supabase.co`) |
| `SUPABASE_CENTRAL_SERVICE_ROLE_KEY` | **Yes** | — | Non-empty, non-placeholder | Central `service_role` key for `user_profiles`/`branches` lookups |
| `SUPABASE_BRANCH_A_URL` | **Yes** | — | HTTPS (or HTTP localhost only) | Branch A Supabase base URL (`https://uneycmbqqpkifwhwzbes.supabase.co`) |
| `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` | **Yes** | — | Non-empty, non-placeholder | Branch A `service_role` key for `employees` & RPC calls |
| `CENTRAL_JWKS_URL` | No | `${SUPABASE_CENTRAL_URL}/auth/v1/.well-known/jwks.json` | HTTPS (or HTTP localhost only) | Central Auth JWKS endpoint |
| `CENTRAL_JWT_ISSUER` | No | `${SUPABASE_CENTRAL_URL}/auth/v1` | Trailing slash stripped | Expected `iss` claim in Central JWTs |
| `CENTRAL_JWT_AUDIENCE` | No | `authenticated` | Non-empty string | Expected `aud` claim in Central JWTs |
| `JWKS_CACHE_TTL_SECONDS` | No | `300` | Integer `10..3600` | In-memory JWKS cache TTL |
| `JWT_CLOCK_SKEW_SECONDS` | No | `5` | Integer `0..30` | Allowed `exp`/`nbf` clock skew |
| `BRANCH_A_ID` | No | `00000000-0000-0000-0000-000000000001` | Valid UUID | Canonical Branch A singleton UUID |
| `BRANCH_A_CODE` | No | `BRANCH-A` | Non-empty string | Canonical Branch A code |
| `GATEWAY_ACTOR_HMAC_KEY_ID` | Conditional | `gw-hmac-v1` (single-key mode) | `^[A-Za-z0-9._-]{1,64}$` | Active signing key ID (selects preferred key in JSON ring mode) |
| `GATEWAY_ACTOR_HMAC_KEY` | Conditional | — | `>= 32` UTF-8 bytes, non-placeholder | Required when `GATEWAY_ACTOR_HMAC_KEYS_JSON` is not set |
| `GATEWAY_ACTOR_HMAC_KEYS_JSON` | Conditional | — | Non-empty JSON array of key records | Multi-key rotation ring (`keyId`, `secret`, `isActive`, `activatedAt`, `expiresAt`, `revokedAt`) |
| `GATEWAY_ACTOR_TTL_SECONDS` | No | `60` | Integer `5..120` | Outbound actor envelope TTL (capped at 120s SQL max) |
| `GATEWAY_REQUEST_TIMEOUT_MS` | No | `5000` | Integer `500..30000` | Upstream HTTP fetch timeout (JWKS, Central, Branch A) |

---

## 2. Notes & Recommendations

1. **No Secrets in VCS:** `.env.example` contains placeholders only; no real secrets are committed.
2. **Future Phase 4.2 Addition:** Add `CORS_ALLOWED_ORIGINS` for browser frontend integration.
3. **Node Runtime:** `gateway/package.json` specifies `node >= 22.12.0` (native `.ts` execution without external npm dependencies).
