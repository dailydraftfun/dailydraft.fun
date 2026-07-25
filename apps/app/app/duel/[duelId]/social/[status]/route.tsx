import { ImageResponse } from 'next/og';
import { getDuelPullPresentation } from '../../../duel-receipt-presentation';
import { fetchPublicDuelReceipt } from '../../../public-proof-client';
import { getDuelSocialSnapshot, resolveDuelStatus } from '../../../social-card-data';

export const runtime = 'edge';

const imageSize = {
  width: 1200,
  height: 630,
};

function PullCard({
  label,
  name,
  value,
  accent,
  faded = false,
}: {
  label: string;
  name: string;
  value: string;
  accent: string;
  faded?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: 240,
        height: 300,
        padding: 24,
        border: `1px solid ${faded ? '#273039' : accent}`,
        borderRadius: 24,
        background: faded
          ? 'linear-gradient(145deg, #11161a, #090c0e)'
          : `linear-gradient(145deg, ${accent}22, #0b0f11 58%)`,
        opacity: faded ? 0.64 : 1,
        boxShadow: faded ? 'none' : `0 24px 70px ${accent}20`,
      }}
    >
      <div
        style={{
          display: 'flex',
          color: '#87919c',
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', color: '#f4f7f8', fontSize: 30, fontWeight: 700 }}>
          {name}
        </div>
        <div style={{ display: 'flex', color: accent, fontSize: 44, fontWeight: 700 }}>{value}</div>
      </div>
    </div>
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ duelId: string; status: string }> },
) {
  const { duelId, status: statusParam } = await params;
  const receipt = await fetchPublicDuelReceipt(duelId);
  if (!receipt) return unavailableImage(duelId);
  const requestedStatus = resolveDuelStatus(statusParam);
  const duel = getDuelSocialSnapshot(receipt, requestedStatus);
  const isResult = duel.status === 'settled' && duel.pulls.length === 2;
  const firstPull = duel.pulls[0];
  const secondPull = duel.pulls[1];
  const winnerSide = receipt.result?.winnerSide ?? null;
  const firstPullPresentation = firstPull
    ? getDuelPullPresentation({
        mockPreview: duel.mockPreview,
        side: firstPull.side,
        winnerSide,
      })
    : null;
  const secondPullPresentation = secondPull
    ? getDuelPullPresentation({
        mockPreview: duel.mockPreview,
        side: secondPull.side,
        winnerSide,
      })
    : null;

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        color: '#f4f7f8',
        background: 'radial-gradient(circle at 83% 8%, #1c2926 0%, #090d0f 34%, #050708 72%)',
        padding: '52px 58px',
      }}
    >
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          inset: 0,
          opacity: 0.16,
          backgroundImage:
            'linear-gradient(90deg, #82909a 1px, transparent 1px), linear-gradient(0deg, #82909a 1px, transparent 1px)',
          backgroundSize: '42px 42px',
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: 610,
          height: '100%',
          zIndex: 1,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                display: 'flex',
                width: 34,
                height: 34,
                borderRadius: 9,
                background: duel.accent,
                boxShadow: `0 0 32px ${duel.accent}55`,
              }}
            />
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 700 }}>DailyDraft</div>
            <div
              style={{
                display: 'flex',
                padding: '7px 11px',
                border: '1px solid #34404a',
                borderRadius: 8,
                color: '#9da7b0',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 2,
              }}
            >
              DEVNET
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div
              style={{
                display: 'flex',
                alignSelf: 'flex-start',
                padding: '10px 15px',
                border: `1px solid ${duel.accent}66`,
                borderRadius: 999,
                color: duel.accent,
                background: `${duel.accent}12`,
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: 2.2,
              }}
            >
              {duel.badge}
            </div>
            <div
              style={{
                display: 'flex',
                maxWidth: 590,
                fontSize: 66,
                fontWeight: 700,
                lineHeight: 1.02,
                letterSpacing: -3.2,
              }}
            >
              {duel.headline}
            </div>
            <div
              style={{
                display: 'flex',
                maxWidth: 550,
                color: '#a7b0b8',
                fontSize: 24,
                lineHeight: 1.35,
              }}
            >
              {duel.subline}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', color: '#737f89', fontSize: 13, letterSpacing: 2 }}>
              PACK TIER
            </div>
            <div style={{ display: 'flex', fontSize: 26, fontWeight: 700 }}>{duel.tier}</div>
          </div>
          <div style={{ display: 'flex', width: 1, height: 44, background: '#2a333a' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', color: '#737f89', fontSize: 13, letterSpacing: 2 }}>
              DUEL
            </div>
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 700 }}>
              {duel.duelId.slice(0, 16)}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          position: 'absolute',
          right: 54,
          top: 70,
          width: 500,
          height: 490,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1,
        }}
      >
        {isResult && firstPull && secondPull ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <PullCard
              label={firstPullPresentation?.label ?? 'Pull'}
              name={firstPull.displayName}
              value={firstPull.value}
              accent={duel.accent}
              faded={!firstPullPresentation?.emphasized}
            />
            <div style={{ display: 'flex', color: '#65717b', fontSize: 20, fontWeight: 700 }}>
              VS
            </div>
            <PullCard
              label={secondPullPresentation?.label ?? 'Pull'}
              name={secondPull.displayName}
              value={secondPull.value}
              accent={duel.accent}
              faded={!secondPullPresentation?.emphasized}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div
              style={{
                display: 'flex',
                width: 225,
                height: 330,
                transform: 'rotate(-8deg) translateX(26px)',
                border: '1px solid #3b474f',
                borderRadius: 28,
                background: 'linear-gradient(145deg, #151c20, #090c0e)',
                boxShadow: '0 28px 80px #000000aa',
              }}
            />
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                width: 225,
                height: 330,
                padding: 28,
                transform: 'rotate(8deg) translateX(-26px)',
                border: `1px solid ${duel.accent}`,
                borderRadius: 28,
                background: `linear-gradient(145deg, ${duel.accent}28, #090c0e 64%)`,
                boxShadow: `0 28px 90px ${duel.accent}28`,
              }}
            >
              <div style={{ display: 'flex', color: duel.accent, fontSize: 15, letterSpacing: 2 }}>
                CANONICAL RECEIPT
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', fontSize: 30, fontWeight: 700 }}>DAILYDRAFT</div>
                <div style={{ display: 'flex', color: '#9ca7af', fontSize: 18 }}>
                  {duel.tier} pull
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    {
      ...imageSize,
      headers: {
        'Cache-Control': 'no-store',
        'X-Dailydraft-Status': duel.status,
      },
    },
  );
}

function unavailableImage(duelId: string) {
  return new ImageResponse(
    <div
      style={{
        alignItems: 'center',
        background: '#050708',
        color: '#f4f7f8',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'center',
        padding: 64,
        width: '100%',
      }}
    >
      <div style={{ color: '#d8ff3e', display: 'flex', fontSize: 24, fontWeight: 700 }}>
        DAILYDRAFT · DEVNET
      </div>
      <div style={{ display: 'flex', fontSize: 60, fontWeight: 700, marginTop: 28 }}>
        Proof unavailable
      </div>
      <div style={{ color: '#9da7b0', display: 'flex', fontSize: 24, marginTop: 18 }}>
        No public receipt was found for {duelId.slice(0, 24)}.
      </div>
    </div>,
    {
      ...imageSize,
      headers: { 'Cache-Control': 'no-store' },
      status: 404,
    },
  );
}
