import { ImageResponse } from 'next/og';

export const alt = 'Pack Duel — Two packs. One winner.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: 'center',
        background: 'radial-gradient(circle at 78% 18%, #25351f 0%, #0b100c 36%, #050705 75%)',
        color: '#f5f7f2',
        display: 'flex',
        height: '100%',
        justifyContent: 'space-between',
        padding: '70px 78px',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', width: 650 }}>
        <div
          style={{
            color: '#b8ff5a',
            display: 'flex',
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 4,
          }}
        >
          TRADING CARD DUELS ON SOLANA
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 80,
            fontWeight: 700,
            letterSpacing: -5,
            lineHeight: 0.95,
            marginTop: 28,
          }}
        >
          <span>Two packs.</span>
          <span style={{ color: '#b8ff5a' }}>One winner.</span>
        </div>
        <div style={{ color: '#9aa39b', display: 'flex', fontSize: 25, marginTop: 34 }}>
          Rip together. Higher verified pull takes both cards.
        </div>
      </div>
      <div style={{ alignItems: 'center', display: 'flex', gap: 18 }}>
        {['#b8ff5a', '#a78bfa'].map((accent, index) => (
          <div
            key={accent}
            style={{
              alignItems: 'center',
              background: `linear-gradient(145deg, ${accent}33, #090c09)`,
              border: `2px solid ${accent}88`,
              borderRadius: 24,
              boxShadow: '0 30px 80px #00000099',
              color: accent,
              display: 'flex',
              flexDirection: 'column',
              height: 330,
              justifyContent: 'center',
              transform: `rotate(${index === 0 ? -6 : 6}deg)`,
              width: 210,
            }}
          >
            <span style={{ display: 'flex', fontSize: 14, letterSpacing: 3 }}>PACK</span>
            <span style={{ display: 'flex', fontSize: 44, fontWeight: 700 }}>DUEL</span>
            <span style={{ display: 'flex', fontSize: 22, marginTop: 90 }}>$50</span>
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
