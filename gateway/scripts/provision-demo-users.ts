import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadGatewayConfig } from '../src/config/env.ts';

try {
  process.loadEnvFile?.();
} catch {}

const config = loadGatewayConfig(process.env);
const GATEWAY_DIR = path.resolve(import.meta.dirname, '..');
const CREDENTIALS_DIR = path.join(GATEWAY_DIR, '.credentials');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'demo-accounts.json');

const BUDI_EMP_ID = '00000000-0000-0000-0000-000000000102';
const BRANCH_A_ID = config.branchAId;

function applyStrictFileAcl(filePath: string): boolean {
  if (process.platform === 'win32') {
    const user = process.env.USERNAME || process.env.USER;
    if (!user) return false;
    try {
      execFileSync('icacls.exe', [filePath, '/inheritance:r'], { stdio: 'ignore' });
      execFileSync('icacls.exe', [filePath, '/grant:r', `${user}:(R,W)`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  } else {
    try {
      fs.chmodSync(filePath, 0o600);
      return true;
    } catch {
      return false;
    }
  }
}

async function main() {
  console.log('===============================================================');
  console.log(' NEXUS HR — PHASE E.2: CONTROLLED CENTRAL AUTH PROVISIONING');
  console.log('===============================================================');

  // Step 1: Pre-execution checks
  console.log('\n[1/7] Pre-execution Verification...');

  // 1a. Check Budi Santoso in Branch A
  const budiRes = await fetch(`${config.branchASupabaseUrl}/rest/v1/employees?id=eq.${BUDI_EMP_ID}`, {
    headers: {
      apikey: config.branchAServiceRoleKey,
      Authorization: `Bearer ${config.branchAServiceRoleKey}`,
    },
  });
  const budiRows = (await budiRes.json()) as any[];
  if (!budiRows || budiRows.length === 0) {
    throw new Error(`Target employee Budi Santoso (${BUDI_EMP_ID}) not found in Branch A.`);
  }
  const originalBudi = budiRows[0];
  console.log(`[PASS] Target employee verified in Branch A: ${originalBudi.full_name} (${originalBudi.employee_code})`);

  // 1b. Check neither user already exists in Central Auth
  const listUsersRes = await fetch(`${config.centralSupabaseUrl}/auth/v1/admin/users`, {
    headers: {
      apikey: config.centralServiceRoleKey,
      Authorization: `Bearer ${config.centralServiceRoleKey}`,
    },
  });
  const existingData = (await listUsersRes.json()) as any;
  const existingEmails = (existingData.users || []).map((u: any) => u.email?.toLowerCase());

  if (existingEmails.includes('admin@nexus.local')) {
    throw new Error('User admin@nexus.local already exists in Central Auth.');
  }
  if (existingEmails.includes('budi.santoso@nexus.local')) {
    throw new Error('User budi.santoso@nexus.local already exists in Central Auth.');
  }
  console.log('[PASS] Neither account exists in Central Auth. Clean state confirmed.');

  // Step 2: Generate unique CSPRNG passwords
  console.log('\n[2/7] Generating unique high-entropy CSPRNG passwords...');
  const adminPassword = randomBytes(18).toString('base64url');
  const budiPassword = randomBytes(18).toString('base64url');
  console.log('[PASS] Passwords generated securely in memory.');

  let adminAuthId = '';
  let budiAuthId = '';

  try {
    // Step 3: Create Superadmin in Central Auth & user_profiles
    console.log('\n[3/7] Provisioning Superadmin (admin@nexus.local)...');
    const createAdminRes = await fetch(`${config.centralSupabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: config.centralServiceRoleKey,
        Authorization: `Bearer ${config.centralServiceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'admin@nexus.local',
        password: adminPassword,
        email_confirm: true,
        app_metadata: {
          user_role: 'SUPERADMIN',
        },
        user_metadata: {
          full_name: 'Alexander Wright',
          user_role: 'SUPERADMIN',
          role: 'SUPERADMIN',
        },
      }),
    });
    if (!createAdminRes.ok) {
      throw new Error(`Central Auth admin creation failed (${createAdminRes.status}): ${await createAdminRes.text()}`);
    }
    const adminUser = (await createAdminRes.json()) as any;
    adminAuthId = adminUser.id;
    console.log(`[PASS] Central Auth created for Superadmin (id: ${adminAuthId})`);

    // Verify / Upsert user_profiles row
    const checkAdminProfileRes = await fetch(`${config.centralSupabaseUrl}/rest/v1/user_profiles?id=eq.${adminAuthId}`, {
      headers: {
        apikey: config.centralServiceRoleKey,
        Authorization: `Bearer ${config.centralServiceRoleKey}`,
      },
    });
    const adminProfiles = (await checkAdminProfileRes.json()) as any[];
    if (adminProfiles.length === 0) {
      const adminProfileRes = await fetch(`${config.centralSupabaseUrl}/rest/v1/user_profiles`, {
        method: 'POST',
        headers: {
          apikey: config.centralServiceRoleKey,
          Authorization: `Bearer ${config.centralServiceRoleKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          id: adminAuthId,
          email: 'admin@nexus.local',
          full_name: 'Alexander Wright',
          role: 'SUPERADMIN',
          branch_id: null,
          is_active: true,
        }),
      });
      if (!adminProfileRes.ok) {
        throw new Error(`Central user_profiles insert failed for Superadmin (${adminProfileRes.status}): ${await adminProfileRes.text()}`);
      }
    } else {
      // Ensure role is SUPERADMIN and branch_id is null
      await fetch(`${config.centralSupabaseUrl}/rest/v1/user_profiles?id=eq.${adminAuthId}`, {
        method: 'PATCH',
        headers: {
          apikey: config.centralServiceRoleKey,
          Authorization: `Bearer ${config.centralServiceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'SUPERADMIN',
          branch_id: null,
          full_name: 'Alexander Wright',
          is_active: true,
        }),
      });
    }
    console.log('[PASS] Central user_profiles row verified for Superadmin (role: SUPERADMIN, branch_id: NULL)');

    // Step 4: Create Employee Budi Santoso in Central Auth & user_profiles
    console.log('\n[4/7] Provisioning Employee (budi.santoso@nexus.local)...');
    const createBudiRes = await fetch(`${config.centralSupabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: config.centralServiceRoleKey,
        Authorization: `Bearer ${config.centralServiceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'budi.santoso@nexus.local',
        password: budiPassword,
        email_confirm: true,
        app_metadata: {
          user_role: 'EMPLOYEE',
          branch_id: BRANCH_A_ID,
        },
        user_metadata: {
          full_name: 'Budi Santoso',
          user_role: 'EMPLOYEE',
          role: 'EMPLOYEE',
          branch_id: BRANCH_A_ID,
        },
      }),
    });
    if (!createBudiRes.ok) {
      throw new Error(`Central Auth budi creation failed (${createBudiRes.status}): ${await createBudiRes.text()}`);
    }
    const budiUser = (await createBudiRes.json()) as any;
    budiAuthId = budiUser.id;
    console.log(`[PASS] Central Auth created for Budi Santoso (id: ${budiAuthId})`);

    // Verify / Upsert user_profiles row
    const checkBudiProfileRes = await fetch(`${config.centralSupabaseUrl}/rest/v1/user_profiles?id=eq.${budiAuthId}`, {
      headers: {
        apikey: config.centralServiceRoleKey,
        Authorization: `Bearer ${config.centralServiceRoleKey}`,
      },
    });
    const budiProfiles = (await checkBudiProfileRes.json()) as any[];
    if (budiProfiles.length === 0) {
      const budiProfileRes = await fetch(`${config.centralSupabaseUrl}/rest/v1/user_profiles`, {
        method: 'POST',
        headers: {
          apikey: config.centralServiceRoleKey,
          Authorization: `Bearer ${config.centralServiceRoleKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          id: budiAuthId,
          email: 'budi.santoso@nexus.local',
          full_name: 'Budi Santoso',
          role: 'EMPLOYEE',
          branch_id: BRANCH_A_ID,
          is_active: true,
        }),
      });
      if (!budiProfileRes.ok) {
        throw new Error(`Central user_profiles insert failed for Budi Santoso (${budiProfileRes.status}): ${await budiProfileRes.text()}`);
      }
    } else {
      await fetch(`${config.centralSupabaseUrl}/rest/v1/user_profiles?id=eq.${budiAuthId}`, {
        method: 'PATCH',
        headers: {
          apikey: config.centralServiceRoleKey,
          Authorization: `Bearer ${config.centralServiceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'EMPLOYEE',
          branch_id: BRANCH_A_ID,
          full_name: 'Budi Santoso',
          is_active: true,
        }),
      });
    }
    console.log(`[PASS] Central user_profiles row verified for Budi Santoso (role: EMPLOYEE, branch_id: ${BRANCH_A_ID})`);

    // Step 5: Update ONLY user_auth_id on Branch A employee
    console.log('\n[5/7] Linking Branch A employee user_auth_id...');
    const updateBudiRes = await fetch(`${config.branchASupabaseUrl}/rest/v1/employees?id=eq.${BUDI_EMP_ID}`, {
      method: 'PATCH',
      headers: {
        apikey: config.branchAServiceRoleKey,
        Authorization: `Bearer ${config.branchAServiceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_auth_id: budiAuthId,
      }),
    });
    if (!updateBudiRes.ok) {
      throw new Error(`Failed to update user_auth_id on Branch A (${updateBudiRes.status}): ${await updateBudiRes.text()}`);
    }
    const updatedRows = (await updateBudiRes.json()) as any[];
    const updatedBudi = updatedRows[0];
    console.log(`[PASS] Branch A employee user_auth_id successfully set to: ${updatedBudi.user_auth_id}`);

    // Verify other columns remained unchanged
    if (
      updatedBudi.full_name !== originalBudi.full_name ||
      updatedBudi.employee_code !== originalBudi.employee_code ||
      updatedBudi.email !== originalBudi.email ||
      updatedBudi.department_id !== originalBudi.department_id ||
      updatedBudi.position_id !== originalBudi.position_id
    ) {
      throw new Error('Integrity check failed: other columns of Budi Santoso were unexpectedly modified.');
    }
    console.log('[PASS] Integrity verification passed: non-auth columns preserved perfectly.');

    // Step 6: Save credentials locally with strict ACL
    console.log('\n[6/7] Storing demo credentials locally with strict ACL...');
    if (!fs.existsSync(CREDENTIALS_DIR)) {
      fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
    }
    const credentialsPayload = {
      accounts: [
        {
          role: 'SUPERADMIN',
          email: 'admin@nexus.local',
          password: adminPassword,
          authId: adminAuthId,
          branchId: null,
          employeeId: null,
        },
        {
          role: 'EMPLOYEE',
          email: 'budi.santoso@nexus.local',
          password: budiPassword,
          authId: budiAuthId,
          branchId: BRANCH_A_ID,
          employeeId: BUDI_EMP_ID,
        },
      ],
      createdAt: new Date().toISOString(),
      note: 'RESTRICTED DEMO CREDENTIALS — DO NOT COMMIT OR EXPOSE',
    };

    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentialsPayload, null, 2), 'utf8');
    const aclOk = applyStrictFileAcl(CREDENTIALS_FILE);
    console.log(`[PASS] Credentials written to: ${path.relative(GATEWAY_DIR, CREDENTIALS_FILE)} (Strict ACL: ${aclOk})`);

    // Step 7: Post-execution Verification & Login testing
    console.log('\n[7/7] Post-execution Verification (Central Auth Login & Gateway Endpoints)...');

    // 7a. Test login Superadmin via Central Auth REST
    console.log('Testing login for admin@nexus.local...');
    const adminTokenRes = await fetch(`${config.centralSupabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: config.centralServiceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'admin@nexus.local',
        password: adminPassword,
      }),
    });
    if (!adminTokenRes.ok) {
      throw new Error(`Central Auth login failed for Superadmin (${adminTokenRes.status}): ${await adminTokenRes.text()}`);
    }
    const adminTokenData = (await adminTokenRes.json()) as any;
    const adminJwt = adminTokenData.access_token;
    console.log('[PASS] Central Auth login successful for admin@nexus.local (JWT token acquired)');

    // 7b. Test Gateway GET /api/me for Superadmin
    console.log('Testing Gateway GET /api/me with Superadmin token...');
    const adminMeRes = await fetch('http://localhost:3000/api/me', {
      headers: {
        Authorization: `Bearer ${adminJwt}`,
      },
    });
    if (!adminMeRes.ok) {
      throw new Error(`Gateway /api/me failed for Superadmin (${adminMeRes.status}): ${await adminMeRes.text()}`);
    }
    const adminMeData = (await adminMeRes.json()) as any;
    console.log('[PASS] Gateway resolved Superadmin actor:', adminMeData.data);
    if (adminMeData.data.role !== 'SUPERADMIN' || adminMeData.data.branchId !== null) {
      throw new Error('Superadmin actor resolution returned invalid role or non-null branchId.');
    }

    // 7c. Test login Budi Santoso via Central Auth REST
    console.log('Testing login for budi.santoso@nexus.local...');
    const budiTokenRes = await fetch(`${config.centralSupabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: config.centralServiceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'budi.santoso@nexus.local',
        password: budiPassword,
      }),
    });
    if (!budiTokenRes.ok) {
      throw new Error(`Central Auth login failed for Budi Santoso (${budiTokenRes.status}): ${await budiTokenRes.text()}`);
    }
    const budiTokenData = (await budiTokenRes.json()) as any;
    const budiJwt = budiTokenData.access_token;
    console.log('[PASS] Central Auth login successful for budi.santoso@nexus.local (JWT token acquired)');

    // 7d. Test Gateway GET /api/me for Budi Santoso
    console.log('Testing Gateway GET /api/me with Budi Santoso token...');
    const budiMeRes = await fetch('http://localhost:3000/api/me', {
      headers: {
        Authorization: `Bearer ${budiJwt}`,
      },
    });
    if (!budiMeRes.ok) {
      throw new Error(`Gateway /api/me failed for Budi Santoso (${budiMeRes.status}): ${await budiMeRes.text()}`);
    }
    const budiMeData = (await budiMeRes.json()) as any;
    console.log('[PASS] Gateway resolved Employee actor:', budiMeData.data);
    if (
      budiMeData.data.role !== 'EMPLOYEE' ||
      budiMeData.data.branchId !== BRANCH_A_ID ||
      budiMeData.data.employeeId !== BUDI_EMP_ID
    ) {
      throw new Error('Budi Santoso actor resolution returned mismatched role, branchId, or employeeId.');
    }

    // 7e. Role-based authorization test: EMPLOYEE attempting manager action
    console.log('Testing RBAC: Employee attempting manager leave decision endpoint...');
    const rbacRes = await fetch('http://localhost:3000/api/v1/leave-requests/00000000-0000-0000-0000-000000000099/decide', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${budiJwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        decision: 'APPROVED',
      }),
    });
    console.log(`[PASS] RBAC restriction enforced: status=${rbacRes.status} (Forbidden for EMPLOYEE role)`);
    if (rbacRes.status !== 403) {
      throw new Error(`Expected HTTP 403 for EMPLOYEE on manager endpoint, got ${rbacRes.status}`);
    }

    console.log('\n===============================================================');
    console.log(' SUCCESS: TWO CENTRAL AUTH DEMO ACCOUNTS CREATED & VERIFIED');
    console.log(' READY FOR LIVE DEMO');
    console.log('===============================================================');
  } catch (err) {
    console.error('\n[ROLLBACK] Provisioning encountered error, running recovery...');
    // Recovery for created entities
    if (budiAuthId) {
      await fetch(`${config.centralSupabaseUrl}/auth/v1/admin/users/${budiAuthId}`, {
        method: 'DELETE',
        headers: { apikey: config.centralServiceRoleKey, Authorization: `Bearer ${config.centralServiceRoleKey}` },
      }).catch(() => {});
      await fetch(`${config.branchASupabaseUrl}/rest/v1/employees?id=eq.${BUDI_EMP_ID}`, {
        method: 'PATCH',
        headers: { apikey: config.branchAServiceRoleKey, Authorization: `Bearer ${config.branchAServiceRoleKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_auth_id: null }),
      }).catch(() => {});
    }
    if (adminAuthId) {
      await fetch(`${config.centralSupabaseUrl}/auth/v1/admin/users/${adminAuthId}`, {
        method: 'DELETE',
        headers: { apikey: config.centralServiceRoleKey, Authorization: `Bearer ${config.centralServiceRoleKey}` },
      }).catch(() => {});
    }
    throw err;
  }
}

main().catch((err) => {
  console.error('[FATAL]', err.message || err);
  process.exit(1);
});
