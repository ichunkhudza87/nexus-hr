# NEXUS HR — PHASE 3.12C GATEWAY <-> SQL V2.7 CONTRACT MATRIX

**Gateway Version:** `gateway/src/` (Phase 3.12C Remediated)  
**SQL Draft Version:** `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql`

---

## 1. Canonical HMAC Payload Contract (`v2.7`)

| Field # | Element | Gateway Implementation (`hmac-signer.ts`) | SQL v2.7 Implementation (`verify_gateway_actor()`) | Result |
|---|---|---|---|---|
| 1 | Protocol version | Literal `'v2.7'` (`CANONICAL_ACTOR_PAYLOAD_VERSION`) | Literal `'v2.7'` in `concat_ws('\|', ...)` | **PASS** |
| 2 | Signing key ID | `assertValidKeyId(input.keyId)` (`^[A-Za-z0-9._-]{1,64}$`) | `v_key_rec.key_id` validated `~ '^[A-Za-z0-9._-]{1,64}$'` | **PASS** |
| 3 | Action scope | `'LEAVE_DECIDE'` \| `'LEAVE_SUPERADMIN_UPDATE'` | `p_action_scope IN ('LEAVE_DECIDE', 'LEAVE_SUPERADMIN_UPDATE')` | **PASS** |
| 4 | Target ID | `input.targetId.trim().toLowerCase()` | `p_target_id::text` (PostgreSQL lowercases UUIDs) | **PASS** |
| 5 | Operation mode | `'DECISION'` \| `'CORRECTION'` | `p_operation_mode IN ('DECISION', 'CORRECTION')` | **PASS** |
| 6 | Actor user ID | `input.actorUserId.trim().toLowerCase()` | `p_actor_user_id::text` | **PASS** |
| 7 | Actor email | `email.trim().toLowerCase()`, rejects `\|,\r,\n,\0` | `lower(btrim(p_actor_email))`, rejects `~ '[\|\r\n]'` | **PASS** |
| 8 | Actor role | `ResolvedActor.actorRole` | `p_actor_role IN ('SUPERADMIN', 'BRANCH_MANAGER')` | **PASS** |
| 9 | Branch ID | `branchId ? branchId.trim().toLowerCase() : ''` | `COALESCE(p_branch_id::text, '')` | **PASS** |
| 10 | Employee ID | `employeeId ? employeeId.trim().toLowerCase() : ''` | `COALESCE(p_employee_id::text, '')` | **PASS** |
| 11 | Expiration epoch | `String(input.exp)` (TTL `5..120s`) | `p_exp::text` (`>= v_now_epoch` and `<= v_now_epoch + 120`) | **PASS** |
| 12 | Single-use nonce | `input.nonce.trim().toLowerCase()` (CSPRNG UUIDv4) | `p_nonce::text` (`UUID`, atomic `ON CONFLICT DO NOTHING`) | **PASS** |
| — | Secret & digest | `createHmac('sha256', Buffer.from(secret, 'utf8')).digest('hex')` | `encode(extensions.hmac(convert_to(v_canonical,'UTF8'), convert_to(v_secret,'UTF8'), 'sha256'), 'hex')` | **PASS** |

---

## 2. RPC Contract: `rpc_branch_decide_leave_request` (12 Parameters)

| Gateway Key (`branch-rpc-client.ts`) | TypeScript Value | SQL Parameter (`001_..._v2_7.sql`) | SQL Type | Result |
|---|---|---|---|---|
| `p_key_id` | `envelope.keyId` | `p_key_id` | `TEXT` | **PASS** |
| `p_request_id` | `input.requestId` | `p_request_id` | `UUID` | **PASS** |
| `p_decision` | `'APPROVED' \| 'REJECTED'` | `p_decision` | `VARCHAR(50)` | **PASS** |
| `p_rejection_reason` | `string \| null` | `p_rejection_reason` | `TEXT` | **PASS** |
| `p_actor_user_id` | `envelope.actorUserId` | `p_actor_user_id` | `UUID` | **PASS** |
| `p_actor_email` | `envelope.actorEmail` | `p_actor_email` | `TEXT` | **PASS** |
| `p_actor_role` | `envelope.actorRole` | `p_actor_role` | `TEXT` | **PASS** |
| `p_branch_id` | `envelope.branchId` | `p_branch_id` | `UUID` | **PASS** |
| `p_employee_id` | `envelope.employeeId` | `p_employee_id` | `UUID` | **PASS** |
| `p_exp` | `envelope.exp` | `p_exp` | `BIGINT` | **PASS** |
| `p_nonce` | `envelope.nonce` | `p_nonce` | `UUID` | **PASS** |
| `p_actor_sig` | `envelope.actorSig` | `p_actor_sig` | `TEXT` | **PASS** |

---

## 3. RPC Contract: `rpc_superadmin_update_leave_request` (24 Parameters)

