# NEXUS HR — PHASE 4.3: PAGE & VIEW INVENTORY

## 1. Summary of Views

| Index | Page View | File Path | Route / Tab Key | Target Audience | Primary Capabilities |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **01** | **Login Portal** | `src/pages/LoginPage.tsx` | (Unauthenticated) | All Users | Role-switch presets, credentials input, password visibility toggle |
| **02** | **Executive Overview** | `src/pages/OverviewPage.tsx` | `overview` | All Roles (Adaptive) | Headcount KPIs, 7-day attendance trend, department chart, activity log |
| **03** | **Employee Directory** | `src/pages/EmployeesPage.tsx` | `employees` | All Roles (Scoped) | Search, department filter, card/grid view, Add Employee modal |
| **04** | **Departments & Hierarchy** | `src/pages/DepartmentsPage.tsx` | `departments`, `positions` | Admin & Managers | Tabbed department/position view, headcount counters, CRUD modals |
| **05** | **Work Shifts** | `src/pages/ShiftsPage.tsx` | `shifts` | Admin & Managers | Shift templates, working hours, break durations, overnight flags |
| **06** | **Roster & Schedules** | `src/pages/SchedulesPage.tsx` | `schedules` | All Roles (Scoped) | Roster calendar, employee filtering, Assign Shift modal |
| **07** | **Attendance Tracking** | `src/pages/AttendancePage.tsx` | `attendance` | All Roles (Scoped) | Real-time clock-in widget, audit status, filter by date/status, CSV export |
| **08** | **Leave Management** | `src/pages/LeavesPage.tsx` | `leaves` | All Roles | Submit leave application, review & decide, self-approval policy guard |
| **09** | **Executive Reports** | `src/pages/ReportsPage.tsx` | `reports` | Admin & Managers | HR KPIs, monthly trends, printable layout, instant CSV export |
| **10** | **User Management** | `src/pages/UserManagementPage.tsx` | `users` | SUPERADMIN Only | IAM directory, role elevation, account suspension, audit policy banner |
| **11** | **Settings & Telemetry** | `src/pages/SettingsPage.tsx` | `settings` | All Roles | Distributed node telemetry, credentials update, demo cache reset |

---

## 2. Detailed View Specifications

### 01. Login Portal (`LoginPage.tsx`)
- **Quick Demo Switcher:** Allows instantly authenticating as `Alexander Wright` (SUPERADMIN), `Dewi Lestari` (BRANCH_MANAGER), or `Budi Santoso` (EMPLOYEE).
- **Form Validation:** Validates email format and password presence with error feedback.
- **Visual Branding:** Displays NEXUS HR Enterprise identity, secure protocol badge, and PostgreSQL v2.7.2 versioning.

### 02. Executive Overview (`OverviewPage.tsx`)
- **KPI Metrics:** Total Workforce, Present Today, Late Arrivals, Active Leaves, and Attendance Rate percentage.
- **7-Day Trend Visualizer:** Interactive bar charts illustrating present, late, absent, and on-leave workforce distribution.
- **Department Headcount Breakdown:** Progress indicators showing staffing percentage per functional division.
- **Real-Time Activity Stream:** Chronological feed of recent employee check-ins and operational actions.

### 03. Employee Directory (`EmployeesPage.tsx`)
- **Search & Filter:** Dynamic full-text search across employee name, code, email, and position; filtered by department dropdown.
- **Role Isolation:** Standard employees see their own single profile card; managers and administrators view the full branch directory.
- **Add Employee Workflow:** Modal supporting full employee profile creation (name, email, department, position, status, join date).

### 04. Departments & Hierarchy (`DepartmentsPage.tsx`)
- **Two Tab Views:** Toggle between "Departments" (organizational divisions) and "Job Positions" (grades and titles).
- **Creation Dialogs:** Distinct forms for new department creation and position creation mapped to an existing department.

### 05. Work Shifts (`ShiftsPage.tsx`)
- **Shift Cards:** Displays standard shifts (Morning, Afternoon, Overnight, General Office, Weekend Rotation).
- **Overnight Flags:** Clearly differentiates shifts crossing midnight boundaries.
- **New Shift Template Creation:** Modal configuring start time, end time, and break allowances in minutes.

### 06. Roster & Schedules (`SchedulesPage.tsx`)
- **Schedule Feed:** Interactive cards showing assigned shift times, employee details, and status tags (`SCHEDULED`, `LEAVE`, `OFF`).
- **Filter Bar:** Filter schedules by specific employee and date.
- **Shift Assignment Modal:** Form for assigning any active employee to a scheduled shift with optional supervisor notes.

### 07. Attendance Tracking (`AttendancePage.tsx`)
- **Live Clock & Clock-In:** Real-time ticking WIB clock and interactive "Clock In Now" action creating immediate verified check-in records.
- **Audit Verification Badge:** Highlights records verified through Gateway HMAC signing.
- **Client CSV Generation:** Instantly downloads browser-generated CSV records matching current filter parameters.

### 08. Leave Management (`LeavesPage.tsx`)
- **Employee Application:** Form specifying leave type (`ANNUAL`, `SICK`, `SPECIAL_PERMISSION`, etc.), start/end dates, duration, and reason.
- **Manager Approval Modal:** Decision dialogue for `APPROVED` or `REJECTED` with required justification for rejections.
- **SQL v2.7.1 Enforced Guard:** Disables self-approval if a `BRANCH_MANAGER` attempts to approve their own request, presenting an explanatory security notification.

### 09. Executive Reports (`ReportsPage.tsx`)
- **Month Selector:** Filter aggregated summaries by billing/accounting period.
- **Export Capabilities:** One-click "Export CSV" creating formatted executive summaries; "Print Report" leveraging CSS print media queries.
- **Compliance Statement:** Summary of cryptographic audit preservation under `nexus_internal`.

### 10. User Management (`UserManagementPage.tsx`)
- **Access Guard:** Displays a locked barrier for non-SUPERADMIN users.
- **IAM Directory:** User avatars, email addresses, assigned roles, branch jurisdictions, and status toggles.
- **Account Status Modification:** Toggle between Active and Suspended states (prevents self-suspension).

### 11. Settings & Telemetry (`SettingsPage.tsx`)
- **Infrastructure Status:** Shows live telemetry for `nexus-central` (`wcmevigbqsmzsdqidjel`) and `nexus-branch-a` (`uneycmbqqpkifwhwzbes`).
- **Protocol Details:** Confirms HMAC SHA-256 v2.7 active protocol and anti-replay nonce configuration.
- **Demo State Reset:** Flushes `localStorage` cached sessions and restores original mock datasets.
