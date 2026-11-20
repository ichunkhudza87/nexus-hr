import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createGatewayServer } from '../app.ts';
import { CentralJwtVerifier } from '../auth/central-jwt.ts';
import { IdentityResolver } from '../auth/identity-resolver.ts';
import type { BranchAClient } from '../clients/branch-rpc-client.ts';
import type { CentralDirectoryClient } from '../clients/central-client.ts';
import { ActorHmacSigner } from '../security/hmac-signer.ts';
import { NonceStore } from '../security/nonce-store.ts';
import { LeaveService } from '../services/leave-service.ts';
import type {
  AttendanceQuery,
  AttendanceRecord,
  BranchEmployeeDetailRecord,
  BranchEmployeeRecord,
  BranchEmployeesQuery,
  CentralUserProfile,
  EmployeeScheduleRecord,
  LeaveRequestRecord,
  LeaveRequestsQuery,
  PaginatedResult,
  SchedulesQuery,
  ShiftRecord,
  ShiftsQuery,
} from '../types/domain.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const PUBLIC_JWK = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'central-rsa-key-1',
  alg: 'RS256',
  use: 'sig',
};
const ISSUER = 'https://central.nexus.local/auth/v1';
const AUDIENCE = 'authenticated';
const BRANCH_A_ID = '00000000-0000-0000-0000-000000000001';
const VALID_HMAC_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function createSignedJwt(payload: Record<string, unknown>, keyId = 'central-rsa-key-1'): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: keyId };
  const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const pB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${hB64}.${pB64}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

