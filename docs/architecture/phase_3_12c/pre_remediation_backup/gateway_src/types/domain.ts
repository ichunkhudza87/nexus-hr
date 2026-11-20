export const USER_ROLES = [
  'SUPERADMIN',
  'CENTRAL_HR',
  'BRANCH_MANAGER',
  'BRANCH_HR',
  'EMPLOYEE',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const LEAVE_TYPES = [
  'ANNUAL',
  'SICK',
  'MATERNITY',
  'UNPAID',
  'SPECIAL_PERMISSION',
] as const;

export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;

export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export type ActionScope = 'LEAVE_DECIDE' | 'LEAVE_SUPERADMIN_UPDATE';
export type OperationMode = 'DECISION' | 'CORRECTION';

export interface VerifiedJwtClaims {
  sub: string;
  email?: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  jti?: string;
}

export interface CentralUserProfile {
  id: string;
  email: string;
  role: UserRole;
  branch_id: string | null;
  is_active: boolean;
  branch?: {
    id: string;
    code: string;
    is_active: boolean;
  } | null;
}

export interface BranchEmployeeRecord {
  id: string;
  user_auth_id: string | null;
  is_active: boolean;
  is_deleted: boolean;
}

export interface ResolvedActor {
  actorUserId: string;
  actorEmail: string;
  actorRole: UserRole;
  branchId: string | null;
  employeeId: string | null;
}

export interface HmacSigningKeyRecord {
  keyId: string;
  secret: string;
  isActive: boolean;
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
}

export interface SignedActorEnvelope {
  keyId: string;
  actionScope: ActionScope;
  targetId: string;
  operationMode: OperationMode;
  actorUserId: string;
  actorEmail: string;
  actorRole: UserRole;
  branchId: string | null;
  employeeId: string | null;
  exp: number;
  nonce: string;
  actorSig: string;
}

export interface LeaveDecisionInput {
  requestId: string;
  decision: 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
}

export interface SuperadminLeaveUpdateInput {
  requestId: string;
  operationMode: OperationMode;
  employeeId?: string | null;
  leaveType?: LeaveType | null;
  startDate?: string | null;
  endDate?: string | null;
  totalDays?: number | null;
  reason?: string | null;
  status?: LeaveStatus | null;
  rejectionReason?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
}

export interface LeaveRequestRecord {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  status: LeaveStatus;
  submitted_at: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}
