import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const value = request.headers['idempotency-key'];
    if (typeof value !== 'string' || value.length < 16 || value.length > 128) {
      throw new BadRequestException('Idempotency-Key must contain 16 to 128 characters');
    }
    return value;
  },
);
