# NEXUS HR — PHASE 4.3: MOCK API CONTRACT & GATEWAY MAPPING

## 1. Overview

The frontend application uses an abstracted API client (`src/services/api.ts`) that manages in-memory state and simulates realistic network latency (50ms – 200ms).

All methods are asynchronous and strictly typed according to interfaces in `src/types/index.ts`. This document maps each mock method to its corresponding future Backend API Gateway endpoint and PostgreSQL RPC function.

---

## 2. API Method Specification & Target Gateway Mappings

### 2.1 Authentication & Session

#### `getCurrentUser(): Promise<UserSession>`
- **Mock Behavior:** Reads from local storage or returns currently selected demo user.
- **Future Gateway Endpoint:** `GET /api/v1/auth/me`
- **Headers:** `Authorization: Bearer <jwt>`
- **Target Schema:** `central.auth.users` + `central.public.profiles`

#### `login(roleKey: 'superadmin' | 'manager' | 'employee'): Promise<UserSession>`
- **Mock Behavior:** Authenticates demo credentials and saves session to `localStorage`.
- **Future Gateway Endpoint:** `POST /api/v1/auth/login`
- **Body:** `{ email, password }`
- **Target Schema:** Supabase Auth GoTrue service

#### `logout(): Promise<void>`
- **Mock Behavior:** Clears cached session.
- **Future Gateway Endpoint:** `POST /api/v1/auth/logout`

---

### 2.2 Dashboard Analytics

#### `getDashboardSummary(): Promise<DashboardSummary>`
- **Mock Behavior:** Returns aggregated headcount, punctuality rate, 7-day trend, and department counts.
- **Future Gateway Endpoint:** `GET /api/v1/analytics/dashboard`
- **Target Database Function:** `SELECT * FROM get_branch_dashboard_summary()`

---

### 2.3 Employees

#### `getEmployees(params?: { search?: string; departmentId?: string; page?: number; pageSize?: number }): Promise<PaginatedResponse<Employee>>`
- **Mock Behavior:** Scopes result to self if role is `EMPLOYEE`; filters by search query and department; paginates.
- **Future Gateway Endpoint:** `GET /api/v1/employees?search=...&departmentId=...&page=1&pageSize=10`
- **Target SQL:** `SELECT * FROM public.employees WHERE branch_id = $1`

#### `createEmployee(input: Omit<Employee, 'id' | 'employeeCode' | 'isActive'>): Promise<Employee>`
- **Mock Behavior:** Generates formatted code `EMP-A-00XX`, sets `isActive = true`, adds to in-memory store.
- **Future Gateway Endpoint:** `POST /api/v1/employees`
- **Target SQL:** `INSERT INTO public.employees (...) VALUES (...)`

---

### 2.4 Organization: Departments & Positions

#### `getDepartments(): Promise<Department[]>`
- **Mock Behavior:** Lists all active departments with employee counts.
- **Future Gateway Endpoint:** `GET /api/v1/departments`
- **Target SQL:** `SELECT * FROM public.departments WHERE is_active = TRUE`

#### `createDepartment(input: Omit<Department, 'id' | 'employeeCount'>): Promise<Department>`
- **Mock Behavior:** Appends new department record.
- **Future Gateway Endpoint:** `POST /api/v1/departments`

#### `getPositions(): Promise<Position[]>`
- **Mock Behavior:** Lists positions with assigned department names and active staff counts.
- **Future Gateway Endpoint:** `GET /api/v1/positions`

#### `createPosition(input: Omit<Position, 'id' | 'employeeCount'>): Promise<Position>`
- **Mock Behavior:** Appends new position record.
- **Future Gateway Endpoint:** `POST /api/v1/positions`

---

### 2.5 Shifts & Rostering

#### `getShifts(): Promise<Shift[]>`
- **Mock Behavior:** Returns shift templates (morning, afternoon, overnight, general office).
- **Future Gateway Endpoint:** `GET /api/v1/shifts`
- **Target SQL:** `SELECT * FROM public.shifts`

#### `createShift(input: Omit<Shift, 'id'>): Promise<Shift>`
- **Mock Behavior:** Creates new shift template with break rules and overnight flag.
- **Future Gateway Endpoint:** `POST /api/v1/shifts`

#### `getSchedules(params?: { startDate?: string; endDate?: string; employeeId?: string }): Promise<Schedule[]>`
- **Mock Behavior:** Filters by employee or date range; enforces role scoping for `EMPLOYEE`.
- **Future Gateway Endpoint:** `GET /api/v1/schedules?startDate=...&endDate=...`

#### `assignSchedule(input: Omit<Schedule, 'id'>): Promise<Schedule>`
- **Mock Behavior:** Creates scheduled shift assignment.
- **Future Gateway Endpoint:** `POST /api/v1/schedules`
- **Target SQL:** `INSERT INTO public.schedules (...) VALUES (...)`

---

### 2.6 Attendance

#### `getAttendance(params?: { date?: string; employeeId?: string; status?: string }): Promise<AttendanceRecord[]>`
- **Mock Behavior:** Filters attendance logs; scoped to employee when logged in as `EMPLOYEE`.
- **Future Gateway Endpoint:** `GET /api/v1/attendance?date=...&status=...`
- **Target SQL:** `SELECT * FROM public.attendance_records`

#### `recordCheckIn(employeeId: string): Promise<AttendanceRecord>`
- **Mock Behavior:** Records immediate timestamped check-in with `isVerified = true`.
- **Future Gateway Endpoint:** `POST /api/v1/attendance/check-in`
- **Target Gateway Security:** Generates HMAC signature and logs actor nonce into `nexus_internal.used_actor_nonces`.

---

### 2.7 Leave Requests & Approvals

#### `getLeaveRequests(params?: { status?: string; employeeId?: string }): Promise<LeaveRequest[]>`
- **Mock Behavior:** Filters by status (`PENDING`, `APPROVED`, `REJECTED`); scoped for `EMPLOYEE`.
- **Future Gateway Endpoint:** `GET /api/v1/leaves?status=...`

#### `submitLeaveRequest(input: { leaveType; startDate; endDate; totalDays; reason }): Promise<LeaveRequest>`
- **Mock Behavior:** Enters new request in `PENDING` status.
- **Future Gateway Endpoint:** `POST /api/v1/leaves`

#### `decideLeaveRequest(leaveId: string, decision: 'APPROVED' | 'REJECTED', rejectionReason?: string): Promise<LeaveRequest>`
- **Mock Behavior:** Validates that `BRANCH_MANAGER` is not deciding their own request; updates status.
- **Future Gateway Endpoint:** `POST /api/v1/leaves/:id/decision`
- **Target Database RPC:**
  ```sql
  SELECT nexus_internal.rpc_branch_decide_leave_request(
    p_leave_id => $1,
    p_decision => $2,
    p_rejection_reason => $3
  );
  ```
- **Error Behavior:** If caller is manager of same employee, returns 403 Forbidden with `"Self-approval by Branch Manager is prohibited."`
