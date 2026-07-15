import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

@Injectable()
export class IdempotencyKeyPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== 'string' || value.length < 16 || value.length > 128) {
      throw new BadRequestException('Idempotency-Key must contain 16 to 128 characters');
    }
    return value;
  }
}
