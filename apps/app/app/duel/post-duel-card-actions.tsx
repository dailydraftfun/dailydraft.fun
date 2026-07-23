import { formatPublicMoney } from './public-money';
import type {
  PublicDuelReceipt,
  PublicMoney,
  PublicPostDuelCardAction,
  PublicPostDuelCardActionState,
} from './public-proof-client';

export type PostDuelCardActionCapability = Omit<
  PublicPostDuelCardAction,
  'availability' | 'reason'
> & {
  availability: 'available' | 'expired' | 'pending' | 'unavailable';
  expiresAt?: string | null;
  href?: string | null;
  reason:
    | 'buyback-expired'
    | 'ownership-pending'
    | 'partner-onboarding-required'
    | 'unsupported'
    | null;
  value?: PublicMoney | null;
};

export type PostDuelCardCapabilityState = Omit<PublicPostDuelCardActionState, 'actions'> & {
  actions: PostDuelCardActionCapability[];
  displayedValue?: PublicMoney | null;
};

export function toCardActionState(
  state: PublicPostDuelCardActionState,
): PostDuelCardCapabilityState {
  return {
    ...state,
    actions: state.actions.map((action) => ({ ...action })),
  };
}

export function CardActionState({ state }: { state: PostDuelCardCapabilityState }) {
  const list = state.actions.find((action) => action.action === 'list');
  const sellBack = state.actions.find((action) => action.action === 'sell-back');
  const idPrefix = domId(state.actionStateId);

  return (
    <section className="receipt-card-actions" aria-labelledby={`${idPrefix}-title`}>
      <div className="receipt-card-action-owner">
        <p className="receipt-kicker">Final owner</p>
        <strong id={`${idPrefix}-title`}>
          {state.displayName} · {state.owner.display}
        </strong>
        <small>Ownership reconciled</small>
      </div>
      <dl className="receipt-card-action-values" aria-label={`${state.displayName} value fields`}>
        <ValueField label="Displayed value" value={state.displayedValue} />
        <ValueField label="Insured value" value={state.insuredValue} />
        <ValueField label="Listing price" value={list?.value} />
        <ValueField label="Buyback quote" value={sellBack?.value} />
      </dl>
      <ul aria-label={`${state.displayName} supported actions`}>
        {state.actions.map((action) => (
          <CardAction
            key={action.action}
            action={action}
            cardName={state.displayName}
            idPrefix={`${idPrefix}-${action.action}`}
          />
        ))}
      </ul>
      <p className="receipt-card-settlement">
        Settlement reference: {state.ownership.settlementSignature}
      </p>
    </section>
  );
}

export function CardActionGate({ reason }: { reason: PublicDuelReceipt['cardActions']['reason'] }) {
  return (
    <p className="receipt-action-gate" role={reason === 'ownership-mismatch' ? 'alert' : 'status'}>
      {cardActionGateMessage(reason)}
    </p>
  );
}

function CardAction({
  action,
  cardName,
  idPrefix,
}: {
  action: PostDuelCardActionCapability;
  cardName: string;
  idPrefix: string;
}) {
  const detailId = `${idPrefix}-detail`;
  const target = actionTarget(action);
  const supported =
    action.availability === 'available' && (action.action === 'keep' || Boolean(target));
  const effectiveAvailability =
    supported || action.availability !== 'available' ? action.availability : 'unavailable';
  const unavailableLabel = actionAvailabilityLabel(effectiveAvailability);

  return (
    <li data-action={action.action} data-availability={effectiveAvailability}>
      <div>
        <span>{action.label}</span>
        {supported ? (
          target ? (
            <a
              href={target}
              aria-describedby={detailId}
              aria-label={`${action.label} for ${cardName}`}
            >
              Open
            </a>
          ) : (
            <small className="receipt-action-available" role="status">
              Supported
            </small>
          )
        ) : (
          <button
            type="button"
            disabled
            aria-describedby={detailId}
            aria-label={`${action.label} ${unavailableLabel.toLowerCase()} for ${cardName}`}
          >
            {unavailableLabel}
          </button>
        )}
      </div>
      <p id={detailId}>{action.detail}</p>
      {action.expiresAt ? (
        <p>
          Quote expires: <time dateTime={action.expiresAt}>{formatExpiry(action.expiresAt)}</time>
        </p>
      ) : null}
      {action.alternative ? (
        <p className="receipt-card-action-alternative">
          Available alternative: {action.alternative.label}
        </p>
      ) : null}
    </li>
  );
}

function ValueField({
  label,
  value,
}: {
  label: string;
  value: PostDuelCardCapabilityState['insuredValue'] | null | undefined;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ? formatPublicMoney(value) : 'Not provided'}</dd>
    </div>
  );
}

function actionTarget(action: PostDuelCardActionCapability): string | null {
  if (action.action === 'keep' || action.availability !== 'available' || !action.href) return null;
  if (
    !action.href.startsWith('/') ||
    action.href.startsWith('//') ||
    action.href.includes('\\') ||
    hasControlCharacter(action.href)
  ) {
    return null;
  }
  const base = new URL('https://openpacksduel.invalid');
  const target = new URL(action.href, base);
  if (target.origin !== base.origin) return null;
  return `${target.pathname}${target.search}${target.hash}`;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function actionAvailabilityLabel(
  availability: PostDuelCardActionCapability['availability'],
): 'Expired' | 'Pending' | 'Unavailable' {
  if (availability === 'expired') return 'Expired';
  if (availability === 'pending') return 'Pending';
  return 'Unavailable';
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid expiry' : date.toLocaleString();
}

function domId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, '-');
}

function cardActionGateMessage(reason: PublicDuelReceipt['cardActions']['reason']): string {
  const messages: Record<Exclude<typeof reason, null>, string> = {
    'duel-not-settled': 'Card actions stay hidden until the duel reaches settled state.',
    'mock-assets': 'Card actions stay hidden because mock results do not transfer real cards.',
    'ownership-mismatch':
      'Card actions are hidden because recorded ownership disagrees with the canonical result.',
    'ownership-pending':
      'Card actions stay hidden until an exact finalized settlement reference reconciles ownership.',
  };
  return reason ? messages[reason] : 'Card actions are unavailable.';
}
