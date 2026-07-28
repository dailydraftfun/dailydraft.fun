import { timingSafeEqual } from 'node:crypto';

export type OperatorTreasurySummary = {
  configuration: {
    errors: string[];
    houseEnabled: boolean;
    network: string | null;
    separationOfDuties: boolean;
  };
  inventory: {
    concentration: {
      largestAssetBasisPoints: number;
      uniqueAssets: number;
    };
    heldAssets: number;
    heldValueAmount: string;
    realizedCostAmount: string;
    realizedPnlAmount: string;
    realizedProceedsAmount: string;
  };
  liquidity: {
    availableAmount: string;
    balanceAmount: string | null;
    decimals: number;
    delegatedAmount: string | null;
    minimumAmount: string;
    snapshotFresh: boolean;
    verifiedAt: string | null;
  };
  pendingGames: number;
  pendingGamesByStatus: Record<string, number>;
  ready: boolean;
  reconciliation: {
    discrepancies: Array<{
      detail: string;
      entityReference: string;
      expectedValue: string;
      firstObservedAt: string;
      kind: string;
      lastObservedAt: string;
      observedSlot: string;
      observedValue: string;
    }>;
    observedSlot: string | null;
    verifiedAt: string | null;
  };
  risk: {
    dailyLossAmount: string;
    dailyLossLimitAmount: string;
    disableReasons: string[];
    maxTotalExposureAmount: string;
    tierAdmissionStates: Array<{
      disabled: boolean;
      evaluatedAt: string;
      reason: string | null;
      reenableBoundary: string | null;
      tier: number;
      version: number;
    }>;
    totalExposureAmount: string;
    tiers: Array<{ pendingGames: number; tier: number }>;
  };
};

export function operatorDashboardAuthorized(
  authorization: string | null,
  expectedToken = process.env.DAILYDRAFT_OPERATOR_DASHBOARD_TOKEN,
): boolean {
  const candidate = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  if (!candidate || !expectedToken) return false;
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expectedToken);
  return (
    candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes)
  );
}

export async function getOperatorTreasurySummary(): Promise<OperatorTreasurySummary> {
  const apiUrl = (
    process.env.DAILYDRAFT_API_URL ??
    process.env.NEXT_PUBLIC_DUEL_API_URL ??
    ''
  ).replace(/\/$/, '');
  const apiKey = process.env.DAILYDRAFT_OPERATOR_API_KEY?.trim();
  if (!apiUrl || !apiKey) {
    throw new Error('Operator treasury dashboard is not configured.');
  }

  const response = await fetch(`${apiUrl}/admin/treasury`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Operator treasury summary is unavailable (${response.status}).`);
  }
  return (await response.json()) as OperatorTreasurySummary;
}
