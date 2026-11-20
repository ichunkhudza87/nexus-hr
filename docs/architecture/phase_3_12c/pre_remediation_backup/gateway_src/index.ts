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
    logger,
  });

  server.listen(config.port, () => {
    logger.info('gateway.started', {
      port: config.port,
      branchId: config.branchAId,
      activeKeyId: hmacSigner.getActiveKeyId(),
    });
  });
}

main();
