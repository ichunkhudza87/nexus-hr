import { DistributedSyncWorker } from './sync-worker.ts';
import { loadSyncWorkerConfig } from './config.ts';
import { createStructuredLogger } from '../security/log-sanitizer.ts';

export async function main() {
  try {
    process.loadEnvFile?.();
  } catch {
    // Ignore if .env is missing or already loaded
  }
  const args = process.argv.slice(2);
  const isWatch = args.includes('--watch');
  const simulatePartition = args.includes('--simulate-partition');

  const logger = createStructuredLogger();

  // Load worker-specific config from environment
  let config;
  try {
    config = loadSyncWorkerConfig(process.env);
  } catch (err) {
    logger.error('sync.runner.config_error', { error: err });
    process.exit(1);
  }

  const worker = new DistributedSyncWorker({
    branchASupabaseUrl: config.branchASupabaseUrl,
    branchAServiceRoleKey: config.branchAServiceRoleKey,
    centralSupabaseUrl: config.centralSupabaseUrl,
    centralServiceRoleKey: config.centralServiceRoleKey,
    workerId: config.workerId,
    batchSize: config.batchSize,
    syncEnabled: !simulatePartition && config.syncEnabled,
    requestTimeoutMs: config.requestTimeoutMs,
    logger,
  });

  logger.info('sync.runner.started', {
    workerId: config.workerId,
    mode: isWatch ? 'watch' : 'single-cycle',
    simulatePartition,
    syncEnabled: worker.isSyncEnabled(),
    batchSize: config.batchSize,
    intervalMs: config.syncIntervalMs,
  });

  let isShuttingDown = false;
  let activeCyclePromise: Promise<unknown> | null = null;
  let pollInterval: NodeJS.Timeout | null = null;

  const runCycle = async () => {
    if (isShuttingDown) {
      return null;
    }
    try {
      activeCyclePromise = worker.runSyncCycle();
      const result = await activeCyclePromise;
      logger.info('sync.runner.cycle_done', {
        workerId: config.workerId,
        claimed: result.claimedCount,
        published: result.publishedCount,
        failed: result.failedCount,
        partitionActive: result.partitionActive,
      });
      return result;
    } catch (err) {
      logger.error('sync.runner.cycle_error', {
        workerId: config.workerId,
        error: err,
      });
      return null;
    } finally {
      activeCyclePromise = null;
    }
  };

  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.info('sync.runner.stopping', {
      signal,
      workerId: config.workerId,
    });

    // 1. Stop polling immediately
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    // 2. Set safety force timeout (10s) in case downstream operations stall indefinitely
    const forceTimer = setTimeout(() => {
      logger.error('sync.runner.forced_timeout', {
        signal,
        workerId: config.workerId,
      });
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    // 3. Await in-flight synchronization cycle so batch lock and transaction complete safely
    if (activeCyclePromise) {
      logger.info('sync.runner.waiting_active_cycle', {
        signal,
        workerId: config.workerId,
      });
      try {
        await activeCyclePromise;
      } catch {
        // Any error is caught and logged inside runCycle
      }
    }

    logger.info('sync.runner.stopped', {
      signal,
      workerId: config.workerId,
    });
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
  });

  if (!isWatch) {
    await runCycle();
    process.exit(0);
  } else {
    logger.info('sync.runner.watching', {
      workerId: config.workerId,
      intervalMs: config.syncIntervalMs,
    });

    // Run first cycle immediately
    await runCycle();

    if (!isShuttingDown) {
      pollInterval = setInterval(async () => {
        // Guard against overlapping cycle runs if a previous cycle is still in-flight
        if (activeCyclePromise || isShuttingDown) {
          return;
        }
        await runCycle();
      }, config.syncIntervalMs);
    }
  }
}

if (process.argv[1]?.endsWith('run-sync.ts')) {
  main().catch((err) => {
    console.error('Fatal sync runner error:', err);
    process.exit(1);
  });
}
