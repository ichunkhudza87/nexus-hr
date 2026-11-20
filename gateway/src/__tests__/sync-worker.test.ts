import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DistributedSyncWorker } from '../sync/sync-worker.ts';
import type { SyncOutboxRow } from '../sync/sync-worker.ts';

describe('DistributedSyncWorker Unit & Contract Tests', () => {
  const dummyBranchUrl = 'https://uneycmbqqpkifwhwzbes.supabase.co';
  const dummyCentralUrl = 'https://wcmevigbqsmzsdqidjel.supabase.co';
  const dummyKey = 'test-service-key-with-sufficient-entropy-32b';

  it('skips claiming and dispatch when CENTRAL_SYNC_ENABLED=false (network partition)', async () => {
    let fetchCalled = false;
    const worker = new DistributedSyncWorker({
      branchASupabaseUrl: dummyBranchUrl,
      branchAServiceRoleKey: dummyKey,
      centralSupabaseUrl: dummyCentralUrl,
      centralServiceRoleKey: dummyKey,
      syncEnabled: false,
      fetchFn: async () => {
        fetchCalled = true;
        return new Response('[]', { status: 200 });
      },
    });

    const result = await worker.runSyncCycle();
    assert.equal(result.partitionActive, true);
    assert.equal(result.claimedCount, 0);
    assert.equal(result.publishedCount, 0);
    assert.equal(fetchCalled, false, 'No HTTP requests should be dispatched when network partition is active');
  });

  it('claims batch from Branch A and delivers to Central, marking published on success', async () => {
    const claimedRows: SyncOutboxRow[] = [
      {
        event_id: '11111111-1111-1111-1111-111111111111',
        aggregate_type: 'ATTENDANCE_SUMMARY',
        aggregate_id: '00000000-0000-0000-0000-000000000001',
        aggregate_version: 1,
        event_type: 'ATTENDANCE_SUMMARY_RECORDED',
        payload: { summary_date: '2026-11-17', total_employees: 2, present_count: 1 },
      },
    ];

    const calls: { url: string; method: string; body?: unknown }[] = [];

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });

      if (url.includes('/rpc/claim_outbox_batch')) {
        return new Response(JSON.stringify(claimedRows), { status: 200 });
      }
      if (url.includes('/rest/v1/sync_inbox')) {
        return new Response(JSON.stringify({}), { status: 201 });
      }
      if (url.includes('/rpc/apply_inbox_event_projection')) {
        return new Response(JSON.stringify(true), { status: 200 });
      }
      if (url.includes('/rpc/mark_outbox_published')) {
        return new Response(JSON.stringify(true), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };

    const worker = new DistributedSyncWorker({
      branchASupabaseUrl: dummyBranchUrl,
      branchAServiceRoleKey: dummyKey,
      centralSupabaseUrl: dummyCentralUrl,
      centralServiceRoleKey: dummyKey,
      syncEnabled: true,
      fetchFn: mockFetch as typeof fetch,
    });

    const result = await worker.runSyncCycle();
    assert.equal(result.partitionActive, false);
    assert.equal(result.claimedCount, 1);
    assert.equal(result.publishedCount, 1);
    assert.equal(result.failedCount, 0);
    assert.equal(result.events[0]?.status, 'PUBLISHED');

    assert.equal(calls.length, 4);
    assert.ok(calls[0]?.url.includes('/rpc/claim_outbox_batch'));
    assert.ok(calls[1]?.url.includes('/rest/v1/sync_inbox'));
    assert.ok(calls[2]?.url.includes('/rpc/apply_inbox_event_projection'));
    assert.ok(calls[3]?.url.includes('/rpc/mark_outbox_published'));
  });

  it('marks outbox as failed with error backoff when Central projection fails', async () => {
    const claimedRows: SyncOutboxRow[] = [
      {
        event_id: '22222222-2222-2222-2222-222222222222',
        aggregate_type: 'EMPLOYEE',
        aggregate_id: '00000000-0000-0000-0000-000000000102',
        aggregate_version: 1,
        event_type: 'EMPLOYEE_UPSERTED',
        payload: { id: '00000000-0000-0000-0000-000000000102' },
      },
    ];

    let markFailedCalled = false;
    let markFailedPayload: unknown = null;

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes('/rpc/claim_outbox_batch')) {
        return new Response(JSON.stringify(claimedRows), { status: 200 });
      }
      if (url.includes('/rest/v1/sync_inbox')) {
        return new Response(JSON.stringify({}), { status: 201 });
      }
      if (url.includes('/rpc/apply_inbox_event_projection')) {
        return new Response('Foreign key constraint violation on target branch', { status: 500 });
      }
      if (url.includes('/rpc/mark_outbox_failed')) {
        markFailedCalled = true;
        markFailedPayload = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };

    const worker = new DistributedSyncWorker({
      branchASupabaseUrl: dummyBranchUrl,
      branchAServiceRoleKey: dummyKey,
      centralSupabaseUrl: dummyCentralUrl,
      centralServiceRoleKey: dummyKey,
      syncEnabled: true,
      fetchFn: mockFetch as typeof fetch,
    });

    const result = await worker.runSyncCycle();
    assert.equal(result.claimedCount, 1);
    assert.equal(result.publishedCount, 0);
    assert.equal(result.failedCount, 1);
    assert.equal(result.events[0]?.status, 'FAILED');
    assert.equal(markFailedCalled, true, 'mark_outbox_failed should be invoked on Central failure');
    assert.ok(markFailedPayload, 'markFailedPayload should be captured');
  });

  it('aggregates outbox status counts correctly', async () => {
    const mockRows = [
      { status: 'PENDING' },
      { status: 'PENDING' },
      { status: 'PUBLISHED' },
      { status: 'PUBLISHED' },
      { status: 'PUBLISHED' },
      { status: 'FAILED' },
    ];

    const worker = new DistributedSyncWorker({
      branchASupabaseUrl: dummyBranchUrl,
      branchAServiceRoleKey: dummyKey,
      centralSupabaseUrl: dummyCentralUrl,
      centralServiceRoleKey: dummyKey,
      fetchFn: async () => new Response(JSON.stringify(mockRows), { status: 200 }),
    });

    const status = await worker.getOutboxStatus();
    assert.equal(status.pendingCount, 2);
    assert.equal(status.publishedCount, 3);
    assert.equal(status.failedCount, 1);
    assert.equal(status.totalCount, 6);
  });
});
