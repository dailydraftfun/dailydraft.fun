import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  readonly #logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const response = context.getResponse<FastifyReply>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const detail = getDetail(exception, status);
    const title = getTitle(status);
    const log = JSON.stringify({
      duelId: getDuelId(request.params),
      event: 'http_request_failed',
      method: request.method,
      requestId: request.id,
      route: request.routeOptions.url,
      status,
    });
    if (status >= 500) this.#logger.error(log);
    else this.#logger.warn(log);

    response
      .status(status)
      .type('application/problem+json')
      .send({
        type: `https://openpacksduel.com/problems/${toSlug(title)}`,
        title,
        status,
        detail,
        requestId: request.id,
      });
  }
}

function getDuelId(params: unknown): string | null {
  if (!params || typeof params !== 'object' || !('duelId' in params)) return null;
  return typeof params.duelId === 'string' && /^duel_[A-Za-z0-9]{12,64}$/.test(params.duelId)
    ? params.duelId
    : null;
}

function getDetail(exception: unknown, status: number): string {
  if (status >= 500 && !(exception instanceof HttpException)) {
    return 'The API could not complete the request';
  }
  if (!(exception instanceof HttpException)) return 'Request failed';

  const value = exception.getResponse();
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return exception.message;

  const message = (value as Record<string, unknown>).message;
  if (Array.isArray(message)) return message.filter((item) => typeof item === 'string').join('; ');
  return typeof message === 'string' ? message : exception.message;
}

function getTitle(status: number): string {
  const value = HttpStatus[status];
  if (typeof value !== 'string') return 'Request failed';
  return value
    .toLowerCase()
    .split('_')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function toSlug(value: string): string {
  return value.toLowerCase().replaceAll(' ', '-');
}
