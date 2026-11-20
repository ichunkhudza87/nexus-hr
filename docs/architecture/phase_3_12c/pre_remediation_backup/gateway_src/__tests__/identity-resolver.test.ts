import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IdentityResolver } from '../auth/identity-resolver.ts';
import type { BranchAClient } from '../clients/branch-rpc-client.ts';
import type { CentralDirectoryClient } from '../clients/central-client.ts';
import type { BranchEmployeeRecord, CentralUserProfile, VerifiedJwtClaims } from '../types/domain.ts';

const BRANCH_A_ID = '00000000-0000-0000-0000-000000000001';

function makeClaims(sub: string): VerifiedJwtClaims {
  return {
    sub,
    email: 'user@nexus.local',
    iss: 'https://central.example.supabase.co/auth/v1',
    aud: 'authenticated',
    exp: 1_900_000_000,
  };
}

function makeResolver(
  profile: CentralUserProfile | null,
  employees: BranchEmployeeRecord[],
): IdentityResolver {
  const centralClient: CentralDirectoryClient = {
    getUserProfileWithBranch: async () => profile,
  };
  const branchClient: BranchAClient = {
    getEmployeesByAuthId: async () => employees,
    decideLeaveRequest: async () => {
      throw new Error('Unused in unit test');
    },
    superadminUpdateLeaveRequest: async () => {
      throw new Error('Unused in unit test');
    },
  };
  return new IdentityResolver({
    centralClient,
    branchClient,
    expectedBranchAId: BRANCH_A_ID,
    expectedBranchACode: 'BRANCH-A',
  });
}

describe('IdentityResolver', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const empId = '22222222-2222-4222-8222-222222222222';

  it('resolves active BRANCH_MANAGER with matching branch and active employee', async () => {
    const resolver = makeResolver(
      {
        id: userId,
        email: 'mgr@nexus.local',
        role: 'BRANCH_MANAGER',
        branch_id: BRANCH_A_ID,
        is_active: true,
        branch: { id: BRANCH_A_ID, code: 'BRANCH-A', is_active: true },
      },
      [{ id: empId, user_auth_id: userId, is_active: true, is_deleted: false }],
    );

    const actor = await resolver.resolveActor(makeClaims(userId));
    assert.deepEqual(actor, {
      actorUserId: userId,
      actorEmail: 'mgr@nexus.local',
      actorRole: 'BRANCH_MANAGER',
      branchId: BRANCH_A_ID,
      employeeId: empId,
    });
  });

  it('resolves SUPERADMIN even without a local Branch A employee row', async () => {
    const resolver = makeResolver(
      {
        id: userId,
        email: 'admin@nexus.local',
        role: 'SUPERADMIN',
        branch_id: null,
        is_active: true,
        branch: null,
      },
      [],
    );

    const actor = await resolver.resolveActor(makeClaims(userId));
    assert.equal(actor.actorRole, 'SUPERADMIN');
    assert.equal(actor.employeeId, null);
    assert.equal(actor.branchId, null);
  });

  it('fails closed when Central profile is missing or inactive', async () => {
    await assert.rejects(
      () => makeResolver(null, []).resolveActor(makeClaims(userId)),
      /does not exist/,
    );

    await assert.rejects(
      () =>
        makeResolver(
          {
            id: userId,
            email: 'mgr@nexus.local',
            role: 'BRANCH_MANAGER',
            branch_id: BRANCH_A_ID,
            is_active: false,
            branch: { id: BRANCH_A_ID, code: 'BRANCH-A', is_active: true },
          },
          [{ id: empId, user_auth_id: userId, is_active: true, is_deleted: false }],
        ).resolveActor(makeClaims(userId)),
      /deactivated/,
    );
  });

  it('fails closed on branch mismatch or deactivated branch', async () => {
    await assert.rejects(
      () =>
        makeResolver(
          {
            id: userId,
            email: 'mgr@nexus.local',
            role: 'BRANCH_MANAGER',
            branch_id: '00000000-0000-0000-0000-000000000099',
            is_active: true,
            branch: { id: '00000000-0000-0000-0000-000000000099', code: 'BRANCH-B', is_active: true },
          },
          [{ id: empId, user_auth_id: userId, is_active: true, is_deleted: false }],
        ).resolveActor(makeClaims(userId)),
      /not assigned to Branch A/,
    );

    await assert.rejects(
      () =>
        makeResolver(
          {
            id: userId,
            email: 'mgr@nexus.local',
            role: 'BRANCH_MANAGER',
            branch_id: BRANCH_A_ID,
            is_active: true,
            branch: { id: BRANCH_A_ID, code: 'BRANCH-A', is_active: false },
          },
          [{ id: empId, user_auth_id: userId, is_active: true, is_deleted: false }],
        ).resolveActor(makeClaims(userId)),
      /inactive/,
    );
  });

  it('fails closed when BRANCH_MANAGER employee identity is missing, inactive, or deleted', async () => {
    const validProfile: CentralUserProfile = {
      id: userId,
      email: 'mgr@nexus.local',
      role: 'BRANCH_MANAGER',
      branch_id: BRANCH_A_ID,
      is_active: true,
      branch: { id: BRANCH_A_ID, code: 'BRANCH-A', is_active: true },
    };

    await assert.rejects(
      () => makeResolver(validProfile, []).resolveActor(makeClaims(userId)),
      /employee identity is required/,
    );

    await assert.rejects(
      () =>
        makeResolver(validProfile, [
          { id: empId, user_auth_id: userId, is_active: false, is_deleted: false },
        ]).resolveActor(makeClaims(userId)),
      /employee identity is required/,
    );
  });
});
