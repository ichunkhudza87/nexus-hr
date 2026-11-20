import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Safety regular expressions
const KEY_ID_REGEX = /^[A-Za-z0-9._-]{1,64}$/;
const PLACEHOLDER_REGEX = /(?:^|[_-])(your_|replace_with|changeme|placeholder)|_here$/i;
const IPV4_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_REGEX = /^(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

// Target project constants
export const EXPECTED_BRANCH_A_REF = 'uneycmbqqpkifwhwzbes';
export const FORBIDDEN_CENTRAL_REF = 'wcmevigbqsmzsdqidjel';
export const FORBIDDEN_LEGACY_REFS = ['bolt', 'cbt', 'nusantara'] as const;

// Determine paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const GATEWAY_DIR = path.resolve(__dirname, '..');
export const ENV_PATH = path.join(GATEWAY_DIR, '.env');
export const ROOT_DIR = path.resolve(GATEWAY_DIR, '..');
export const GITIGNORE_PATH = path.join(ROOT_DIR, '.gitignore');

export const DEFAULT_KEY_ID = 'gw-hmac-v1';

export interface ProvisionerOptions {
  mode: 'PREVIEW' | 'EXECUTE';
  keyId: string;
  confirmSafety: boolean;
}

export function parseCliArgs(args: string[]): ProvisionerOptions {
  let mode: 'PREVIEW' | 'EXECUTE' = 'PREVIEW';
  let keyId = DEFAULT_KEY_ID;
  let confirmSafety = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--execute') {
      mode = 'EXECUTE';
    } else if (arg === '--preview') {
      mode = 'PREVIEW';
    } else if (arg === '--confirm-safety') {
      confirmSafety = true;
    } else if (arg === '--key-id' && i + 1 < args.length) {
      keyId = args[++i].trim();
    } else if (arg === '--force') {
      throw new Error(
        'Flag --force is prohibited. Overwriting active HMAC keys is strictly disabled. To rotate, register a new key ID (e.g. gw-hmac-v2).'
      );
    }
  }

  if (!KEY_ID_REGEX.test(keyId)) {
    throw new Error(`Invalid keyId '${keyId}'. Must match ${KEY_ID_REGEX.source}`);
  }

  return { mode, keyId, confirmSafety };
}

/**
 * Sanitizes any error message or string before logging, removing hex secrets,
 * passwords, JWTs, and sensitive credentials.
 */
export function sanitizeErrorMessage(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  let str = raw instanceof Error ? raw.message : String(raw);

  // Redact 64-character lowercase/uppercase hex strings (256-bit secrets)
  str = str.replace(/\b[0-9a-fA-F]{64}\b/g, '[REDACTED_SECRET]');

  // Redact JWT tokens (eyJ...)
  str = str.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]');

  // Redact passwords in connection URLs
  str = str.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, '$1********$2');

  // Redact generic bearer tokens
  str = str.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED_TOKEN]');

  return str;
}

export function maskConnectionString(connStr: string): string {
  try {
    const url = new URL(connStr);
    if (url.password) {
      url.password = '********';
    }
    return url.toString();
  } catch {
    return '[REDACTED_CONNECTION_STRING]';
  }
}

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  hostname?: string;
}

/**
 * Validates connection string target against strict Branch A allowlist.
 * Explicitly rejects Central, localhost, IP addresses, and legacy projects.
 */
