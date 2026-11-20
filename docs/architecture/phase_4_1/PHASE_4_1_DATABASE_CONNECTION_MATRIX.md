# NEXUS HR — PHASE 4.1 DATABASE CONNECTION MATRIX

**Central Node:** `nexus-central` (`wcmevigbqsmzsdqidjel`, PostgreSQL 17.11)  
**Branch A Node:** `nexus-branch-a` (`uneycmbqqpkifwhwzbes`, PostgreSQL 17.11)

---

## 1. Connection & Privilege Boundary Matrix

| Node | Resource / Operation | Caller | Auth Mechanism | Gateway Implementation Status | Notes |
|---|---|---|---|---|---|
| **Central** | JWKS Public Keys (`/auth/v1/.well-known/jwks.json`) | Gateway (`CentralJwtVerifier`) | Public HTTPS GET | **Implemented** | Cached with single-flight lock & 10s unknown-`kid` refresh throttle. |
| **Central** | `public.user_profiles` + `public.branches` (read by `claims.sub`) | Gateway (`HttpCentralClient`) | `SUPABASE_CENTRAL_SERVICE_ROLE_KEY` | **Implemented** | Resolves authoritative `role`, `branch_id`, `is_active`, and branch status. |
| **Central** | `public.employee_directory` (read projection) | Gateway (`HttpCentralClient`) | `SUPABASE_CENTRAL_SERVICE_ROLE_KEY` | **Not Yet Implemented** | Required by Phase 4.1 contract; add read method + role-scoped route in Phase 4.2. |
| **Central** | `public.attendance_daily_summaries` (read rollup) | Gateway (`HttpCentralClient`) | `SUPABASE_CENTRAL_SERVICE_ROLE_KEY` | **Not Yet Implemented** | Required by Phase 4.1 contract; add read method + role-scoped route in Phase 4.2. |
| **Branch A** | `public.employees` (auth lookup by `user_auth_id`) | Gateway (`HttpBranchAClient`) | `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` | **Implemented** | Used by `IdentityResolver` to bind active non-deleted Branch A employee ID. |
| **Branch A** | `public.employees` (branch directory/list) | Gateway (`HttpBranchAClient`) | `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` | **Not Yet Implemented** | Add scoped read/management endpoints in Phase 4.2. |
| **Branch A** | `public.shifts` & `public.employee_schedules` | Gateway (`HttpBranchAClient`) | `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` | **Not Yet Implemented** | Required by Phase 4.1 contract; add in Phase 4.2. |
| **Branch A** | `public.attendance` | Gateway (`HttpBranchAClient`) | `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` | **Not Yet Implemented** | Required by Phase 4.1 contract; add in Phase 4.2. |
| **Branch A** | `public.leave_requests` (read/list) | Gateway (`HttpBranchAClient`) | `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` | **Not Yet Implemented** | `service_role` retains `SELECT` only; add scoped read route in Phase 4.2. |
| **Branch A** | `rpc_branch_decide_leave_request` | Gateway (`HttpBranchAClient`) | `service_role` + HMAC v2.7 (`p_key_id`, `p_actor_sig`, `p_nonce`, `p_exp`) | **Implemented** | Exact 12-param SQL v2.7.1 contract verified. |
| **Branch A** | `rpc_superadmin_update_leave_request` | Gateway (`HttpBranchAClient`) | `service_role` + HMAC v2.7 + tri-state flags | **Implemented** | Exact 24-param SQL v2.7.1 contract verified (`p_set_rejection_reason`, `p_set_approved_by`, `p_set_approved_at`). |

---

## 2. Zero-Trust Invariants Verified

1. **No Browser-to-Branch-A Direct Access:** Frontend/browser clients authenticate only with Central Auth and communicate with Branch A exclusively through the Backend Gateway.
2. **`service_role` Isolation:** `SUPABASE_CENTRAL_SERVICE_ROLE_KEY` and `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` exist only in Gateway server environment variables (`src/config/env.ts`) and are never exposed in responses or logs.
3. **No Client-Supplied Actor Authority:** `src/validation/leave-schemas.ts` (`FORBIDDEN_ACTOR_KEYS`) rejects `actor_id`, `actor_user_id`, `actor_email`, `actor_role`, `actor_sig`, `branch_id`, `user_role`, and all `p_*` RPC fields with HTTP `400 FORBIDDEN_IDENTITY_FIELD`.
4. **Central-to-Branch Cross-Verification:** `IdentityResolver` derives `actorUserId`, `actorEmail`, `actorRole`, and `branchId` from Central `user_profiles`, then cross-checks `employees` on Branch A; SQL `verify_gateway_actor()` re-verifies HMAC signature, nonce, `branch_config`, `employees`, and target `leave_requests` row inside PostgreSQL.
