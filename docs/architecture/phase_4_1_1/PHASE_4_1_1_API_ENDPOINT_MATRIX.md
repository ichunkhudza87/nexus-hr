# NEXUS HR — PHASE 4.1.1 API ENDPOINT MATRIX

All endpoints require Central JWT Bearer authentication (`Authorization: Bearer <jwt>`) unless marked as Public.

---

## 1. Gateway API Endpoint Inventory

| Method | Path | Target Node | Backing Resource / Table | Required Role | Role & Branch Scoping Rule |
|---|---|---|---|---|---|
| `GET` | `/health` | Gateway Local | In-memory status | Public | Returns status `ok`, `branchId`, and `activeSigningKeyId`. No secrets exposed. |
| `POST` | `/api/v1/leave-requests/:id/decide` | Branch A | `public.rpc_branch_decide_leave_request` | `BRANCH_MANAGER` | Enforces active manager assignment to Branch A and active employee record. Dispatches HMAC v2.7 signed envelope. No self-approval. |
| `PATCH` | `/api/v1/admin/leave-requests/:id` | Branch A | `public.rpc_superadmin_update_leave_request` | `SUPERADMIN` | Supports `DECISION` and `CORRECTION` modes with tri-state flags (`p_set_*`). Dispatches HMAC v2.7 signed envelope. |
| `GET` | `/api/dashboard/summary` | Central | `public.attendance_daily_summaries` | All Authenticated | Non-enterprise roles (`BRANCH_MANAGER`, `BRANCH_HR`, `EMPLOYEE`) are strictly forced to `branch_id = BRANCH_A_ID`. Enterprise roles (`SUPERADMIN`, `CENTRAL_HR`) can query any branch. |
| `GET` | `/api/employees/directory` | Central | `public.employee_directory` | All Authenticated | Non-enterprise roles are strictly forced to `branch_id = BRANCH_A_ID`. Enterprise roles can query across all branches. Supports `search`, `employment_status`, `is_active`. |
| `GET` | `/api/employees` | Branch A | `public.employees` | All Authenticated | `EMPLOYEE` role is strictly forced to their own `employee_id`. Managers/Admins can query across branch employees. Supports department and status filters. |
| `GET` | `/api/shifts` | Branch A | `public.shifts` | All Authenticated | Returns branch shift definitions. Supports `is_active` filter. |
| `GET` | `/api/schedules` | Branch A | `public.employee_schedules` | All Authenticated | `EMPLOYEE` role is strictly forced to their own `employee_id`. Supports `start_date`, `end_date`, and `status` filters. |
| `GET` | `/api/attendance` | Branch A | `public.attendance` | All Authenticated | `EMPLOYEE` role is strictly forced to their own `employee_id`. Supports date range and `status` filters. |
| `GET` | `/api/leave-requests` | Branch A | `public.leave_requests` | All Authenticated | `EMPLOYEE` role is strictly forced to their own `employee_id`. Managers/Admins can inspect branch leave requests. Supports date range, `status`, and `leave_type` filters. |

---

## 2. Universal Security Invariants on All Endpoints

1. **Authentication:** All protected endpoints require a valid, non-expired Central JWT issued by `${CENTRAL_JWT_ISSUER}` with audience `authenticated`.
2. **Authority Source:** Identity, role, branch assignment, and active employee ID are derived exclusively server-side via `IdentityResolver` querying Central and Branch A.
3. **Forbidden Client Parameters:** Any query or body parameter attempting to spoof authority (`actor_id`, `actor_role`, `role`, `user_role`, `actor_email`, `actor_sig`, `branch_id`, or `p_*`) is rejected with HTTP `400 FORBIDDEN_IDENTITY_FIELD`.
4. **Pagination Bounds:** All read endpoints enforce `page >= 1` and `1 <= page_size <= 100` (default `page_size = 20`).
5. **No Direct Remote Browser Access:** Browser clients communicate solely through the Gateway; `service_role` keys never leave the server environment.
