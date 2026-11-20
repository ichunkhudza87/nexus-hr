# NEXUS HR — PHASE 4.1.1 ENVIRONMENT UPDATE

**Reference File:** `.env.example` (Root workspace `D:\Antigravity_Projects\nexus-hr\.env.example`)  
**Config Module:** `gateway/src/config/env.ts` (`loadGatewayConfig`)

---

## 1. Updated Environment Variables Summary

| Variable | Type | Default | Required | Validation / Rules | Purpose |
|---|---|---|---|---|---|
| `PORT` | Integer | `3000` | No | `1..65535` | HTTP server listening port |
| `SUPABASE_CENTRAL_URL` | URL | — | **Yes** | HTTPS (or HTTP on localhost) | Central Supabase base URL |
| `SUPABASE_CENTRAL_SERVICE_ROLE_KEY` | String | — | **Yes** | Non-empty, non-placeholder | Server-side Central client key |
| `SUPABASE_BRANCH_A_URL` | URL | — | **Yes** | HTTPS (or HTTP on localhost) | Branch A Supabase base URL |
| `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` | String | — | **Yes** | Non-empty, non-placeholder | Server-side Branch A client key |
| `CENTRAL_JWKS_URL` | URL | `${SUPABASE_CENTRAL_URL}/auth/v1/.well-known/jwks.json` | No | HTTPS (or HTTP on localhost) | Central Auth JWKS public key endpoint |
| `CENTRAL_JWT_ISSUER` | String | `${SUPABASE_CENTRAL_URL}/auth/v1` | No | String | Expected JWT `iss` claim |
| `CENTRAL_JWT_AUDIENCE` | String | `authenticated` | No | String | Expected JWT `aud` claim |
| `JWKS_CACHE_TTL_SECONDS` | Integer | `300` | No | `10..3600` | In-memory JWKS cache TTL |
| `JWT_CLOCK_SKEW_SECONDS` | Integer | `5` | No | `0..30` | Allowed clock skew |
| `BRANCH_A_ID` | UUID | `00000000-0000-0000-0000-000000000001` | No | Valid UUID | Branch A canonical identifier |
| `BRANCH_A_CODE` | String | `BRANCH-A` | No | Non-empty string | Branch A canonical code |
| **`CORS_ALLOWED_ORIGINS`** | **String (CSV)** | `""` (no CORS) | **No** | **Comma-separated origins; wildcard `*` strictly prohibited with credentials** | **Allowed frontend origins for browser AJAX/fetch requests** |
| `GATEWAY_ACTOR_HMAC_KEY_ID` | String | `gw-hmac-v1` (single-key mode) | Conditional | `^[A-Za-z0-9._-]{1,64}$` | Active signing key ID |
| `GATEWAY_ACTOR_HMAC_KEY` | String | — | Conditional | `>= 32` UTF-8 bytes, non-placeholder | Required in single-key mode |
| `GATEWAY_ACTOR_HMAC_KEYS_JSON` | JSON | — | Conditional | Non-empty JSON array of key records with validated `activatedAt`, `expiresAt`, `revokedAt` | Multi-key rotation ring |
| `GATEWAY_ACTOR_TTL_SECONDS` | Integer | `60` | No | `5..120` | Outbound HMAC envelope TTL |
| `GATEWAY_REQUEST_TIMEOUT_MS` | Integer | `5000` | No | `500..30000` | Upstream HTTP timeout & server `requestTimeout` |

---

## 2. Updated `.env.example` Diff

```diff
 # Target Branch A canonical identifier (matches public.branch_config.id)
 BRANCH_A_ID=00000000-0000-0000-0000-000000000001
 BRANCH_A_CODE=BRANCH-A
 
+# Optional CORS Allowed Origins (comma-separated allowlist; wildcard '*' is prohibited with credentials)
+# CORS_ALLOWED_ORIGINS=https://app.nexus.local,https://admin.nexus.local
+
 # Out-of-Band 256-bit HMAC Signing Key (NEVER commit real values; must match nexus_internal.gateway_signing_keys)
```