| Gateway Key (`branch-rpc-client.ts`) | Semantics | SQL Parameter (`001_..._v2_7.sql`) | SQL Type | Result |
|---|---|---|---|---|
| `p_key_id` | Active key identifier | `p_key_id` | `TEXT` | **PASS** |
| `p_request_id` | Target leave request UUID | `p_request_id` | `UUID` | **PASS** |
| `p_operation_mode` | `'DECISION' \| 'CORRECTION'` | `p_operation_mode` | `TEXT` | **PASS** |
| `p_employee_id` | `string \| null` (`COALESCE` preserves omitted) | `p_employee_id` | `UUID DEFAULT NULL` | **PASS** |
| `p_leave_type` | `LeaveType \| null` (`COALESCE` preserves omitted) | `p_leave_type` | `VARCHAR(50) DEFAULT NULL` | **PASS** |
| `p_start_date` | `YYYY-MM-DD \| null` (`COALESCE` preserves omitted) | `p_start_date` | `DATE DEFAULT NULL` | **PASS** |
| `p_end_date` | `YYYY-MM-DD \| null` (`COALESCE` preserves omitted) | `p_end_date` | `DATE DEFAULT NULL` | **PASS** |
| `p_total_days` | `number \| null` (`COALESCE` preserves omitted) | `p_total_days` | `NUMERIC(4,1) DEFAULT NULL` | **PASS** |
| `p_reason` | `string \| null` (`COALESCE` preserves omitted) | `p_reason` | `TEXT DEFAULT NULL` | **PASS** |
| `p_status` | `LeaveStatus \| null` (`COALESCE` preserves omitted) | `p_status` | `VARCHAR(50) DEFAULT NULL` | **PASS** |
| `p_rejection_reason` | Present iff `p_set_rejection_reason = true` | `p_rejection_reason` | `TEXT DEFAULT NULL` | **PASS** |
| `p_approved_by` | Present iff `p_set_approved_by = true` | `p_approved_by` | `UUID DEFAULT NULL` | **PASS** |
| `p_approved_at` | Present iff `p_set_approved_at = true` | `p_approved_at` | `TIMESTAMPTZ DEFAULT NULL` | **PASS** |
| `p_set_rejection_reason` | `input.rejectionReason !== undefined` | `p_set_rejection_reason` | `BOOLEAN DEFAULT FALSE` | **PASS** |
| `p_set_approved_by` | `input.approvedBy !== undefined` | `p_set_approved_by` | `BOOLEAN DEFAULT FALSE` | **PASS** |
| `p_set_approved_at` | `input.approvedAt !== undefined` | `p_set_approved_at` | `BOOLEAN DEFAULT FALSE` | **PASS** |
| `p_actor_user_id` | `envelope.actorUserId` | `p_actor_user_id` | `UUID DEFAULT NULL` | **PASS** |
| `p_actor_email` | `envelope.actorEmail` | `p_actor_email` | `TEXT DEFAULT NULL` | **PASS** |
| `p_actor_role` | `envelope.actorRole` | `p_actor_role` | `TEXT DEFAULT NULL` | **PASS** |
| `p_branch_id` | `envelope.branchId` | `p_branch_id` | `UUID DEFAULT NULL` | **PASS** |
| `p_actor_employee_id` | `envelope.employeeId` | `p_actor_employee_id` | `UUID DEFAULT NULL` | **PASS** |
| `p_exp` | `envelope.exp` | `p_exp` | `BIGINT DEFAULT NULL` | **PASS** |
| `p_nonce` | `envelope.nonce` | `p_nonce` | `UUID DEFAULT NULL` | **PASS** |
| `p_actor_sig` | `envelope.actorSig` | `p_actor_sig` | `TEXT DEFAULT NULL` | **PASS** |

---

## 4. Central REST & Signing Key Model Parity

| Area | Gateway Implementation | SQL Schema Baseline / v2.7 | Result |
|---|---|---|---|
| Central profile query | `GET /rest/v1/user_profiles?id=eq.<uuid>&select=id,email,role,branch_id,is_active,branch:branches(id,code,is_active)` | `001_central_schema.sql` `user_profiles` -> `branches(id)` | **PASS** |
| Branch employee query | `GET /rest/v1/employees?user_auth_id=eq.<uuid>&is_deleted=eq.false&select=id,user_auth_id,is_active,is_deleted` | `002_branch_a_schema.sql` `employees` | **PASS** |
| Key lifecycle states | `isActive`, `activatedAt`, `createdAt`, `rotatedAt`, `expiresAt`, `revokedAt` | `is_active`, `activated_at`, `created_at`, `rotated_at`, `expires_at`, `revoked_at` | **PASS** |
| Key state invariant | Rejects `revokedAt !== null \|\| !isActive \|\| expiresAt <= now` | Rejects `revoked_at IS NOT NULL`, `is_active IS NOT TRUE`, `expires_at <= now()` | **PASS** |
