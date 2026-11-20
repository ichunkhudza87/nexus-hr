# NEXUS HR — Security Architecture & Access Control Specification

**System:** NEXUS HR Multi-Branch Distributed System  
**Revision:** 2.0.0 (Comprehensive Architecture Revision)  
**Security Model:** Zero-Trust, Defense-in-Depth, Least-Privilege  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`  

---

## 1. Zero-Trust Security Foundation

NEXUS HR enforces a strict **Zero-Trust & Defense-in-Depth** security perimeter across both physically separated Supabase PostgreSQL 17 nodes:

1. **Centralized Identity Authority:** Supabase Auth on `nexus-central` is the sole Identity Provider (IdP) for the entire enterprise.
2. **Backend Authentication Gateway:** Branch A does NOT share database credentials or signing keys with Central Auth. Access to Branch A is governed by an authenticated backend application gateway that cryptographically validates Central JWT signatures before executing database operations.
3. **No Service-Role Leakage:** Service-role keys bypass Row Level Security (RLS) entirely. They reside exclusively in secured backend server environments and are never bundled into client applications (Vite, Next.js client bundles, mobile apps) or committed to Git.
4. **Mandatory RLS on All Tables:** Row Level Security is explicitly enabled on all 17 application tables across both nodes (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`).
5. **No Permissive Wildcard Policies:** Policies granting unrestricted access (e.g. `USING (true)`) on data-modifying queries are strictly prohibited.
6. **Append-Only Auditing:** Audit tables on both nodes are protected against mutation or truncation via privilege revocation (`REVOKE UPDATE, DELETE, TRUNCATE`).

---

## 2. Authentication & Cross-Node JWT Trust Model

### 2.1 Central Identity Provider (IdP)
- **Engine:** Supabase Auth (`auth.users`) hosted on Node 1 (`nexus-central`).
- **Profile Binding:** `nexus-central.user_profiles.id` references `auth.users(id)` with `ON DELETE CASCADE`.
- **Issued Token:** On successful login, Central Auth issues a signed JWT containing identity claims:
  ```json
  {
    "sub": "b2f6b3a2-11a8-4820-94a1-09405d54e81a",
    "iss": "https://wcmevigbqsmzsdqidjel.supabase.co/auth/v1",
    "aud": "authenticated",
    "exp": 1794314839,
    "user_metadata": {
      "full_name": "Siti Rahma"
    },
    "app_metadata": {
      "user_role": "EMPLOYEE",
      "branch_code": "BRANCH-A",
      "branch_id": "8c42fa75-6e4b-4b19-a1b7-a3a83236eb4b"
    }
  }
  ```

### 2.2 Backend Authentication Gateway Architecture
Because `nexus-central` and `nexus-branch-a` are independent Supabase projects with distinct internal cryptographic keys:
- **No Direct Browser Access to Branch Database:** Browser clients interacting with Branch A do not query `nexus-branch-a` with unverified tokens.
- **Verification Workflow:**
  1. The client sends the Central-issued JWT in the `Authorization: Bearer <token>` header to the NEXUS HR Backend Server / API Gateway.
  2. The Backend Gateway verifies the cryptographic signature of the token against Central's public JSON Web Key Set (`https://wcmevigbqsmzsdqidjel.supabase.co/auth/v1/.well-known/jwks.json`) or verified public key.
  3. The Gateway validates token claims: expiration (`exp`), issuer (`iss`), active account status in `user_profiles`, assigned `user_role`, and assigned `branch_id`.
  4. Decoded claims are NEVER accepted without prior cryptographic signature verification.
  5. Only after successful token verification does the backend execute operations against `nexus-branch-a` using authenticated server credentials, enforcing authorization context.

---

## 3. Role Hierarchy & Access Matrix

| Role | Scope | Node 1: Central Privileges | Node 2: Branch A Privileges |
| :--- | :--- | :--- | :--- |
| **`SUPERADMIN`** | Enterprise-wide | Full read/write on branches, profiles, audit logs, and sync telemetry. | Administrative audit access via backend gateway. |
| **`CENTRAL_HR`** | Corporate HR | Read access to cross-branch `employee_directory` and `attendance_daily_summaries`. | Read-only access to branch aggregates via sync projections. |
| **`BRANCH_MANAGER`**| Branch A Local | Read own profile; view branch employees in directory. | Plan/manage schedules, verify attendance (`is_verified`), approve/reject leave requests. |
| **`BRANCH_HR`** | Branch A Local | Read own profile; view branch employees in directory. | Onboard/maintain employees, maintain departments/positions, dispatch schedules. |
| **`EMPLOYEE`** | Self Only | Read own profile in Central. | View own roster, execute check-in/out for own schedule, submit own leave requests. |

---

## 4. Comprehensive RLS Policy Matrix (17 Application Tables)