export function validateBranchADatabaseUrl(rawUrl: string): UrlValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'Connection string is empty or missing.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'Connection string is not a valid URL.' };
  }

  // 1. Protocol check
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    return { valid: false, reason: `Unsupported protocol '${parsed.protocol}'. Expected postgresql: or postgres:.` };
  }

  const hostname = parsed.hostname.toLowerCase();
  const username = decodeURIComponent(parsed.username || '').toLowerCase();
  const fullSearch = parsed.search.toLowerCase();
  const fullPath = parsed.pathname.toLowerCase();

  // 2. Explicit rejection of Central reference anywhere
  if (
    hostname.includes(FORBIDDEN_CENTRAL_REF) ||
    username.includes(FORBIDDEN_CENTRAL_REF) ||
    fullSearch.includes(FORBIDDEN_CENTRAL_REF) ||
    fullPath.includes(FORBIDDEN_CENTRAL_REF)
  ) {
    return { valid: false, reason: 'Targeting Central database (wcmevigbqsmzsdqidjel) is strictly prohibited.' };
  }

  // 3. Explicit rejection of legacy projects anywhere
  for (const leg of FORBIDDEN_LEGACY_REFS) {
    if (
      hostname.includes(leg) ||
      username.includes(leg) ||
      fullSearch.includes(leg) ||
      fullPath.includes(leg)
    ) {
      return { valid: false, reason: `Targeting legacy project '${leg}' is strictly prohibited.` };
    }
  }

  // 4. Explicit rejection of localhost and loopback/IP addresses
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost') ||
    IPV4_REGEX.test(hostname) ||
    IPV6_REGEX.test(hostname)
  ) {
    return { valid: false, reason: 'Localhost and IP address connections are strictly prohibited.' };
  }

  // 5. Must match either Branch A Direct or Branch A Pooler
  const isDirectBranchA = hostname === `db.${EXPECTED_BRANCH_A_REF}.supabase.co`;
  const isPoolerBranchA =
    hostname.endsWith('.pooler.supabase.com') && username === `postgres.${EXPECTED_BRANCH_A_REF}`;

  if (!isDirectBranchA && !isPoolerBranchA) {
    return {
      valid: false,
      reason: `Hostname or username does not match Branch A reference '${EXPECTED_BRANCH_A_REF}'. Expected host 'db.${EXPECTED_BRANCH_A_REF}.supabase.co' or pooler host with user 'postgres.${EXPECTED_BRANCH_A_REF}'.`,
    };
  }

  // 6. Database name verification
  const dbName = fullPath.replace(/^\/+/, '');
  if (dbName !== 'postgres') {
    return { valid: false, reason: `Database name must be 'postgres', got '${dbName}'.` };
  }

  return { valid: true, hostname };
}

/**
 * Applies strict OS-level access control list (ACL) to a file.
 * On Windows: uses icacls to restrict file permissions strictly to current user.
 * On POSIX: uses chmod 0600.
 */
