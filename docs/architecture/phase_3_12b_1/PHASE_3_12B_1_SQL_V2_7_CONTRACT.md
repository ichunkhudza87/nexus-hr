# NEXUS HR — PHASE 3.12B.1 SQL REMEDIATION V2.7 CONTRACT SPECIFICATION
**Purpose:** Specify exact contract changes required between the Backend API Gateway (`gateway/src/`) and `PHASE_3_12A_REMEDIATION_V2_6.sql` to form **SQL Remediation v2.7** prior to Phase 3.12C approval and execution.  
**Notice:** Specification only — **NOT executed against any remote database** and **NOT modifying `supabase/migrations/`** in Phase 3.12B.1.

---

## 1. Contract Deltas Summary (v2.6 -> v2.7)

| ID | Area | v2.6 Status | Required v2.7 Contract |
|---|---|---|---|
| `C-01` | HMAC Key Identification & Rotation | `gateway_signing_keys` has no `revoked_at`; `verify_gateway_actor` ignores `key_id` (`ORDER BY created_at DESC LIMIT 1`); Gateway drops `envelope.keyId` | Add `revoked_at TIMESTAMPTZ NULL`; accept `p_key_id TEXT` in RPCs & `verify_gateway_actor`; require exact active unrevoked lookup `WHERE key_id = p_key_id AND is_active = TRUE AND revoked_at IS NULL`; bind `key_id` inside canonical payload (`11` fields) |
| `C-02` | `SUPERADMIN` `CORRECTION` Partial Updates | `p_rejection_reason`, `p_approved_by`, `p_approved_at` blindly overwrite existing values with `NULL` when omitted by API clients | Add explicit boolean presence flags (`p_set_rejection_reason`, `p_set_approved_by`, `p_set_approved_at` DEFAULT `FALSE`) or preserve `v_existing.*` when `FALSE` so partial `CORRECTION` patches never wipe decision audit fields |
| `C-03` | Nonce & Context Cleanup Contention | `verify_gateway_actor` executes `DELETE` across `used_actor_nonces` & `tx_actor_context` on every single call | Replace per-call unbounded `DELETE` with probabilistic/throttled batch cleanup (`LIMIT` via `ctid` or scheduled `pg_cron` job), eliminating lock contention |
| `C-04` | Canonical Payload Versioning / Field Parity | 10-field canonical payload lacks `key_id` | Update canonical string cleanly to 11 fields (`key_id` prepended or explicit position) simultaneously in `hmac-signer.ts` and `verify_gateway_actor()` (or confirm exact field order across test vectors) |
| `C-05` | Defense-in-Depth RLS on `leave_requests` | `REVOKE UPDATE` from `authenticated` + `DROP POLICY leave_manager_decide` (leaves `UPDATE` without policy) | Retain `REVOKE UPDATE ON public.leave_requests FROM authenticated, anon` **and** define an explicit restrictive/fail-closed `FOR UPDATE` RLS policy (`USING (FALSE) WITH CHECK (FALSE)`) plus keep `leave_select` & `leave_self_submit` hardened (`auth.uid()` + Branch A sync check or JWT-free read scope audit) |
| `C-06` | `verify_gateway_actor` Role & Scope Guard | Accepts `'BRANCH_HR'` & `'EMPLOYEE'` at HMAC verification layer | Keep per-RPC `p_action_scope` + `p_actor_role` allow-list strict (`'BRANCH_MANAGER'` only for `LEAVE_DECIDE`; `'SUPERADMIN'` only for `LEAVE_SUPERADMIN_UPDATE`) inside `verify_gateway_actor()` itself as well as inside the RPC bodies |

---

## 2. Exact SQL v2.7 Specification Changes (Reference Draft — Do Not Execute Yet)

### 2.1 Key Rotation & Revocation Schema (`C-01`)

Upgrade `nexus_internal.gateway_signing_keys` from SQL v2.6:

```sql
CREATE TABLE IF NOT EXISTS nexus_internal.gateway_signing_keys (
    key_id      TEXT PRIMARY KEY,
    hmac_secret TEXT NOT NULL CHECK (octet_length(hmac_secret) >= 32),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at  TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    CONSTRAINT chk_gateway_signing_key_state CHECK (
        revoked_at IS NULL OR is_active = FALSE
    )
);
```

### 2.2 Canonical Payload & `verify_gateway_actor` Upgrade (`C-01`, `C-04`, `C-06`)

