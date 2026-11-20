import { createGatewayServer } from './app.ts';
import { CentralJwtVerifier } from './auth/central-jwt.ts';
import { IdentityResolver } from './auth/identity-resolver.ts';
import { HttpBranchAClient } from './clients/branch-rpc-client.ts';
import { HttpCentralClient } from './clients/central-client.ts';
import { loadGatewayConfig } from './config/env.ts';
import { ActorHmacSigner } from './security/hmac-signer.ts';
import { createStructuredLogger } from './security/log-sanitizer.ts';
import { NonceStore } from './security/nonce-store.ts';
import { LeaveService } from './services/leave-service.ts';

function main(): void {
  try {
    process.loadEnvFile?.();
  } catch {
    // Ignore if .env is missing or already loaded
  }
  const logger = createStructuredLogger();
  const config = loadGatewayConfig(process.env);

  const jwtVerifier = new CentralJwtVerifier({
    jwksUrl: config.centralJwksUrl,
    expectedIssuer: config.centralJwtIssuer,
    expectedAudience: config.centralJwtAudience,
    cacheTtlSeconds: config.jwksCacheTtlSeconds,
    clockSkewSeconds: config.jwtClockSkewSeconds,
    requestTimeoutMs: config.requestTimeoutMs,
  });

  const centralClient = new HttpCentralClient({
    centralSupabaseUrl: config.centralSupabaseUrl,
    centralServiceRoleKey: config.centralServiceRoleKey,
    requestTimeoutMs: config.requestTimeoutMs,
  });

  const branchClient = new HttpBranchAClient({
    branchASupabaseUrl: config.branchASupabaseUrl,
    branchAServiceRoleKey: config.branchAServiceRoleKey,
    requestTimeoutMs: config.requestTimeoutMs,
  });

  const identityResolver = new IdentityResolver({
    centralClient,
    branchClient,
    expectedBranchAId: config.branchAId,
    expectedBranchACode: config.branchACode,
  });

  const hmacSigner = new ActorHmacSigner(config.hmacKeys, config.activeHmacKeyId);
  const nonceStore = new NonceStore();

  const leaveService = new LeaveService({
    branchClient,
    hmacSigner,
    nonceStore,
    actorTtlSeconds: config.actorTtlSeconds,
    logger,
  });

  const server = createGatewayServer({
    jwtVerifier,
    identityResolver,
    leaveService,
    nonceStore,
    hmacSigner,
    branchAId: config.branchAId,
    centralClient,
    branchClient,
    logger,
    corsAllowedOrigins: config.corsAllowedOrigins,
  });

  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.requestTimeoutMs + 1000;
  server.keepAliveTimeout = 5000;

  let isShuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.info('gateway.shutdown.initiated', { signal });
    server.close((err) => {
      if (err) {
        logger.error('gateway.shutdown.error', { error: err });
        process.exit(1);
      }
      logger.info('gateway.shutdown.completed');
      process.exit(0);
    });

    const forceTimer = setTimeout(() => {
      logger.error('gateway.shutdown.forced_timeout');
      process.exit(1);
    }, 10_000);
    forceTimer.unref();
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  server.listen(config.port, () => {
    logger.info('gateway.started', {
      port: config.port,
      branchId: config.branchAId,
      activeKeyId: hmacSigner.getActiveKeyId(),
      corsOriginsCount: config.corsAllowedOrigins.length,
    });
  });
}

main();
