import { ImageResponse } from 'next/og';

export const alt = 'Grail — Own the cards. Field the squad.';
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
          SPORTS FANTASY CASINO ON SOLANA
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
          <span>Own the cards.</span>
          <span style={{ color: '#b8ff5a' }}>Win the game.</span>
        </div>
        <div style={{ color: '#9aa39b', display: 'flex', fontSize: 25, marginTop: 34 }}>
          Real vaulted cards. Live match data. Powered by Collector Crypt.
        </div>
      </div>
      <div style={{ alignItems: 'center', display: 'flex', gap: 18 }}>
        {[
          { accent: '#b8ff5a', sport: 'FOOTBALL' },
          { accent: '#a78bfa', sport: 'HOOPS' },
        ].map(({ accent, sport }, index) => (
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
            <span style={{ display: 'flex', fontSize: 14, letterSpacing: 3 }}>GRADED</span>
            <span style={{ display: 'flex', fontSize: 40, fontWeight: 700 }}>{sport}</span>
            <span style={{ display: 'flex', fontSize: 22, marginTop: 90 }}>$100</span>
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
