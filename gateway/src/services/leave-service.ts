import type { BranchAClient } from '../clients/branch-rpc-client.ts';
import { GatewayError } from '../errors/gateway-error.ts';
import type { ActorHmacSigner } from '../security/hmac-signer.ts';
import type { Logger } from '../security/log-sanitizer.ts';
import type { NonceStore } from '../security/nonce-store.ts';
import type {
  LeaveDecisionInput,
  LeaveRequestRecord,
  ResolvedActor,
  SuperadminLeaveUpdateInput,
} from '../types/domain.ts';

export interface LeaveServiceOptions {
  branchClient: BranchAClient;
  hmacSigner: ActorHmacSigner;
  nonceStore: NonceStore;
  actorTtlSeconds: number;
  logger: Logger;
}

export class LeaveService {
  private readonly branchClient: BranchAClient;
  private readonly hmacSigner: ActorHmacSigner;
  private readonly nonceStore: NonceStore;
  private readonly actorTtlSeconds: number;
  private readonly logger: Logger;

  constructor(options: LeaveServiceOptions) {
    this.branchClient = options.branchClient;
    this.hmacSigner = options.hmacSigner;
    this.nonceStore = options.nonceStore;
    this.actorTtlSeconds = options.actorTtlSeconds;
    this.logger = options.logger;
  }

  async decideLeaveRequest(
    actor: ResolvedActor,
    input: LeaveDecisionInput,
  ): Promise<LeaveRequestRecord> {
    if (actor.actorRole !== 'BRANCH_MANAGER') {
      throw new GatewayError(403, 'FORBIDDEN_ROLE', 'Only BRANCH_MANAGER may decide branch leave requests here.');
    }
    if (!actor.employeeId || !actor.branchId) {
      throw new GatewayError(403, 'INCOMPLETE_ACTOR_IDENTITY', 'Verified branch and employee identity required.');
    }

    const { nonce, exp } = this.nonceStore.issueOutboundNonce(this.actorTtlSeconds);
    const envelope = this.hmacSigner.signActorEnvelope({
      actionScope: 'LEAVE_DECIDE',
      targetId: input.requestId,
      operationMode: 'DECISION',
      actor,
      exp,
      nonce,
    });

    this.logger.info('gateway.leave.decide.dispatch', {
      requestId: input.requestId,
      decision: input.decision,
      actorUserId: actor.actorUserId,
      actorRole: actor.actorRole,
      keyId: envelope.keyId,
      nonce: envelope.nonce,
    });

    return this.branchClient.decideLeaveRequest(input, envelope);
  }

  async superadminUpdateLeaveRequest(
    actor: ResolvedActor,
    input: SuperadminLeaveUpdateInput,
  ): Promise<LeaveRequestRecord> {
    if (actor.actorRole !== 'SUPERADMIN') {
      throw new GatewayError(403, 'FORBIDDEN_ROLE', 'Only SUPERADMIN may perform administrative leave updates.');
    }

    const { nonce, exp } = this.nonceStore.issueOutboundNonce(this.actorTtlSeconds);
    const envelope = this.hmacSigner.signActorEnvelope({
      actionScope: 'LEAVE_SUPERADMIN_UPDATE',
      targetId: input.requestId,
      operationMode: input.operationMode,
      actor,
      exp,
      nonce,
    });

    this.logger.info('gateway.leave.superadmin_update.dispatch', {
      requestId: input.requestId,
      operationMode: input.operationMode,
      actorUserId: actor.actorUserId,
      actorRole: actor.actorRole,
      keyId: envelope.keyId,
      nonce: envelope.nonce,
    });

    return this.branchClient.superadminUpdateLeaveRequest(input, envelope);
  }
}
