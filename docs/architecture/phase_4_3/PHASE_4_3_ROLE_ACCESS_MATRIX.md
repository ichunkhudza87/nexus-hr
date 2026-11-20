# NEXUS HR — PHASE 4.3: ROLE ACCESS & PERMISSION MATRIX

## 1. Role Definitions

| Role Identifier | Description | Data Scope Jurisdiction |
| :--- | :--- | :--- |
| **`SUPERADMIN`** | Chief Systems Administrator | Global — Central DB (`wcmevigbqsmzsdqidjel`) and all distributed branch nodes |
| **`BRANCH_MANAGER`** | Branch Operational Director | Local Branch (`uneycmbqqpkifwhwzbes` - Branch A Jakarta) |
| **`EMPLOYEE`** | Individual Staff Member | Self Record Scoped (Own attendance, schedules, leaves, and profile) |
| **`CENTRAL_HR`** | Corporate HR Specialist | Global personnel directory & cross-branch compliance |
| **`BRANCH_HR`** | Branch HR Specialist | Branch personnel records & roster coordination |

---

## 2. Navigational Access Matrix

| Navigation Item | `SUPERADMIN` | `BRANCH_MANAGER` | `EMPLOYEE` | `CENTRAL_HR` | `BRANCH_HR` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Overview** | Full Corporate | Branch Summary | Personal Summary | Full Corporate | Branch Summary |
| **Employees** | All Branches | Branch A Staff | Self Profile Only | All Branches | Branch A Staff |
| **Departments** | Read / Write | Read / Write | Hidden | Read / Write | Read / Write |
| **Positions** | Read / Write | Read / Write | Hidden | Read / Write | Read / Write |
| **Shifts** | Read / Write | Read / Write | Hidden | Read / Write | Read / Write |
| **Schedules** | All Staff | Branch A Roster | Own Roster Only | All Staff | Branch A Roster |
| **Attendance** | Full Logs | Branch A Logs | Own Logs Only | Full Logs | Branch A Logs |
| **Leave Requests** | Decide All | Decide Branch* | Apply & View Own | View All | Coordinate Branch |
| **Reports** | Global Export | Branch Export | Hidden | Global Export | Branch Export |
| **User Admin** | Read / Write | Access Denied | Access Denied | Access Denied | Access Denied |
| **Settings** | Full Telemetry | Node View | Profile View | Node View | Node View |

*\* Subject to SQL v2.7.1 self-approval prohibition.*

---

## 3. Operational Action Matrix

| Feature / Action | `SUPERADMIN` | `BRANCH_MANAGER` | `EMPLOYEE` | Enforcing Guard |
| :--- | :---: | :---: | :---: | :--- |
| **Add New Employee** | Allowed | Allowed | Denied | UI Modal + Role Gate |
| **Create Department / Position** | Allowed | Allowed | Denied | Navigation Filter |
| **Create Shift Template** | Allowed | Allowed | Denied | Navigation Filter |
| **Assign Shift Schedule** | Allowed | Allowed | Denied | UI Modal + Role Gate |
| **Clock In (Record Attendance)** | Allowed | Allowed | Allowed | `api.recordCheckIn` |
| **Export Attendance CSV** | Allowed | Allowed | Allowed | Browser Blob Generation |
| **Submit Leave Request** | Allowed | Allowed | Allowed | `api.submitLeaveRequest` |
| **Approve Peer Leave Request** | Allowed | Allowed | Denied | `api.decideLeaveRequest` |
| **Approve Own Leave Request** | Allowed | **PROHIBITED** | Denied | **SQL v2.7.1 Security Rule** |
| **Reject Leave Request** | Allowed | Allowed | Denied | Requires reason |
| **Export Executive Report** | Allowed | Allowed | Denied | UI Permission Check |
| **Provision User Account** | Allowed | Denied | Denied | UI Route Lock |
| **Suspend User Account** | Allowed | Denied | Denied | Protected against self-suspension |
| **Switch Demo Role** | Allowed | Allowed | Allowed | Demo Mode Switcher |

---

## 4. Security Enforcement Detail: Self-Approval Prohibition

Under PostgreSQL remediation v2.7.1 (`rpc_branch_decide_leave_request`), a Branch Manager is cryptographically and procedurally blocked from deciding their own leave application:

```typescript
// Guard implemented in src/pages/LeavesPage.tsx & src/services/api.ts
if (user?.role === 'BRANCH_MANAGER' && activeRequest.employeeId === user.employeeId) {
  showToast('error', 'Security Policy: Self-approval by Branch Manager is prohibited.');
  return;
}
```

When a Branch Manager views a pending request submitted under their own employee ID:
1. The action button displays as **"Self Request"** in warning amber.
2. The Decision Modal displays a dedicated alert box explaining the constraint.
3. The "Approve" and "Reject" buttons are strictly disabled.
4. The request must be escalated to a `SUPERADMIN` session for decision.
