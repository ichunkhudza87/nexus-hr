import type { BranchAClient } from '../clients/branch-rpc-client.ts';
import type { CentralDirectoryClient } from '../clients/central-client.ts';
import { GatewayError } from '../errors/gateway-error.ts';
import { USER_ROLES } from '../types/domain.ts';
import type { ResolvedActor, VerifiedJwtClaims } from '../types/domain.ts';

export interface IdentityResolverOptions {
  centralClient: CentralDirectoryClient;
  branchClient: BranchAClient;
  expectedBranchAId: string;
  expectedBranchACode: string;
}

export class IdentityResolver {
  private readonly centralClient: CentralDirectoryClient;
  private readonly branchClient: BranchAClient;
  private readonly expectedBranchAId: string;
  private readonly expectedBranchACode: string;

  constructor(options: IdentityResolverOptions) {
    this.centralClient = options.centralClient;
    this.branchClient = options.branchClient;
    this.expectedBranchAId = options.expectedBranchAId.toLowerCase();
    this.expectedBranchACode = options.expectedBranchACode;
  }

  /**
   * Resolves authoritative role, branch membership, and Branch A employee_id
   * exclusively from server-side databases using verified JWT sub.
   * Fails closed on any missing, inactive, mismatched, or ambiguous record.
   */
  async resolveActor(claims: VerifiedJwtClaims): Promise<ResolvedActor> {
    const profile = await this.centralClient.getUserProfileWithBranch(claims.sub);
    if (!profile) {
      throw new GatewayError(403, 'PROFILE_NOT_FOUND', 'Central user profile does not exist.');
    }
    if (profile.is_active !== true) {
      throw new GatewayError(403, 'ACCOUNT_INACTIVE', 'User account is deactivated.');
    }
    if (!profile.email || profile.email.trim() === '') {
      throw new GatewayError(403, 'INVALID_PROFILE', 'User profile missing email identity.');
    }
    if (!USER_ROLES.includes(profile.role)) {
      throw new GatewayError(403, 'INVALID_ROLE', 'Unrecognized user role.');
    }

    const isEnterpriseRole = profile.role === 'SUPERADMIN' || profile.role === 'CENTRAL_HR';
    let resolvedBranchId: string | null = profile.branch_id ? profile.branch_id.toLowerCase() : null;

    if (!isEnterpriseRole) {
      if (!resolvedBranchId || resolvedBranchId !== this.expectedBranchAId) {
        throw new GatewayError(403, 'BRANCH_MISMATCH', 'User is not assigned to Branch A.');
      }
      if (!profile.branch || profile.branch.is_active !== true) {
        throw new GatewayError(403, 'BRANCH_INACTIVE', 'Assigned branch is inactive or missing.');
      }
      if (profile.branch.code !== this.expectedBranchACode) {
        throw new GatewayError(403, 'BRANCH_MISMATCH', 'Assigned branch code mismatch.');
      }
    }

    const employeeRows = await this.branchClient.getEmployeesByAuthId(profile.id);
    const activeEmployees = employeeRows.filter(
      (e) => e.is_deleted === false && e.is_active === true && e.user_auth_id?.toLowerCase() === profile.id.toLowerCase(),
    );

    if (activeEmployees.length > 1) {
      throw new GatewayError(409, 'EMPLOYEE_AMBIGUOUS', 'Multiple active employee records bound to user.');
    }

    let employeeId: string | null = activeEmployees[0]?.id.toLowerCase() ?? null;

    if (profile.role === 'BRANCH_MANAGER' || profile.role === 'BRANCH_HR' || profile.role === 'EMPLOYEE') {
      if (!employeeId) {
        throw new GatewayError(403, 'EMPLOYEE_IDENTITY_MISSING', 'Active Branch A employee identity is required.');
      }
    }

    return {
      actorUserId: profile.id.toLowerCase(),
      actorEmail: profile.email.trim().toLowerCase(),
      actorRole: profile.role,
      branchId: resolvedBranchId,
      employeeId,
    };
  }
}
