import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest uses Reflector as a runtime injection token.
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { REAL_VALUE_CAPABILITIES, type RealValueCapability } from './real-value-policy.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { RealValuePolicyService } from './real-value-policy.service.js';

export const REAL_VALUE_ADMISSION_BOUNDARY = 'openpacksduel.real-value-admission';

export type RealValueAdmissionBoundary = 'duel.create' | RealValueCapability;

export const RealValueAdmission = (boundary: RealValueAdmissionBoundary) =>
  SetMetadata(REAL_VALUE_ADMISSION_BOUNDARY, boundary);

@Injectable()
export class RealValuePolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policy: RealValuePolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const boundary = this.reflector.getAllAndOverride<RealValueAdmissionBoundary>(
      REAL_VALUE_ADMISSION_BOUNDARY,
      [context.getHandler(), context.getClass()],
    );
    if (!boundary) {
      throw new BadRequestException('Real-value admission boundary is not configured');
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    await this.policy.assertAllowed(resolveAdmissionCapability(boundary, request));
    return true;
  }
}

export function resolveAdmissionCapability(
  boundary: RealValueAdmissionBoundary,
  request: Pick<FastifyRequest, 'body'>,
): RealValueCapability {
  if (boundary !== 'duel.create') return boundary;
  const body = request.body;
  const mode =
    body && typeof body === 'object' && !Array.isArray(body) && 'matchmakingMode' in body
      ? body.matchmakingMode
      : undefined;
  if (mode === 'direct' || mode === 'house' || mode === 'open') {
    const capability = `duel.create.${mode}` as RealValueCapability;
    if (REAL_VALUE_CAPABILITIES.includes(capability)) return capability;
  }
  throw new BadRequestException('matchmakingMode must identify a real-value policy boundary');
}
