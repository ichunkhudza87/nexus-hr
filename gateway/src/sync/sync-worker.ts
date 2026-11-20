import type { Logger } from '../security/log-sanitizer.ts';

export interface SyncOutboxRow {
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  event_type: string;
  payload: Record<string, unknown>;
}

export interface SyncWorkerConfig {
  branchASupabaseUrl: string;
  branchAServiceRoleKey: string;
  centralSupabaseUrl: string;
  centralServiceRoleKey: string;
  workerId?: string;
  batchSize?: number;
  syncEnabled?: boolean;
  requestTimeoutMs?: number;
  logger?: Logger;
  fetchFn?: typeof fetch;
}

export interface SyncEventResult {
  eventId: string;
  eventType: string;
  status: 'PUBLISHED' | 'FAILED' | 'SKIPPED';
  error?: string;
}

export interface SyncCycleResult {
  timestamp: string;
  partitionActive: boolean;
  claimedCount: number;
  publishedCount: number;
  failedCount: number;
  events: SyncEventResult[];
}

export interface OutboxStatusSummary {
  pendingCount: number;
  processingCount: number;
  publishedCount: number;
  failedCount: number;
  totalCount: number;
}

export interface InboxStatusSummary {
  receivedCount: number;
  processingCount: number;
  processedCount: number;
  failedCount: number;
  deadLetterCount: number;
  totalCount: number;
}

export class DistributedSyncWorker {
  private readonly branchABaseUrl: string;
  private readonly branchAServiceKey: string;
  private readonly centralBaseUrl: string;
  private readonly centralServiceKey: string;
  private readonly workerId: string;
  private readonly batchSize: number;
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private readonly fetchFn: typeof fetch;
  private syncEnabled: boolean;