### 4.1 Node 1: Central Database (`nexus-central`) — 7 Tables

#### 1. `branches`
- **SELECT:** `FOR SELECT TO authenticated USING (is_active = TRUE OR (auth.jwt() -> 'app_metadata' ->> 'user_role') = 'SUPERADMIN');`
- **INSERT / UPDATE / DELETE:** `FOR ALL TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') = 'SUPERADMIN') WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'user_role') = 'SUPERADMIN');`

#### 2. `user_profiles`
- **SELECT:**
  - Self: `FOR SELECT TO authenticated USING (id = auth.uid());`
  - Corporate: `FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('SUPERADMIN', 'CENTRAL_HR'));`
  - Branch Leadership: `FOR SELECT TO authenticated USING (branch_id = ((auth.jwt() -> 'app_metadata' ->> 'branch_id')::uuid));`
- **INSERT:** Handled via database trigger on `auth.users` insertion using security definer context.
- **UPDATE:** Self updates avatar: `USING (id = auth.uid()) WITH CHECK (id = auth.uid());` Role changes restricted to `SUPERADMIN`.
- **DELETE:** Restricted to `SUPERADMIN` (or cascaded from `auth.users`).

#### 3. `employee_directory`
- **SELECT:** `FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('SUPERADMIN', 'CENTRAL_HR') OR branch_id = ((auth.jwt() -> 'app_metadata' ->> 'branch_id')::uuid));`
- **INSERT / UPDATE / DELETE:** Denied to all standard authenticated roles. Mutations executed exclusively via internal sync consumer using `service_role`.

#### 4. `attendance_daily_summaries`
- **SELECT:** `FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('SUPERADMIN', 'CENTRAL_HR'));`
- **INSERT / UPDATE / DELETE:** Denied to standard users. Populated exclusively by sync consumer using `service_role`.

#### 5. `sync_inbox`
- **ALL:** Restricted exclusively to internal server sync workers connecting with `service_role`.

#### 6. `sync_runs`
- **SELECT:** `FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') = 'SUPERADMIN');`
- **INSERT / UPDATE / DELETE:** Restricted to `service_role`.

#### 7. `audit_logs`
- **SELECT:** `FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') = 'SUPERADMIN');`
- **INSERT:** Generated via security-definer audit triggers or server-side logging.
- **UPDATE / DELETE:** Revoked globally (`REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM authenticated, anon, public;`).

---

### 4.2 Node 2: Branch A Database (`nexus-branch-a`) — 10 Tables

#### 1. `branch_config`
- **SELECT:** `FOR SELECT TO authenticated USING (TRUE);`
- **UPDATE:** `FOR UPDATE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('SUPERADMIN', 'BRANCH_MANAGER'));`
- **INSERT / DELETE:** Denied (singleton table with enforced constant primary key).

#### 2. `departments`
- **SELECT:** `FOR SELECT TO authenticated USING (is_active = TRUE OR (auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('BRANCH_HR', 'BRANCH_MANAGER'));`
- **INSERT / UPDATE / DELETE:** Restricted to `BRANCH_HR` and `BRANCH_MANAGER`.

#### 3. `positions`
- **SELECT:** `FOR SELECT TO authenticated USING (is_active = TRUE OR (auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('BRANCH_HR', 'BRANCH_MANAGER'));`
- **INSERT / UPDATE / DELETE:** Restricted to `BRANCH_HR`.

#### 4. `employees`
- **SELECT:**
  - Self: `FOR SELECT TO authenticated USING (user_auth_id = auth.uid() AND is_deleted = FALSE);`
  - Management: `FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('BRANCH_HR', 'BRANCH_MANAGER', 'SUPERADMIN'));`
- **INSERT / UPDATE:** Restricted to `BRANCH_HR`.
- **DELETE:** Hard delete revoked. Soft deletion performed by setting `is_deleted = TRUE, deleted_at = now()` by `BRANCH_HR`.

#### 5. `shifts`
- **SELECT:** `FOR SELECT TO authenticated USING (TRUE);`
- **INSERT / UPDATE / DELETE:** Restricted to `BRANCH_HR` and `BRANCH_MANAGER`.

#### 6. `employee_schedules`
- **SELECT:**
  - Self: `FOR SELECT TO authenticated USING (employee_id IN (SELECT id FROM employees WHERE user_auth_id = auth.uid()));`
  - Management: `FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('BRANCH_HR', 'BRANCH_MANAGER', 'SUPERADMIN'));`
- **INSERT / UPDATE / DELETE:** Restricted to `BRANCH_HR` and `BRANCH_MANAGER`.

#### 7. `attendance`
- **SELECT:**
  - Self: `FOR SELECT TO authenticated USING (employee_id IN (SELECT id FROM employees WHERE user_auth_id = auth.uid()));`
  - Management: `FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('BRANCH_HR', 'BRANCH_MANAGER', 'SUPERADMIN'));`