Updated canonical string (**11 fields** — requires synchronized update to `gateway/src/security/hmac-signer.ts` and `gateway/src/clients/branch-rpc-client.ts`):

```text
<key_id>|<action_scope>|<lowercase_target_id>|<operation_mode>|<lowercase_actor_user_id>|<lowercase_trim_actor_email>|<actor_role>|<lowercase_branch_id_or_empty>|<lowercase_employee_id_or_empty>|<exp_epoch_seconds>|<lowercase_nonce>
```

Corresponding `verify_gateway_actor` v2.7 signature & lookup changes:

```sql
CREATE OR REPLACE FUNCTION nexus_internal.verify_gateway_actor(
    p_key_id         TEXT,
    p_action_scope   TEXT,
    p_target_id      UUID,
    p_operation_mode TEXT,
    p_actor_user_id  UUID,
    p_actor_email    TEXT,
    p_actor_role     TEXT,
    p_branch_id      UUID,
    p_employee_id    UUID,
    p_exp            BIGINT,
    p_nonce          UUID,
    p_actor_sig      TEXT
)
-- ...
-- Key lookup (supports concurrent active keys during overlap grace window AND immediate revocation):
SELECT hmac_secret
  INTO v_secret
  FROM nexus_internal.gateway_signing_keys
 WHERE key_id = p_key_id
   AND is_active = TRUE
   AND revoked_at IS NULL
 LIMIT 1;

IF v_secret IS NULL THEN
    RAISE EXCEPTION '42501: Gateway HMAC signing key "%" is unknown, inactive, or revoked.', COALESCE(p_key_id, '<NULL>')
        USING ERRCODE = '42501';
END IF;
```

**Why this fixes rotation:**
- During rotation from `gw-hmac-v1` to `gw-hmac-v2`:
  1. Ops inserts `gw-hmac-v2` (`is_active = TRUE, revoked_at = NULL`) in `nexus_internal.gateway_signing_keys` **while keeping `gw-hmac-v1` `is_active = TRUE, revoked_at = NULL`**.
  2. Gateway activates `gw-hmac-v2` for new signatures while any in-flight `gw-hmac-v1` envelopes carry `p_key_id = 'gw-hmac-v1'` and still pass DB verification cleanly.
  3. After TTL (`<= 120s`) + drain buffer, Ops updates `gw-hmac-v1` to `is_active = FALSE, revoked_at = now()`, immediately invalidating `gw-hmac-v1`.
  4. Including `p_key_id` in the HMAC canonical string binds the key identifier cryptographically to the signature.

### 2.3 Partial `SUPERADMIN` `CORRECTION` Fix (`C-02`)

Upgrade `public.rpc_superadmin_update_leave_request` in SQL v2.7 and matching `HttpBranchAClient.superadminUpdateLeaveRequest`:

Add explicit presence flags (defaulting `FALSE` for backward safety):
- `p_set_rejection_reason BOOLEAN DEFAULT FALSE`
- `p_set_approved_by BOOLEAN DEFAULT FALSE`
- `p_set_approved_at BOOLEAN DEFAULT FALSE`

Update `UPDATE public.leave_requests` assignment logic inside `CORRECTION` mode:

```sql
rejection_reason = CASE
    WHEN p_operation_mode = 'DECISION' THEN
        CASE WHEN COALESCE(p_status, v_existing.status) = 'REJECTED' THEN v_norm_rejection_reason ELSE NULL END
    WHEN p_set_rejection_reason THEN v_norm_rejection_reason
    ELSE v_existing.rejection_reason
END,
approved_by = CASE
    WHEN p_operation_mode = 'DECISION' THEN p_actor_user_id
    WHEN p_set_approved_by THEN p_approved_by
    ELSE v_existing.approved_by
END,
approved_at = CASE
    WHEN p_operation_mode = 'DECISION' THEN now()
    WHEN p_set_approved_at THEN p_approved_at
    ELSE v_existing.approved_at
END
```

Matching Gateway update required in `gateway/src/clients/branch-rpc-client.ts` & `leave-schemas.ts`:
- Distinguish `undefined` (field omitted -> `p_set_*: false`) from explicit `null` or string (`p_set_*: true`, `p_*: null | value`).
- Reject `CORRECTION` requests that explicitly clear `rejection_reason: null` while target `status` (either new or existing) is `'REJECTED'`.

### 2.4 Nonce & Context Cleanup Optimization (`C-03`)