describe('Gateway HTTP Read Endpoints & CORS Hardening', () => {
  it('handles CORS preflight and origin allowlist enforcement', async () => {
    const jwtVerifier = new CentralJwtVerifier({
      jwksUrl: 'https://mock.local/jwks',
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
      fetchFn: async () => new Response(JSON.stringify({ keys: [PUBLIC_JWK] }), { status: 200 }),
    });

    const mockCentral: CentralDirectoryClient = {
      getUserProfileWithBranch: async () => null,
      getDashboardSummary: async () => ({ items: [], page: 1, pageSize: 20, totalCount: 0 }),
      getEmployeeDirectory: async () => ({ items: [], page: 1, pageSize: 20, totalCount: 0 }),
    };

    const mockBranch: BranchAClient = {
      getEmployeesByAuthId: async () => [],
      getEmployees: async () => ({ items: [], page: 1, pageSize: 20, totalCount: 0 }),
      getShifts: async () => ({ items: [], page: 1, pageSize: 20, totalCount: 0 }),
      getSchedules: async () => ({ items: [], page: 1, pageSize: 20, totalCount: 0 }),
      getAttendance: async () => ({ items: [], page: 1, pageSize: 20, totalCount: 0 }),
      getLeaveRequests: async () => ({ items: [], page: 1, pageSize: 20, totalCount: 0 }),
      decideLeaveRequest: async () => { throw new Error('not implemented'); },
      superadminUpdateLeaveRequest: async () => { throw new Error('not implemented'); },
    };

    const identityResolver = new IdentityResolver({
      centralClient: mockCentral,
      branchClient: mockBranch,
      expectedBranchAId: BRANCH_A_ID,
      expectedBranchACode: 'BRANCH-A',
    });

    const hmacSigner = new ActorHmacSigner(
      [{
        keyId: 'gw-key-1',
        secret: VALID_HMAC_SECRET,
        isActive: true,
        createdAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
        rotatedAt: null,
        expiresAt: null,
        revokedAt: null,
      }],
      'gw-key-1',
    );
    const nonceStore = new NonceStore();
    const leaveService = new LeaveService({
      branchClient: mockBranch,
      hmacSigner,
      nonceStore,
      actorTtlSeconds: 60,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const server = createGatewayServer({
      jwtVerifier,
      identityResolver,
      leaveService,
      nonceStore,
      hmacSigner,
      branchAId: BRANCH_A_ID,
      centralClient: mockCentral,
      branchClient: mockBranch,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      corsAllowedOrigins: ['https://admin.nexus.local'],
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      // 1. Preflight OPTIONS from allowed origin -> 204 with CORS headers
      const optRes = await fetch(`http://localhost:${port}/api/dashboard/summary`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://admin.nexus.local',
          'Access-Control-Request-Method': 'GET',
        },
      });
      assert.equal(optRes.status, 204);
      assert.equal(optRes.headers.get('access-control-allow-origin'), 'https://admin.nexus.local');
      assert.equal(optRes.headers.get('access-control-allow-credentials'), 'true');

      // 2. Request from disallowed origin -> 403 CORS_FORBIDDEN
      const badOriginRes = await fetch(`http://localhost:${port}/api/dashboard/summary`, {
        method: 'GET',
        headers: {
          Origin: 'https://evil.local',
        },
      });
      assert.equal(badOriginRes.status, 403);
      const badOriginJson = await badOriginRes.json() as { error: { code: string } };
      assert.equal(badOriginJson.error.code, 'CORS_FORBIDDEN');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('serves role-isolated read endpoints for SUPERADMIN and EMPLOYEE', async () => {
    const jwtVerifier = new CentralJwtVerifier({
      jwksUrl: 'https://mock.local/jwks',
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
      fetchFn: async () => new Response(JSON.stringify({ keys: [PUBLIC_JWK] }), { status: 200 }),
    });

    const userMap: Record<string, CentralUserProfile> = {
      '00000000-0000-0000-0000-00000000000a': {
        id: '00000000-0000-0000-0000-00000000000a',
        email: 'admin@nexus.local',
        role: 'SUPERADMIN',
        branch_id: null,
        is_active: true,
      },
      '00000000-0000-0000-0000-00000000000b': {
        id: '00000000-0000-0000-0000-00000000000b',
        email: 'emp@nexus.local',
        role: 'EMPLOYEE',
        branch_id: BRANCH_A_ID,
        is_active: true,
        branch: { id: BRANCH_A_ID, code: 'BRANCH-A', is_active: true },
      },
    };

    let capturedBranchEmpQuery: BranchEmployeesQuery | null = null;
    let capturedLeaveQuery: LeaveRequestsQuery | null = null;

    const mockCentral: CentralDirectoryClient = {
      getUserProfileWithBranch: async (userId: string) => userMap[userId] ?? null,
      getDashboardSummary: async (q) => ({
        items: [
          {
            id: 'sum-1',
            branch_id: q.branchId ?? BRANCH_A_ID,
            summary_date: '2026-11-12',
            total_employees: 10,
            present_count: 8,
            late_count: 1,
            absent_count: 1,
            leave_count: 0,
            last_synced_at: new Date().toISOString(),
          },
        ],
        page: q.page,
        pageSize: q.pageSize,
        totalCount: 1,
      }),
      getEmployeeDirectory: async (q) => ({
        items: [
          {
            id: 'emp-dir-1',
            branch_id: q.branchId ?? BRANCH_A_ID,
            employee_code: 'EMP-A-0001',
            full_name: 'Budi Santoso',
            email: 'budi@nexus.local',
            department_name: 'HR',
            position_title: 'Staff',
            employment_status: 'PERMANENT',
            join_date: '2026-01-01',
            is_active: true,
            last_synced_at: new Date().toISOString(),
          },
        ],
        page: q.page,
        pageSize: q.pageSize,
        totalCount: 1,
      }),
    };

    const mockBranch: BranchAClient = {
      getEmployeesByAuthId: async (userAuthId: string) => [
        {
          id: '00000000-0000-0000-0000-00000000000e',
          user_auth_id: userAuthId,
          is_active: true,
          is_deleted: false,
        },
      ],
      getEmployees: async (q: BranchEmployeesQuery) => {
        capturedBranchEmpQuery = q;
        return {
          items: [
            {
              id: q.employeeId ?? '00000000-0000-0000-0000-00000000000e',
              employee_code: 'EMP-A-0001',
              user_auth_id: '00000000-0000-0000-0000-00000000000b',
              department_id: '00000000-0000-0000-0000-000000000001',
              position_id: '00000000-0000-0000-0000-000000000002',
              full_name: 'Budi Santoso',
              email: 'budi@nexus.local',
              phone_number: null,
              employment_status: 'PERMANENT',
              join_date: '2026-01-01',
              resignation_date: null,
              is_active: true,
              is_deleted: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          page: q.page,
          pageSize: q.pageSize,
          totalCount: 1,
        };
      },
      getShifts: async (q: ShiftsQuery) => ({
        items: [
          {
            id: 'shift-1',
            code: 'REG-1',
            name: 'Regular Morning',
            start_time: '08:00:00',
            end_time: '17:00:00',
            is_overnight: false,
            break_duration_mins: 60,
            is_active: true,
          },
        ],
        page: q.page,
        pageSize: q.pageSize,
        totalCount: 1,
      }),
      getSchedules: async (q: SchedulesQuery) => ({
        items: [
          {
            id: 'sched-1',
            employee_id: q.employeeId ?? 'emp-1',
            shift_id: 'shift-1',
            schedule_date: '2026-11-12',
            status: 'SCHEDULED',
            notes: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        page: q.page,
        pageSize: q.pageSize,
        totalCount: 1,
      }),
      getAttendance: async (q: AttendanceQuery) => ({
        items: [
          {
            id: 'att-1',
            schedule_id: 'sched-1',
            employee_id: q.employeeId ?? 'emp-1',
            attendance_date: '2026-11-12',
            check_in_time: '2026-11-12T08:05:00Z',
            check_out_time: '2026-11-12T17:02:00Z',
            status: 'ON_TIME',
            check_in_method: 'MANUAL_WEB',
            check_out_method: 'MANUAL_WEB',
            is_verified: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        page: q.page,
        pageSize: q.pageSize,
        totalCount: 1,
      }),
      getLeaveRequests: async (q: LeaveRequestsQuery) => {
        capturedLeaveQuery = q;
        return {
          items: [
            {
              id: 'leave-1',
              employee_id: q.employeeId ?? 'emp-1',
              leave_type: 'ANNUAL',
              start_date: '2026-12-01',
              end_date: '2026-12-02',
              total_days: 2,
              reason: 'Vacation',
              status: 'APPROVED',
              submitted_at: new Date().toISOString(),
              approved_by: 'admin-1',
              approved_at: new Date().toISOString(),
              rejection_reason: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          page: q.page,
          pageSize: q.pageSize,
          totalCount: 1,
        };
      },
      decideLeaveRequest: async () => { throw new Error('not implemented'); },
      superadminUpdateLeaveRequest: async () => { throw new Error('not implemented'); },
    };

    const identityResolver = new IdentityResolver({
      centralClient: mockCentral,
      branchClient: mockBranch,
      expectedBranchAId: BRANCH_A_ID,
      expectedBranchACode: 'BRANCH-A',
    });

    const hmacSigner = new ActorHmacSigner(
      [{
        keyId: 'gw-key-1',
        secret: VALID_HMAC_SECRET,
        isActive: true,
        createdAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
        rotatedAt: null,
        expiresAt: null,
        revokedAt: null,
      }],
      'gw-key-1',
    );
    const nonceStore = new NonceStore();
    const leaveService = new LeaveService({
      branchClient: mockBranch,
      hmacSigner,
      nonceStore,
      actorTtlSeconds: 60,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const server = createGatewayServer({
      jwtVerifier,
      identityResolver,
      leaveService,
      nonceStore,
      hmacSigner,
      branchAId: BRANCH_A_ID,
      centralClient: mockCentral,
      branchClient: mockBranch,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const adminJwt = createSignedJwt({
        sub: '00000000-0000-0000-0000-00000000000a',
        iss: ISSUER,
        aud: AUDIENCE,
        exp: nowEpoch + 3600,
      });
      const employeeJwt = createSignedJwt({
        sub: '00000000-0000-0000-0000-00000000000b',
        iss: ISSUER,
        aud: AUDIENCE,
        exp: nowEpoch + 3600,
      });

      // 1. Unauthenticated request to /api/dashboard/summary -> 401 MISSING_TOKEN
      const unauthRes = await fetch(`http://localhost:${port}/api/dashboard/summary`);
      assert.equal(unauthRes.status, 401);

      // 2. SUPERADMIN queries /api/dashboard/summary
      const adminDashRes = await fetch(`http://localhost:${port}/api/dashboard/summary?page=1&page_size=10`, {
        headers: { Authorization: `Bearer ${adminJwt}` },
      });
      assert.equal(adminDashRes.status, 200);
      const adminDashJson = await adminDashRes.json() as { data: PaginatedResult<unknown> };
      assert.equal(adminDashJson.data.items.length, 1);

      // 3. SUPERADMIN queries /api/employees/directory with valid filter
      const dirRes = await fetch(`http://localhost:${port}/api/employees/directory?search=Budi&sort_by=full_name`, {
        headers: { Authorization: `Bearer ${adminJwt}` },
      });
      assert.equal(dirRes.status, 200);

      // 4. EMPLOYEE queries /api/employees -> automatically scoped to own employee_id
      const empRes = await fetch(`http://localhost:${port}/api/employees`, {
        headers: { Authorization: `Bearer ${employeeJwt}` },
      });
      assert.equal(empRes.status, 200);
      assert.equal(capturedBranchEmpQuery?.employeeId, '00000000-0000-0000-0000-00000000000e');

      // 5. EMPLOYEE queries /api/leave-requests -> automatically scoped to own employee_id
      const leaveRes = await fetch(`http://localhost:${port}/api/leave-requests`, {
        headers: { Authorization: `Bearer ${employeeJwt}` },
      });
      assert.equal(leaveRes.status, 200);
      assert.equal(capturedLeaveQuery?.employeeId, '00000000-0000-0000-0000-00000000000e');

      // 6. Query with forbidden actor parameter (e.g. ?role=SUPERADMIN) is rejected
      const tamperedRes = await fetch(`http://localhost:${port}/api/employees?role=SUPERADMIN`, {
        headers: { Authorization: `Bearer ${employeeJwt}` },
      });
      assert.equal(tamperedRes.status, 400);
      const tamperedJson = await tamperedRes.json() as { error: { code: string } };
      assert.equal(tamperedJson.error.code, 'FORBIDDEN_IDENTITY_FIELD');

      // 7. Shifts, schedules, and attendance read endpoints return 200
      const shiftsRes = await fetch(`http://localhost:${port}/api/shifts`, {
        headers: { Authorization: `Bearer ${employeeJwt}` },
      });
      assert.equal(shiftsRes.status, 200);

      const schedRes = await fetch(`http://localhost:${port}/api/schedules`, {
        headers: { Authorization: `Bearer ${employeeJwt}` },
      });
      assert.equal(schedRes.status, 200);

      const attRes = await fetch(`http://localhost:${port}/api/attendance`, {
        headers: { Authorization: `Bearer ${employeeJwt}` },
      });
      assert.equal(attRes.status, 200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
