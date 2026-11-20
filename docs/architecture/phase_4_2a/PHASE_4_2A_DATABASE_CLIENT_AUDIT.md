# NEXUS HR — PHASE 4.2A DATABASE CLIENT AUDIT

**Target Infrastructure:**
- Central Node: `nexus-central` (`wcmevigbqsmzsdqidjel`, PostgreSQL 17.11)
- Branch A Node: `nexus-branch-a` (`uneycmbqqpkifwhwzbes`, PostgreSQL 17.11)
- Gateway Workspace: `D:\Antigravity_Projects\nexus-hr\gateway\`
**Audit Date:** 2026-11-12 (UTC+7)  
**Status:** **AUDITED & VERIFIED (READ-ONLY)**

---

## 1. Node & Project Reference Verification

| Client Module | Target Node | Config Variable | Expected Base URL | Verification Check |
|---|---|---|---|---|
| `CentralJwtVerifier` (`src/auth/central-jwt.ts`) | Central | `CENTRAL_JWKS_URL`, `CENTRAL_JWT_ISSUER` | `https://wcmevigbqsmzsdqidjel.supabase.co` | HTTPS enforced; trailing slash normalized; single-flight fetch lock. |
| `HttpCentralClient` (`src/clients/central-client.ts`) | Central | `SUPABASE_CENTRAL_URL`, `SUPABASE_CENTRAL_SERVICE_ROLE_KEY` | `https://wcmevigbqsmzsdqidjel.supabase.co` | HTTPS enforced; API headers include `apikey` and `Authorization: Bearer <key>`; URL built via `new URL()`. |
| `HttpBranchAClient` (`src/clients/branch-rpc-client.ts`) | Branch A | `SUPABASE_BRANCH_A_URL`, `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` | `https://uneycmbqqpkifwhwzbes.supabase.co` | HTTPS enforced; API headers include `apikey` and `Authorization: Bearer <key>`; RPC invocation via `/rest/v1/rpc/<name>`. |

**Legacy Project Isolation:**
- Neither client has any reference or fallback to legacy projects `bolt` (`yvzkcilvszkdtfdfsfnw`), `cbt` (`cwnpfbrbjjbqhoypoubz`), or `nusantara` (`jdsbhfrclvugjvoryrtn`).
- All URLs and keys are loaded strictly from environment variables validated in `src/config/env.ts` with no hardcoded fallback projects.

---

## 2. Authentication, Authorization & Identity Resolution Pipeline

1. **Pre-Database JWT Gate:**
   - In `src/app.ts`, incoming requests must present a valid `Authorization: Bearer <token>`.
   - `CentralJwtVerifier.verifyToken()` validates the token's asymmetric signature against Central JWKS, checks `iss`, `aud`, `exp`, `nbf`, and verifies that `sub` is a valid UUID before any database client is called.
2. **Server-Side Identity Resolution (`IdentityResolver`):**
   - The verified `claims.sub` is passed to `HttpCentralClient.getUserProfileWithBranch(claims.sub)`.
   - Resolves `id`, `email`, `role`, `branch_id`, `is_active`, and branch configuration (`id`, `code`, `is_active`).
   - For non-enterprise roles (`BRANCH_MANAGER`, `BRANCH_HR`, `EMPLOYEE`), strictly checks `branch_id === BRANCH_A_ID` and `branch.code === 'BRANCH-A'`.
   - Queries Branch A `HttpBranchAClient.getEmployeesByAuthId(profile.id)` to resolve the active, non-deleted employee record (`id`).
   - If profile is deactivated, branch is inactive, or employee is missing/inactive/ambiguous, the request fails closed immediately.
3. **No Client-Supplied Identity / Authority Trust:**
   - Client-supplied `actor_id`, `actor_role`, `branch_id`, `user_role`, `p_*` query/body parameters are strictly rejected (`400 FORBIDDEN_IDENTITY_FIELD`).

---

## 3. Query Parameterization & Injection Safety

All database operations across `HttpCentralClient` and `HttpBranchAClient` communicate with PostgREST via structured URL query parameters and JSON payloads:
- Query parameters use standard PostgREST operators (`eq.<value>`, `gte.<value>`, `lte.<value>`, `ilike.*<value>*`) set via `URL.searchParams.set()`.
- Filter inputs are pre-validated by `src/validation/read-schemas.ts` and `src/validation/leave-schemas.ts` with strict regexes (UUIDs, ISO dates `YYYY-MM-DD`, safe search strings `^[A-Za-z0-9\s._@-]{1,100}$`, enum allowlists).
- No raw SQL strings or concatenations are generated or sent from Gateway to PostgREST.

---

## 4. `service_role` and Credential Boundary

- `SUPABASE_CENTRAL_SERVICE_ROLE_KEY` and `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` reside exclusively in server memory (`src/config/env.ts`).
- No endpoint exposes service role keys in response headers or bodies.
- Browser clients receive only application-specific JSON payloads (`{ data: ... }` or `{ error: ... }`).
- Logging via `src/security/log-sanitizer.ts` redacts all occurrences of keys, tokens, JWTs, and 64-char hex strings.

---

## 5. Network Timeouts and Connection Resilience

- Upstream requests (JWKS, Central REST, Branch A REST, Branch A RPC) use `AbortController` bounded by `config.requestTimeoutMs` (default 5000ms, max 30000ms).
- Abort errors map to HTTP `504` (`CENTRAL_TIMEOUT`, `BRANCH_TIMEOUT`, `BRANCH_RPC_TIMEOUT`).
- Network unreachable errors map to HTTP `503` (`CENTRAL_UNAVAILABLE`, `BRANCH_UNAVAILABLE`, `BRANCH_RPC_UNAVAILABLE`).
- PostgREST SQLSTATE errors are sanitized by `mapPostgrestError()` without leaking internal constraint names.