  constructor(config: SyncWorkerConfig) {
    this.branchABaseUrl = config.branchASupabaseUrl.replace(/\/+$/, '');
    this.branchAServiceKey = config.branchAServiceRoleKey;
    this.centralBaseUrl = config.centralSupabaseUrl.replace(/\/+$/, '');
    this.centralServiceKey = config.centralServiceRoleKey;
    this.workerId = config.workerId ?? 'worker-branch-a-1';
    this.batchSize = config.batchSize ?? 10;
    this.timeoutMs = config.requestTimeoutMs ?? 5000;
    this.syncEnabled = config.syncEnabled ?? (process.env.CENTRAL_SYNC_ENABLED !== 'false');
    this.fetchFn = config.fetchFn ?? fetch;
    this.logger = config.logger ?? {
      info: (msg, meta) => console.log(`[INFO] ${msg}`, meta ? JSON.stringify(meta) : ''),
      warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta ? JSON.stringify(meta) : ''),
      error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta ? JSON.stringify(meta) : ''),
      debug: () => {},
    };
  }

  public setSyncEnabled(enabled: boolean): void {
    this.syncEnabled = enabled;
  }

  public isSyncEnabled(): boolean {
    return this.syncEnabled;
  }

  /**
   * Execute a single transactional outbox claim-and-forward cycle.
   */
  public async runSyncCycle(): Promise<SyncCycleResult> {
    const timestamp = new Date().toISOString();

    // 1. Network partition simulation gate
    if (!this.syncEnabled) {
      this.logger.warn('sync.partition.active', {
        workerId: this.workerId,
        message: 'Central sync disabled by configuration (CENTRAL_SYNC_ENABLED=false). Events remain safely in Branch A outbox.',
      });
      return {
        timestamp,
        partitionActive: true,
        claimedCount: 0,
        publishedCount: 0,
        failedCount: 0,
        events: [],
      };
    }

    // 2. Claim pending batch from Branch A via PostgreSQL RPC
    const claimedRows = await this.claimBatchFromBranchA();
    if (claimedRows.length === 0) {
      return {
        timestamp,
        partitionActive: false,
        claimedCount: 0,
        publishedCount: 0,
        failedCount: 0,
        events: [],
      };
    }

    this.logger.info('sync.batch.claimed', {
      workerId: this.workerId,
      batchSize: claimedRows.length,
      eventIds: claimedRows.map((r) => r.event_id),
    });

    const results: SyncEventResult[] = [];
    let publishedCount = 0;
    let failedCount = 0;

    // 3. Process each event sequentially to preserve causal order
    for (const row of claimedRows) {
      try {
        // Step A: Ingest into Central sync_inbox (Idempotent ON CONFLICT DO NOTHING)
        await this.postToCentralInbox(row);

        // Step B: Apply Central Projection RPC
        await this.applyCentralProjection(row.event_id);

        // Step C: Mark Branch A Outbox as durably PUBLISHED
        await this.markOutboxPublished(row.event_id);

        publishedCount++;
        results.push({
          eventId: row.event_id,
          eventType: row.event_type,
          status: 'PUBLISHED',
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        failedCount++;
        this.logger.error('sync.event.failed', {
          workerId: this.workerId,
          eventId: row.event_id,
          eventType: row.event_type,
          error: errorMsg,
        });

        // Mark Branch A Outbox as FAILED with exponential backoff
        await this.markOutboxFailed(row.event_id, errorMsg).catch(() => {});

        results.push({
          eventId: row.event_id,
          eventType: row.event_type,
          status: 'FAILED',
          error: errorMsg,
        });
      }
    }

    this.logger.info('sync.batch.completed', {
      workerId: this.workerId,
      claimed: claimedRows.length,
      published: publishedCount,
      failed: failedCount,
    });

    return {
      timestamp,
      partitionActive: false,
      claimedCount: claimedRows.length,
      publishedCount,
      failedCount,
      events: results,
    };
  }

  /**
   * Call Branch A claim_outbox_batch RPC
   */
  private async claimBatchFromBranchA(): Promise<SyncOutboxRow[]> {
    const url = `${this.branchABaseUrl}/rest/v1/rpc/claim_outbox_batch`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          apikey: this.branchAServiceKey,
          Authorization: `Bearer ${this.branchAServiceKey}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          p_worker_id: this.workerId,
          p_batch_size: this.batchSize,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`claim_outbox_batch HTTP ${res.status}: ${text}`);
      }

      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as SyncOutboxRow[]) : [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Post event to Central sync_inbox
   */
  private async postToCentralInbox(row: SyncOutboxRow): Promise<void> {
    const url = `${this.centralBaseUrl}/rest/v1/sync_inbox`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          apikey: this.centralServiceKey,
          Authorization: `Bearer ${this.centralServiceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({
          event_id: row.event_id,
          source_node: 'BRANCH-A',
          aggregate_type: row.aggregate_type,
          aggregate_id: row.aggregate_id,
          aggregate_version: row.aggregate_version,
          event_type: row.event_type,
          payload: row.payload,
          status: 'RECEIVED',
        }),
        signal: controller.signal,
      });

      if (!res.ok && res.status !== 409) {
        const text = await res.text().catch(() => '');
        throw new Error(`Central sync_inbox HTTP ${res.status}: ${text}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Call Central apply_inbox_event_projection RPC
   */
  private async applyCentralProjection(eventId: string): Promise<void> {
    const url = `${this.centralBaseUrl}/rest/v1/rpc/apply_inbox_event_projection`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          apikey: this.centralServiceKey,
          Authorization: `Bearer ${this.centralServiceKey}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ p_event_id: eventId }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`apply_inbox_event_projection HTTP ${res.status}: ${text}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Call Branch A mark_outbox_published RPC
   */
  private async markOutboxPublished(eventId: string): Promise<void> {
    const url = `${this.branchABaseUrl}/rest/v1/rpc/mark_outbox_published`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          apikey: this.branchAServiceKey,
          Authorization: `Bearer ${this.branchAServiceKey}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          p_event_id: eventId,
          p_worker_id: this.workerId,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`mark_outbox_published HTTP ${res.status}: ${text}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Call Branch A mark_outbox_failed RPC
   */
  private async markOutboxFailed(eventId: string, errorMessage: string): Promise<void> {
    const url = `${this.branchABaseUrl}/rest/v1/rpc/mark_outbox_failed`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      await this.fetchFn(url, {
        method: 'POST',
        headers: {
          apikey: this.branchAServiceKey,
          Authorization: `Bearer ${this.branchAServiceKey}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          p_event_id: eventId,
          p_worker_id: this.workerId,
          p_error_message: errorMessage,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Query Outbox status counts from Branch A
   */
  public async getOutboxStatus(): Promise<OutboxStatusSummary> {
    const url = `${this.branchABaseUrl}/rest/v1/sync_outbox?select=status`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          apikey: this.branchAServiceKey,
          Authorization: `Bearer ${this.branchAServiceKey}`,
          accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Outbox query HTTP ${res.status}`);
      }

      const rows = (await res.json()) as Array<{ status: string }>;
      let pending = 0;
      let processing = 0;
      let published = 0;
      let failed = 0;

      for (const r of rows) {
        if (r.status === 'PENDING') pending++;
        else if (r.status === 'PROCESSING') processing++;
        else if (r.status === 'PUBLISHED') published++;
        else if (r.status === 'FAILED') failed++;
      }

      return {
        pendingCount: pending,
        processingCount: processing,
        publishedCount: published,
        failedCount: failed,
        totalCount: rows.length,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Query Inbox status counts from Central
   */
  public async getInboxStatus(): Promise<InboxStatusSummary> {
    const url = `${this.centralBaseUrl}/rest/v1/sync_inbox?select=status`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          apikey: this.centralServiceKey,
          Authorization: `Bearer ${this.centralServiceKey}`,
          accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Inbox query HTTP ${res.status}`);
      }

      const rows = (await res.json()) as Array<{ status: string }>;
      let received = 0;
      let processing = 0;
      let processed = 0;
      let failed = 0;
      let deadLetter = 0;

      for (const r of rows) {
        if (r.status === 'RECEIVED') received++;
        else if (r.status === 'PROCESSING') processing++;
        else if (r.status === 'PROCESSED') processed++;
        else if (r.status === 'FAILED') failed++;
        else if (r.status === 'DEAD_LETTER') deadLetter++;
      }

      return {
        receivedCount: received,
        processingCount: processing,
        processedCount: processed,
        failedCount: failed,
        deadLetterCount: deadLetter,
        totalCount: rows.length,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
