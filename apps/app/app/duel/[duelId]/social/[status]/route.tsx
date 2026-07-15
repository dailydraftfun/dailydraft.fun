import { ImageResponse } from 'next/og';
import { type DuelStatus, getDuelSocialSnapshot, isDuelStatus } from '../../../social-card-data';

export const runtime = 'edge';

const imageSize = {
  width: 1200,
  height: 630,
};

function formatValue(value: number) {
  return `$${value.toLocaleString('en-US')}`;
}

function PullCard({
  label,
  name,
  value,
  accent,
  faded = false,
}: {
  label: string;
  name: string;
  value: number;
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
        <div style={{ display: 'flex', color: accent, fontSize: 44, fontWeight: 700 }}>
          {formatValue(value)}
        </div>
      </div>
    </div>
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ duelId: string; status: string }> },
) {
  const { duelId, status: statusParam } = await params;
  const status: DuelStatus = isDuelStatus(statusParam) ? statusParam : 'waiting';
  const duel = getDuelSocialSnapshot(duelId, status);
  const isResult = status === 'won' || status === 'lost';
  const isWinner = status === 'won';

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
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 700 }}>Pack Duel</div>
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
              DEMO
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
            <div style={{ display: 'flex', fontSize: 26, fontWeight: 700 }}>${duel.tier}</div>
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
        {isResult ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <PullCard
              label={isWinner ? 'Winner' : 'Your pull'}
              name={duel.playerCard}
              value={duel.playerValue}
              accent={duel.accent}
              faded={!isWinner}
            />
            <div style={{ display: 'flex', color: '#65717b', fontSize: 20, fontWeight: 700 }}>
              VS
            </div>
            <PullCard
              label={isWinner ? 'Opponent' : 'Winner'}
              name={duel.opponentCard}
              value={duel.opponentValue}
              accent={duel.accent}
              faded={isWinner}
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
                AUTHENTICATED
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', fontSize: 30, fontWeight: 700 }}>PACK DUEL</div>
                <div style={{ display: 'flex', color: '#9ca7af', fontSize: 18 }}>
                  ${duel.tier} pull
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
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}
