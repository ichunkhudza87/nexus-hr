import { GatewayError } from '../errors/gateway-error.ts';
import type { CentralUserProfile } from '../types/domain.ts';

export interface CentralDirectoryClient {
  getUserProfileWithBranch(userId: string): Promise<CentralUserProfile | null>;
}

export interface HttpCentralClientOptions {
  centralSupabaseUrl: string;
  centralServiceRoleKey: string;
  requestTimeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class HttpCentralClient implements CentralDirectoryClient {
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpCentralClientOptions) {
    this.baseUrl = options.centralSupabaseUrl.replace(/\/+$/, '');
    this.serviceRoleKey = options.centralServiceRoleKey;
    this.timeoutMs = options.requestTimeoutMs ?? 5000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getUserProfileWithBranch(userId: string): Promise<CentralUserProfile | null> {
    const url = new URL(`${this.baseUrl}/rest/v1/user_profiles`);
    url.searchParams.set('id', `eq.${userId}`);
    url.searchParams.set('select', 'id,email,role,branch_id,is_active,branch:branches(id,code,is_active)');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url.toString(), {
        method: 'GET',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new GatewayError(502, 'CENTRAL_LOOKUP_FAILED', `Central profile lookup failed (${res.status}).`);
      }

      const rows = (await res.json()) as CentralUserProfile[];
      if (!Array.isArray(rows) || rows.length === 0) {
        return null;
      }
      if (rows.length > 1) {
        throw new GatewayError(500, 'IDENTITY_AMBIGUITY', 'Duplicate user profile records returned.');
      }
      return rows[0] ?? null;
    } catch (err) {
      if (err instanceof GatewayError) {
        throw err;
      }
      throw new GatewayError(503, 'CENTRAL_UNAVAILABLE', 'Unable to reach Central identity store.');
    } finally {
      clearTimeout(timer);
    }
  }
}
