import { Type } from 'class-transformer';
import { IsInt, Matches, Max, Min } from 'class-validator';

const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;

export class TransactionSubmissionParams {
  @Matches(/^duel_[A-Za-z0-9]{12,64}$/)
  duelId!: string;

  @Matches(/^tx_[A-Za-z0-9]{12,64}$/)
  transactionId!: string;
}

export class RecordSubmissionRequest {
  @Matches(SOLANA_SIGNATURE)
  signature!: string;
}

export class ReconciliationQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