Avoid full expired-table `DELETE` inside hot verification path on every call:
- Keep atomic `INSERT INTO nexus_internal.used_actor_nonces (nonce, expires_at) VALUES (p_nonce, to_timestamp(p_exp)) ON CONFLICT (nonce) DO NOTHING;` + `IF NOT FOUND THEN RAISE EXCEPTION ...`.
- Run opportunistic bounded cleanup (e.g., `WITH doomed AS (SELECT ctid FROM nexus_internal.used_actor_nonces WHERE expires_at < now() - INTERVAL '5 minutes' LIMIT 100) DELETE FROM nexus_internal.used_actor_nonces USING doomed WHERE used_actor_nonces.ctid = doomed.ctid;`) only on `random() < 0.05` (5% of calls) or via scheduled maintenance function, preventing write-lock amplification under burst traffic.

### 2.5 Defense-in-Depth RLS Policy on `public.leave_requests` (`C-05`)

To align strictly with Owner Decision #1 (*"Direct UPDATE privilege untuk authenticated pada leave_requests harus dicabut ... RLS tetap dipertahankan sebagai defense-in-depth"*):
- Keep `REVOKE UPDATE ON public.leave_requests FROM authenticated, anon, PUBLIC;`.
- Replace dropped `leave_manager_decide` with explicit restrictive/deny-all `FOR UPDATE` policy:
  ```sql
  DROP POLICY IF EXISTS "leave_manager_decide" ON public.leave_requests;
  DROP POLICY IF EXISTS "leave_deny_direct_update" ON public.leave_requests;
  CREATE POLICY "leave_deny_direct_update" ON public.leave_requests
      FOR UPDATE TO authenticated
      USING (FALSE)
      WITH CHECK (FALSE);
  ```
- This guarantees that even if a future DBA mistakenly re-grants `UPDATE` to `authenticated`, RLS fails closed and forces every leave mutation through the HMAC-verified RPC path.

### 2.6 RPC-to-Gateway Parameter Matrix (v2.7 Target)

1. `public.rpc_branch_decide_leave_request`:
   - `p_key_id TEXT` *(NEW)*
   - `p_request_id UUID`
   - `p_decision TEXT`
   - `p_rejection_reason TEXT DEFAULT NULL`
   - `p_actor_user_id UUID`
   - `p_actor_email TEXT`
   - `p_actor_role TEXT`
   - `p_branch_id UUID`
   - `p_employee_id UUID`
   - `p_exp BIGINT`
   - `p_nonce UUID`
   - `p_actor_sig TEXT`

2. `public.rpc_superadmin_update_leave_request`:
   - `p_key_id TEXT` *(NEW)*
   - `p_request_id UUID`
   - `p_operation_mode TEXT`
   - `p_employee_id UUID DEFAULT NULL`
   - `p_leave_type TEXT DEFAULT NULL`
   - `p_start_date DATE DEFAULT NULL`
   - `p_end_date DATE DEFAULT NULL`
   - `p_total_days NUMERIC DEFAULT NULL`
   - `p_reason TEXT DEFAULT NULL`
   - `p_status TEXT DEFAULT NULL`
   - `p_rejection_reason TEXT DEFAULT NULL`
   - `p_approved_by UUID DEFAULT NULL`
   - `p_approved_at TIMESTAMPTZ DEFAULT NULL`
   - `p_set_rejection_reason BOOLEAN DEFAULT FALSE` *(NEW)*
   - `p_set_approved_by BOOLEAN DEFAULT FALSE` *(NEW)*
   - `p_set_approved_at BOOLEAN DEFAULT FALSE` *(NEW)*
   - `p_actor_user_id UUID`
   - `p_actor_email TEXT`
   - `p_actor_role TEXT`
   - `p_branch_id UUID`
   - `p_actor_employee_id UUID`
   - `p_exp BIGINT`
   - `p_nonce UUID`
   - `p_actor_sig TEXT`

---

## 3. Synchronization Requirement

Gateway updates (`hmac-signer.ts`, `branch-rpc-client.ts`, `leave-schemas.ts`, `types/domain.ts`, `leave-service.ts`, and unit tests) and **SQL Remediation v2.7** MUST be reviewed and approved together before applying SQL v2.7 to Branch A (`uneycmbqqpkifwhwzbes`), because adding `p_key_id` and canonical `key_id` alters the shared RPC & HMAC wire contract on both sides.