export function applyStrictFileAcl(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  if (process.platform === 'win32') {
    const user = process.env.USERNAME || process.env.USER;
    if (!user) {
      return false;
    }
    try {
      // 1. Remove inheritance and grant Full access only to active Windows user
      execFileSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${user}:F`], {
        stdio: 'pipe',
        encoding: 'utf8',
      });

      // 2. Verify ACL
      const verifyOutput = execFileSync('icacls', [filePath], {
        stdio: 'pipe',
        encoding: 'utf8',
      });

      const hasUser = verifyOutput.toLowerCase().includes(user.toLowerCase());
      const hasInherited = verifyOutput.includes('(I)');
      return hasUser && !hasInherited;
    } catch {
      return false;
    }
  } else {
    try {
      fs.chmodSync(filePath, 0o600);
      const stat = fs.statSync(filePath);
      return (stat.mode & 0o777) === 0o600;
    } catch {
      return false;
    }
  }
}

export function verifyGitIgnoreProtection(): boolean {
  if (!fs.existsSync(GITIGNORE_PATH)) {
    return false;
  }
  const content = fs.readFileSync(GITIGNORE_PATH, 'utf8');
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  return lines.includes('.env') || lines.includes('.env*');
}

export function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const result: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    let val = trimmed.substring(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }
    result[key] = val;
  }
  return result;
}

export function writeEnvSafely(filePath: string, updates: Record<string, string>): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = existing.split(/\r?\n/);
  const updatedKeys = new Set(Object.keys(updates));
  const newLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      newLines.push(line);
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      newLines.push(line);
      continue;
    }
    const key = trimmed.substring(0, eqIdx).trim();
    if (updatedKeys.has(key)) {
      newLines.push(`${key}=${updates[key]}`);
      updatedKeys.delete(key);
    } else {
      newLines.push(line);
    }
  }

  // Append any keys not previously present
  for (const key of updatedKeys) {
    newLines.push(`${key}=${updates[key]}`);
  }

  // Write atomically via temporary file with strict ACL
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, newLines.join('\n'), { mode: 0o600 });
  if (!applyStrictFileAcl(tempPath)) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore cleanup error
    }
    throw new Error('Failed to enforce strict filesystem ACL permissions on temporary .env file.');
  }

  fs.renameSync(tempPath, filePath);
  if (!applyStrictFileAcl(filePath)) {
    throw new Error('Failed to enforce strict filesystem ACL permissions on updated .env file.');
  }
}

export const SUPABASE_CA_CERT_PATH = path.join(GATEWAY_DIR, 'certs', 'supabase-ca.crt');

export function loadSupabaseCaCert(): string | undefined {
  if (fs.existsSync(SUPABASE_CA_CERT_PATH)) {
    return fs.readFileSync(SUPABASE_CA_CERT_PATH, 'utf8');
  }
  const customCa = process.env.PGSSLROOTCERT || process.env.SSL_CERT_FILE;
  if (customCa && fs.existsSync(customCa)) {
    return fs.readFileSync(customCa, 'utf8');
  }
  return undefined;
}

export function createPgClientConfig(connectionString: string) {
  const ca = loadSupabaseCaCert();
  return {
    connectionString,
    // VULN-01: TLS certificate verification strictly enforced
    ssl: {
      rejectUnauthorized: true,
      ...(ca ? { ca } : {}),
    },
    statement_timeout: 10000,
  };
}

async function getPgClientClass() {
  try {
    const pgModule = await import('pg');
    return pgModule.default?.Client || pgModule.Client;
  } catch (err: unknown) {
    const msg = sanitizeErrorMessage(err);
    throw new Error(`Package 'pg' is not installed or loadable: ${msg}`);
  }
}

export function resolveBranchADbUrl(): string {
  if (process.env.BRANCH_A_DIRECT_DB_URL?.trim()) {
    return process.env.BRANCH_A_DIRECT_DB_URL.trim();
  }
  if (process.env.DATABASE_URL_BRANCH_A?.trim()) {
    return process.env.DATABASE_URL_BRANCH_A.trim();
  }
  return '';
}

export function checkForOrphanedBackups(): string[] {
  if (!fs.existsSync(GATEWAY_DIR)) return [];
  const entries = fs.readdirSync(GATEWAY_DIR);
  return entries.filter((name) => name.startsWith('.env.bak.') || name.startsWith('.env.tmp.'));
}

export async function runPreview(opts: ProvisionerOptions): Promise<void> {
  console.log('===============================================================');
  console.log(' NEXUS HR — HMAC PROVISIONING PREVIEW (READ-ONLY)');
  console.log('===============================================================');
  console.log(`Planned Key ID : ${opts.keyId}`);
  console.log(`Target Branch  : Branch A (${EXPECTED_BRANCH_A_REF})`);
  console.log(`Environment    : ${ENV_PATH}`);
  console.log('---------------------------------------------------------------');

  // Check for orphaned recovery files from previous runs
  const orphaned = checkForOrphanedBackups();
  if (orphaned.length > 0) {
    console.log(`[WARN] Found ${orphaned.length} orphaned backup/temp file(s):`);
    for (const f of orphaned) {
      console.log(`       - ${f}`);
    }
    console.log('       Please review and delete orphaned backups before provisioning.');
  }

  // 1. Dependency check
  let pgAvailable = false;
  try {
    const Client = await getPgClientClass();
    pgAvailable = typeof Client === 'function';
    console.log('[PASS] PostgreSQL Driver (pg)          : Available');
  } catch (err: unknown) {
    console.log(`[FAIL] PostgreSQL Driver (pg)          : ${sanitizeErrorMessage(err)}`);
  }

  // 2. Git ignore check
  const gitIgnored = verifyGitIgnoreProtection();
  if (gitIgnored) {
    console.log('[PASS] Git Secret Protection (.gitignore)  : .env is properly ignored');
  } else {
    console.log('[WARN] Git Secret Protection (.gitignore)  : .env rule not found in root .gitignore');
  }

  // 3. Local .env check
  const envVars = parseEnvFile(ENV_PATH);
  const currentKeyId = envVars['GATEWAY_ACTOR_HMAC_KEY_ID'] || '(none)';
  const currentKey = envVars['GATEWAY_ACTOR_HMAC_KEY'] || '';
  const isPlaceholder = PLACEHOLDER_REGEX.test(currentKey);
  console.log(`[INFO] Current .env GATEWAY_ACTOR_HMAC_KEY_ID: ${currentKeyId}`);
  console.log(
    `[INFO] Current .env GATEWAY_ACTOR_HMAC_KEY   : ${
      currentKey ? (isPlaceholder ? 'Placeholder' : 'Configured') : 'Missing'
    } (Length: ${currentKey.length})`
  );

  // 4. Database Connection Availability & Validation
  const dbUrl = resolveBranchADbUrl();
  if (!dbUrl) {
    console.log('[WAIT] Direct PostgreSQL Connection String : Not provided in environment');
    console.log('       (Set BRANCH_A_DIRECT_DB_URL to test remote database connectivity)');
  } else {
    console.log(`[INFO] Direct PostgreSQL Target            : ${maskConnectionString(dbUrl)}`);

    // VULN-02 Host validation
    const urlValidation = validateBranchADatabaseUrl(dbUrl);
    if (!urlValidation.valid) {
      console.log(`[FAIL] Connection String Validation        : ${urlValidation.reason}`);
      return;
    }
    console.log(`[PASS] Connection String Hostname          : ${urlValidation.hostname} (Validated Branch A)`);

    if (pgAvailable) {
      const Client = await getPgClientClass();
      const client = new Client(createPgClientConfig(dbUrl));

      // VULN-03: Connection cleanup guaranteed via try/finally
      try {
        await client.connect();
        console.log('[PASS] Database Connection & TLS Handshake : Connected successfully (TLS Verified)');

        // Check if key already exists
        const res = await client.query(
          `SELECT key_id, is_active, activated_at, expires_at, revoked_at 
           FROM nexus_internal.gateway_signing_keys 
           WHERE key_id = $1`,
          [opts.keyId]
        );

        if (res.rows.length === 0) {
          console.log(`[PASS] Key Registry Status                 : Key '${opts.keyId}' is not yet registered (Ready to insert)`);
        } else {
          const row = res.rows[0];
          console.log(
            `[WARN] Key Registry Status                 : Key '${opts.keyId}' ALREADY EXISTS (Active: ${row.is_active})`
          );
        }
      } catch (dbErr: unknown) {
        console.error(`[FAIL] Database Connection or Query Failed  : ${sanitizeErrorMessage(dbErr)}`);
        process.exitCode = 1;
      } finally {
        await client.end().catch(() => {});
      }
    }
  }

  console.log('---------------------------------------------------------------');
  console.log('Preview completed. No secrets were generated, stored, or sent.');
  console.log('To provision, explicit operator approval and --execute flags are required.');
  console.log('===============================================================');
}

export async function runExecute(opts: ProvisionerOptions): Promise<void> {
  console.log('===============================================================');
  console.log(' NEXUS HR — SECURE LOCAL HMAC PROVISIONING (EXECUTE MODE)');
  console.log('===============================================================');

  // Strict safety gates
  if (!opts.confirmSafety) {
    console.error('[BLOCKED] Missing safety flag: --confirm-safety is required to run in EXECUTE mode.');
    process.exit(1);
  }

  if (process.env.NEXUS_ALLOW_HMAC_PROVISION !== 'true') {
    console.error('[BLOCKED] Environment gate active: NEXUS_ALLOW_HMAC_PROVISION=true is required.');
    process.exit(1);
  }

  const dbUrl = resolveBranchADbUrl();
  if (!dbUrl) {
    console.error('[BLOCKED] Missing BRANCH_A_DIRECT_DB_URL environment variable for PostgreSQL connection.');
    process.exit(1);
  }

  // VULN-02: Strict URL & Host Validation
  const urlValidation = validateBranchADatabaseUrl(dbUrl);
  if (!urlValidation.valid) {
    console.error(`[BLOCKED] Target database validation failed: ${urlValidation.reason}`);
    process.exit(1);
  }

  const Client = await getPgClientClass();
  // VULN-01: rejectUnauthorized: true strictly enforced
  const client = new Client(createPgClientConfig(dbUrl));

  console.log(`Connecting securely to Branch A via TLS (Certificate Verified): ${maskConnectionString(dbUrl)}...`);
  await client.connect();

  // Create .env backup path with strict ACL
  const backupEnvPath = `${ENV_PATH}.bak.${Date.now()}`;
  let backupCreated = false;

  try {
    console.log('Starting PostgreSQL transaction (BEGIN)...');
    await client.query('BEGIN');

    // Check table existence
    const tableCheck = await client.query(`
      SELECT 1 FROM pg_tables 
      WHERE schemaname = 'nexus_internal' AND tablename = 'gateway_signing_keys'
    `);
    if (tableCheck.rows.length === 0) {
      throw new Error('Table nexus_internal.gateway_signing_keys does not exist on remote database.');
    }

    // WARN-06: Strict Overwrite Protection (No in-place active key overwrite)
    const existingCheck = await client.query(
      `SELECT key_id, is_active FROM nexus_internal.gateway_signing_keys WHERE key_id = $1`,
      [opts.keyId]
    );

    if (existingCheck.rows.length > 0) {
      throw new Error(
        `Key '${opts.keyId}' is already registered in Branch A database. Overwriting active keys is strictly prohibited. To rotate, register a new key ID (e.g. gw-hmac-v2).`
      );
    }

    // Generate CSPRNG 256-bit secret (32 random bytes -> 64 lowercase hex characters)
    const secret = randomBytes(32).toString('hex');
    if (secret.length !== 64 || Buffer.byteLength(secret, 'utf8') < 32) {
      throw new Error('CSPRNG secret generation failed safety assertions.');
    }

    // Parameterized INSERT into PostgreSQL
    console.log(`Inserting key '${opts.keyId}' into nexus_internal.gateway_signing_keys...`);
    const insertRes = await client.query(
      `INSERT INTO nexus_internal.gateway_signing_keys (
         key_id,
         hmac_secret,
         is_active,
         activated_at,
         created_at,
         rotated_at,
         expires_at,
         revoked_at
       ) VALUES (
         $1, $2, TRUE, now(), now(), NULL, NULL, NULL
       )
       RETURNING key_id, is_active, activated_at`,
      [opts.keyId, secret]
    );

    if (insertRes.rows.length !== 1) {
      throw new Error('Database insert returned unexpected row count.');
    }

    // Step 2: Backup and update local .env with strict ACL
    console.log('Backing up existing gateway/.env with restricted ACL...');
    if (fs.existsSync(ENV_PATH)) {
      fs.copyFileSync(ENV_PATH, backupEnvPath);
      if (!applyStrictFileAcl(backupEnvPath)) {
        throw new Error('Failed to apply strict filesystem ACL permissions to .env backup file.');
      }
      backupCreated = true;
    }

    console.log('Writing key configuration to gateway/.env with restricted ACL...');
    writeEnvSafely(ENV_PATH, {
      GATEWAY_ACTOR_HMAC_KEY_ID: opts.keyId,
      GATEWAY_ACTOR_HMAC_KEY: secret,
    });

    // Step 3: Verify .env written cleanly before COMMIT
    const reloadedEnv = parseEnvFile(ENV_PATH);
    if (
      reloadedEnv['GATEWAY_ACTOR_HMAC_KEY_ID'] !== opts.keyId ||
      !reloadedEnv['GATEWAY_ACTOR_HMAC_KEY'] ||
      reloadedEnv['GATEWAY_ACTOR_HMAC_KEY'].length !== 64
    ) {
      throw new Error('Local .env verification failed after write.');
    }

    // Step 4: Commit database transaction
    console.log('Committing PostgreSQL transaction (COMMIT)...');
    await client.query('COMMIT');

    // Remove backup file on success
    if (backupCreated && fs.existsSync(backupEnvPath)) {
      try {
        fs.unlinkSync(backupEnvPath);
      } catch {
        console.warn('[WARN] Could not remove temporary backup file. Please delete it manually.');
      }
    }

    const insertedMeta = insertRes.rows[0];
    console.log('---------------------------------------------------------------');
    console.log('[SUCCESS] HMAC Provisioning completed successfully!');
    console.log(`Key ID       : ${insertedMeta.key_id}`);
    console.log(`Status       : ${insertedMeta.is_active ? 'ACTIVE' : 'INACTIVE'}`);
    console.log(`Activated At : ${insertedMeta.activated_at}`);
    console.log(`Local .env   : Synchronized and verified (ACL Protected)`);
    console.log('---------------------------------------------------------------');
    console.log('Note: Secret value was never printed or logged.');
    console.log('===============================================================');
  } catch (err: unknown) {
    const errorMsg = sanitizeErrorMessage(err);
    console.error(`\n[ERROR] Provisioning failed: ${errorMsg}`);
    console.error('Initiating rollback procedures...');

    // 1. Rollback DB transaction
    try {
      await client.query('ROLLBACK');
      console.log('[ROLLBACK] Database transaction rolled back.');
    } catch (rbErr) {
      console.error('[ROLLBACK_ERROR] Database rollback failed:', sanitizeErrorMessage(rbErr));
    }

    // 2. Restore .env backup if created
    if (backupCreated && fs.existsSync(backupEnvPath)) {
      try {
        fs.copyFileSync(backupEnvPath, ENV_PATH);
        applyStrictFileAcl(ENV_PATH);
        fs.unlinkSync(backupEnvPath);
        console.log('[ROLLBACK] Restored previous gateway/.env from backup.');
      } catch (restErr) {
        console.error(
          '[FATAL_SPLIT_STATE] Restoring .env backup failed: ' +
            sanitizeErrorMessage(restErr) +
            '. Manual action required: inspect gateway/.env and restore from ' +
            path.basename(backupEnvPath)
        );
      }
    }

    process.exit(1);
  } finally {
    // VULN-03: Client connection always closed
    await client.end().catch(() => {});
  }
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.mode === 'PREVIEW') {
    await runPreview(options);
  } else {
    await runExecute(options);
  }
}

// Only execute when invoked as the main module
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((err: unknown) => {
    const msg = sanitizeErrorMessage(err);
    console.error(`[FATAL] Provisioner halted: ${msg}`);
    process.exit(1);
  });
}
