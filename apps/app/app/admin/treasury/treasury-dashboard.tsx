import type { OperatorTreasurySummary } from './operator-treasury-client';
import styles from './treasury-dashboard.module.css';

export function TreasuryDashboard({ summary }: { summary: OperatorTreasurySummary }) {
  const alerts = treasuryAlerts(summary);
  const state = alerts.length === 0 ? 'healthy' : 'attention';
  const empty =
    summary.liquidity.balanceAmount === null &&
    summary.pendingGames === 0 &&
    summary.inventory.heldAssets === 0;

  return (
    <main className={styles.shell} data-treasury-state={state}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>House operations · read only</p>
          <h1>Canonical treasury</h1>
          <p>
            Recorded ledger state is shown separately from the last finalized Solana observation.
            This surface has no policy, disposition, or remediation controls.
          </p>
        </div>
        <div className={styles.status} role="status">
          <span aria-hidden="true" />
          {state === 'healthy' ? 'Reconciled and within limits' : 'Operator attention required'}
        </div>
      </header>

      {alerts.length > 0 ? (
        <section aria-labelledby="treasury-alerts" className={styles.alerts} role="alert">
          <h2 id="treasury-alerts">Observed conditions</h2>
          <ul>
            {alerts.map((alert) => (
              <li key={alert}>{alert}</li>
            ))}
          </ul>
          <p>Review canonical evidence and the runbook. No corrective action is available here.</p>
        </section>
      ) : null}

      {empty ? (
        <section className={styles.empty} aria-labelledby="treasury-empty">
          <h2 id="treasury-empty">No treasury observation or recorded exposure</h2>
          <p>The dashboard will populate after the first finalized reconciliation.</p>
        </section>
      ) : null}

      <section aria-labelledby="ledger-state">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Recorded values</p>
            <h2 id="ledger-state">Canonical ledger</h2>
          </div>
          <small>Append-only database evidence</small>
        </div>
        <dl className={styles.metrics}>
          <Metric
            label="Available liquidity"
            value={formatAmount(summary.liquidity.availableAmount, summary.liquidity.decimals)}
          />
          <Metric
            label="Reserved exposure"
            value={formatAmount(summary.risk.totalExposureAmount, summary.liquidity.decimals)}
          />
          <Metric label="Pending games" value={String(summary.pendingGames)} />
          <Metric label="Cards held" value={String(summary.inventory.heldAssets)} />
          <Metric
            label="Realized gains / losses"
            value={formatSignedAmount(
              summary.inventory.realizedPnlAmount,
              summary.liquidity.decimals,
            )}
          />
          <Metric
            label="Held acquisition value"
            value={formatAmount(summary.inventory.heldValueAmount, summary.liquidity.decimals)}
          />
        </dl>
      </section>

      <section aria-labelledby="solana-state">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Last observed values</p>
            <h2 id="solana-state">Finalized Solana evidence</h2>
          </div>
          <small>
            Slot {summary.reconciliation.observedSlot ?? 'not observed'} ·{' '}
            {formatTimestamp(summary.reconciliation.verifiedAt)}
          </small>
        </div>
        <dl className={styles.metrics}>
          <Metric
            label="Token-account balance"
            value={formatNullableAmount(
              summary.liquidity.balanceAmount,
              summary.liquidity.decimals,
            )}
          />
          <Metric
            label="Delegated allowance"
            value={formatNullableAmount(
              summary.liquidity.delegatedAmount,
              summary.liquidity.decimals,
            )}
          />
          <Metric
            label="Minimum liquidity"
            value={formatAmount(summary.liquidity.minimumAmount, summary.liquidity.decimals)}
          />
          <Metric
            label="Snapshot freshness"
            value={summary.liquidity.snapshotFresh ? 'Fresh' : 'Stale'}
          />
        </dl>
      </section>

      <section aria-labelledby="risk-state">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Limits and concentration</p>
            <h2 id="risk-state">Risk posture</h2>
          </div>
        </div>
        <dl className={styles.metrics}>
          <Metric
            label="Daily loss"
            value={`${formatAmount(
              summary.risk.dailyLossAmount,
              summary.liquidity.decimals,
            )} / ${formatAmount(summary.risk.dailyLossLimitAmount, summary.liquidity.decimals)}`}
          />
          <Metric
            label="Exposure"
            value={`${formatAmount(
              summary.risk.totalExposureAmount,
              summary.liquidity.decimals,
            )} / ${formatAmount(summary.risk.maxTotalExposureAmount, summary.liquidity.decimals)}`}
          />
          <Metric
            label="Largest asset concentration"
            value={`${(summary.inventory.concentration.largestAssetBasisPoints / 100).toFixed(2)}%`}
          />
          <Metric
            label="Unique held assets"
            value={String(summary.inventory.concentration.uniqueAssets)}
          />
        </dl>
      </section>

      {summary.reconciliation.discrepancies.length > 0 ? (
        <section aria-labelledby="reconciliation-evidence">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Unresolved evidence</p>
              <h2 id="reconciliation-evidence">Reconciliation discrepancies</h2>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Entity</th>
                  <th scope="col">Expected</th>
                  <th scope="col">Observed</th>
                  <th scope="col">Slot</th>
                  <th scope="col">Condition</th>
                </tr>
              </thead>
              <tbody>
                {summary.reconciliation.discrepancies.map((row) => (
                  <tr key={`${row.kind}:${row.entityReference}`}>
                    <th scope="row">{row.entityReference}</th>
                    <td>{row.expectedValue}</td>
                    <td>{row.observedValue}</td>
                    <td>{row.observedSlot}</td>
                    <td>{row.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function treasuryAlerts(summary: OperatorTreasurySummary): string[] {
  return [
    ...(!summary.liquidity.snapshotFresh
      ? ['The finalized Solana treasury observation is stale.']
      : []),
    ...(summary.reconciliation.discrepancies.length > 0
      ? [
          `${summary.reconciliation.discrepancies.length} unresolved reconciliation ${
            summary.reconciliation.discrepancies.length === 1 ? 'discrepancy' : 'discrepancies'
          }.`,
        ]
      : []),
    ...summary.risk.disableReasons.map(
      (reason) => `House admission limit: ${reason.replaceAll('_', ' ')}.`,
    ),
    ...summary.configuration.errors.map(
      (error) => `Treasury configuration: ${error.replaceAll('_', ' ')}.`,
    ),
  ];
}

function formatAmount(value: string, decimals: number): string {
  const amount = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} USDC`;
}

function formatSignedAmount(value: string, decimals: number): string {
  const amount = BigInt(value);
  const sign = amount > 0n ? '+' : amount < 0n ? '−' : '';
  return `${sign}${formatAmount((amount < 0n ? -amount : amount).toString(), decimals)}`;
}

function formatNullableAmount(value: string | null, decimals: number): string {
  return value === null ? 'Not observed' : formatAmount(value, decimals);
}

function formatTimestamp(value: string | null): string {
  return value ? `${new Date(value).toLocaleString('en-US', { timeZone: 'UTC' })} UTC` : 'Never';
}