- **INSERT (Check-in):**
  - Self Check-in:
    ```sql
    CREATE POLICY "attendance_self_check_in" ON attendance
      FOR INSERT TO authenticated
      WITH CHECK (
        employee_id = (SELECT id FROM employees WHERE user_auth_id = auth.uid() AND is_active = TRUE AND is_deleted = FALSE)
        AND schedule_id IN (SELECT id FROM employee_schedules WHERE employee_id = attendance.employee_id AND status != 'CANCELLED')
      );
    ```
- **UPDATE (Check-out):**
  - Self Check-out:
    ```sql
    CREATE POLICY "attendance_self_check_out" ON attendance
      FOR UPDATE TO authenticated
      USING (
        employee_id = (SELECT id FROM employees WHERE user_auth_id = auth.uid())
        AND check_out_time IS NULL
      )
      WITH CHECK (
        check_out_time IS NOT NULL
        AND check_out_time > check_in_time
      );
    ```
- **UPDATE (Verification):**
  - Manager Verification:
    ```sql
    CREATE POLICY "attendance_manager_verify" ON attendance
      FOR UPDATE TO authenticated
      USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('BRANCH_MANAGER', 'SUPERADMIN'));
    ```

#### 8. `leave_requests`
- **SELECT:**
  - Self: `FOR SELECT TO authenticated USING (employee_id IN (SELECT id FROM employees WHERE user_auth_id = auth.uid()));`
  - Management: `FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('BRANCH_HR', 'BRANCH_MANAGER', 'SUPERADMIN'));`
- **INSERT (Submission):**
  - Self Submission:
    ```sql
    CREATE POLICY "leave_self_submit" ON leave_requests
      FOR INSERT TO authenticated
      WITH CHECK (
        employee_id = (SELECT id FROM employees WHERE user_auth_id = auth.uid() AND is_active = TRUE)
        AND status = 'PENDING'
      );
    ```
- **UPDATE (Approval / Rejection):**
  - Manager Approval:
    ```sql
    CREATE POLICY "leave_manager_decide" ON leave_requests
      FOR UPDATE TO authenticated
      USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('BRANCH_MANAGER', 'SUPERADMIN'))
      WITH CHECK (status IN ('APPROVED', 'REJECTED'));
    ```

#### 9. `sync_outbox`
- **ALL:** Denied to standard authenticated and public roles. Accessible exclusively to server-side background sync processes connecting with `service_role`.

#### 10. `audit_logs`
- **SELECT:** Restricted to `BRANCH_MANAGER` and `SUPERADMIN`.
- **INSERT:** Generated via audit triggers or server-side service logger.
- **UPDATE / DELETE:** Revoked globally (`REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM authenticated, anon, public;`).

---

## 5. Credential Security & Secret Management

| Credential Name | Safe Location | Permitted Environment | Leakage Risk & Prevention |
| :--- | :--- | :--- | :--- |
| `SUPABASE_CENTRAL_ANON_KEY` | Frontend Client / Portal | Browser / Mobile | Low risk. Bound by Central RLS. |
| `SUPABASE_BRANCH_A_ANON_KEY` | Backend Server | Server Runtime Only | Kept server-side to enforce API gateway validation. |
| `SUPABASE_CENTRAL_SERVICE_ROLE_KEY` | Sync Worker / Central Server | Backend Runtime Only | **CRITICAL RISK:** Bypasses Central RLS. Never in frontend or Git. |
| `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY`| Sync Worker / Branch Server | Backend Runtime Only | **CRITICAL RISK:** Bypasses Branch RLS. Never in frontend or Git. |
| `CENTRAL_DATABASE_URL` | Migration Harness / CI-CD | Backend Runtime Only | **CRITICAL RISK:** Direct PostgreSQL superuser connection. |
| `BRANCH_A_DATABASE_URL` | Migration Harness / CI-CD | Backend Runtime Only | **CRITICAL RISK:** Direct PostgreSQL superuser connection. |

---

## 6. Audit Logging Architecture

1. **Local vs Central Auditing:**
   - **Branch A `audit_logs`:** Captures operational check-ins, check-outs, leave submissions, leave approvals, and roster assignments.
   - **Central `audit_logs`:** Captures branch creations, user profile modifications, corporate role promotions, and enterprise configuration changes.
2. **Append-Only Immutability:** Audit records are written via database triggers (`AFTER INSERT OR UPDATE OR DELETE`). All application roles have `UPDATE`, `DELETE`, and `TRUNCATE` permissions revoked at the PostgreSQL engine level.
3. **Traceability:** Sync batch operations record diagnostic execution telemetry in `sync_runs` on Central and status transitions in `sync_outbox` on Branch A.
