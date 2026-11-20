# NEXUS HR — PHASE 4.1 SECURITY REVIEW & HMAC KEY PROVISIONING READINESS

**Audit Date:** 2026-11-12 (UTC+7)

---

## 1. Security Controls Verified

- **JWT Verification (`src/auth/central-jwt.ts`):**
  - Enforces asymmetric JWKS (`ES256`, `ES384`, `RS256`, `EdDSA`), rejects `alg=none`, and rejects `HS256` unless explicitly configured (never enabled in `src/index.ts`).
  - Validates `iss`, `aud`, `exp`, `nbf`, and UUID `sub` with bounded clock skew (`0..30s`).
  - Coalesces concurrent JWKS refreshes and throttles unknown-`kid` refreshes to prevent DoS.
- **HMAC v2.7 Signing (`src/security/hmac-signer.ts`):**
  - Uses 12-field canonical payload `v2.7|key_id|action_scope|target_id|operation_mode|actor_user_id|actor_email|actor_role|branch_id|employee_id|exp|nonce` matching `nexus_internal.verify_gateway_actor()`.
  - Rejects delimiter injection (`|`, `\r`, `\n`, `\0`) in `actor_email` and enforces `^[A-Za-z0-9._-]{1,64}$` on `keyId`.
  - Uses constant-time digest comparison (`timingSafeEqual`) in `verifyEnvelope()`.
- **Anti-Replay (`src/security/nonce-store.ts` + SQL `nexus_internal.used_actor_nonces`):**
  - Generates CSPRNG UUIDv4 outbound nonces with `1..120s` TTL (`exp - now <= 120` enforced by SQL).
  - Isolates `out:` outbound namespace from `req:` inbound `X-Request-Nonce` namespace.
- **Log Sanitization (`src/security/log-sanitizer.ts`):**
  - Redacts `Bearer` headers, JWTs, 64-char hex strings, and sensitive object keys (`secret`, `key`, `token`, `authorization`, `sig`, `hmac`, etc.).

---

## 2. Security Findings & Risks

| ID | Severity | File | Finding | Remediation |
|---|---|---|---|---|
| **SEC-41-01** | Medium | `src/config/env.ts`, `src/security/hmac-signer.ts` | `activatedAt` is parsed/stored on `HmacSigningKeyRecord` but never checked (`activatedAt > now` is not rejected in `loadHmacKeyRing`, `getActiveKey`, or `verifyEnvelope`). | Validate `activatedAt` ISO format and enforce `Date.parse(activatedAt) <= nowMs` before using a key to sign or verify. |
| **SEC-41-02** | Low | `src/errors/gateway-error.ts` | `mapPostgrestError` forwards raw `payload.message` for `23505`/`23503`/`P0001`, which could expose PostgreSQL constraint or table names on unexpected constraint violations. | Map unexpected `23505`/`23503` errors to generic safe client messages while logging sanitized details server-side. |
| **SEC-41-03** | Low | `src/app.ts`, `src/index.ts` | Missing HTTP server timeouts (`requestTimeout`, `headersTimeout`), graceful shutdown (`SIGINT`/`SIGTERM`), and explicit CORS allowlist for browser frontend requests. | Configure server timeouts, shutdown hooks, and strict `CORS_ALLOWED_ORIGINS` in Phase 4.2. |
| **SEC-41-04** | Operational | `nexus_internal.gateway_signing_keys` | Table is verified empty (`0` rows) after Stage 2. Gateway RPC calls will fail with `42501: Unknown Gateway HMAC signing key` until provisioned. | Provision matching 256-bit key out-of-band into DB and Gateway runtime env before live RPC testing. |

---

## 3. HMAC Key Provisioning Readiness

- **Expected Key Format:**
  - `key_id`: 1–64 chars matching `^[A-Za-z0-9._-]{1,64}$` (e.g., `gw-hmac-v1`).
  - `hmac_secret`: UTF-8 string with `octet_length >= 32` bytes (recommended: 64-char hex output from 32 CSPRNG bytes). Exact identical UTF-8 string must exist in `nexus_internal.gateway_signing_keys` and Gateway env.
- **Required Environment Variables:**
  - Single-key mode: `GATEWAY_ACTOR_HMAC_KEY_ID` + `GATEWAY_ACTOR_HMAC_KEY`.
  - Multi-key rotation ring mode: `GATEWAY_ACTOR_HMAC_KEYS_JSON` (JSON array of `{ keyId, secret, isActive, activatedAt, expiresAt, revokedAt }`) + optional `GATEWAY_ACTOR_HMAC_KEY_ID` to select the preferred active key.
- **Key Selection & Lifecycle Validation:**
  - Gateway signs outbound envelopes with `activeKeyId` (`getActiveKey()`), stamping `p_key_id` into both the canonical HMAC payload and the RPC parameter.
  - PostgreSQL `verify_gateway_actor()` looks up the exact `key_id` (no fallback across keys), rejecting missing keys, `revoked_at IS NOT NULL`, `is_active IS NOT TRUE`, `expires_at <= now()`, or `< 32`-byte secrets.
  - Gateway checks `isActive`, `revokedAt === null`, and `expiresAt > now` (and must also enforce `activatedAt <= now` per `SEC-41-01`).
- **Zero-Downtime Key Rotation Procedure:**
  1. Insert new key (`gw-hmac-v2`, `is_active = TRUE`) into `nexus_internal.gateway_signing_keys` and set `expires_at = now() + INTERVAL '15 minutes'` (grace window) on `gw-hmac-v1`.
  2. Update Gateway `GATEWAY_ACTOR_HMAC_KEYS_JSON` / `GATEWAY_ACTOR_HMAC_KEY_ID=gw-hmac-v2` and reload/roll instances; in-flight `gw-hmac-v1` requests succeed during grace window.
  3. After grace window expires (or immediately on compromise via `revoked_at = now(), is_active = FALSE`), remove `gw-hmac-v1` from Gateway config.
- **Empty `gateway_signing_keys` Behavior:**
  - Confirmed empty (`0` rows) in Stage 2 verification. If Gateway sends an RPC before provisioning, `verify_gateway_actor()` raises SQLSTATE `42501` (`Unknown Gateway HMAC signing key`), which `mapPostgrestError` maps to HTTP `403 FORBIDDEN`. **Gateway is NOT ready for live RPCs until key provisioning is completed.**
