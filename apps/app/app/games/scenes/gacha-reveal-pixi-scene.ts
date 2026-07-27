import { themePackContractFixtures } from '@dailydraft/contracts/theme-pack';
import { applyThemeToScene, resolveThemePack, type SceneThemeStyle } from '@dailydraft/engine';
import {
  Assets,
  Container,
  definePixiScene,
  Graphics,
  ParticleEmitter,
  type PixiSceneInstance,
  Sprite,
  Text,
  type Texture,
  type Ticker,
} from '@dailydraft/engine/pixi';

import {
  gachaRevealFrameAt,
  gachaRevealParticle,
  particleBurstCount,
} from './gacha-reveal-choreography';
import { type GachaRevealSceneInput, gachaRevealSceneMetadata } from './gacha-reveal-contract';

const CARD_WIDTH = 238;
const CARD_HEIGHT = 334;
const CENTER_X = gachaRevealSceneMetadata.designSize.width / 2;
const CENTER_Y = gachaRevealSceneMetadata.designSize.height / 2 + 4;

/**
 * The first production Pixi scene. It is deliberately an output adapter:
 * every gameplay-bearing value arrives in `props` from the settled server rip.
 * The scene only stages that immutable result.
 */
export const gachaRevealPixiScene = definePixiScene<GachaRevealSceneInput>({
  ...gachaRevealSceneMetadata,
  async create({
    application,
    props,
    quality,
    signal,
    stage,
    viewport,
  }): Promise<PixiSceneInstance> {
    const bundledPack = themePackContractFixtures.devnetDemo;
    const resolution = resolveThemePack(bundledPack);
    if (
      resolution.status !== 'ready' ||
      props.themeId !== resolution.theme.id ||
      props.themeVersion !== resolution.theme.version
    ) {
      throw new Error('The requested gacha reveal theme is not an available bundled version.');
    }

    const texture = await Assets.load<Texture>(props.cardImageUrl);
    if (signal?.aborted) {
      throw new DOMException('The gacha reveal was aborted.', 'AbortError');
    }

    const root = new Container();
    root.label = `server-settled-gacha-${props.revealId}`;
    const backdrop = new Graphics();
    const broadcastFrame = new Graphics();
    const particleLayer = new Container<Graphics>();
    const aura = new Graphics();
    const pack = new Container();
    const packSurface = new Graphics();
    const packSeams = new Graphics();
    const packWordmark = new Text({
      style: {
        align: 'center',
        fill: '#F6F8F3',
        fontFamily: 'DM Sans, sans-serif',
        fontSize: 31,
        fontWeight: '700',
        letterSpacing: -1,
      },
      text: 'DAILYDRAFT',
    });
    const packCaption = new Text({
      style: {
        align: 'center',
        fill: '#B7C0B6',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 2.4,
      },
      text: 'SEALED SPORTS PACK',
    });
    const card = new Container();
    const cardShadow = new Graphics();
    const cardSprite = new Sprite(texture);
    const cardFrame = new Graphics();
    const glare = new Graphics();
    const rarityLabel = new Text({
      style: {
        fill: '#F6F8F3',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1.8,
      },
      text: props.rarity.toUpperCase(),
    });
    const outcomeLabel = new Text({
      style: {
        align: 'center',
        fill: '#B7C0B6',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 10,
        fontWeight: '600',
        letterSpacing: 1.7,
      },
      text: 'SERVER SETTLED · VERIFIED ART',
    });

    particleLayer.position.set(CENTER_X, CENTER_Y);
    aura.position.set(CENTER_X, CENTER_Y);
    pack.position.set(CENTER_X, CENTER_Y);
    card.position.set(CENTER_X, CENTER_Y);
    packSurface.position.set(-CARD_WIDTH / 2, -CARD_HEIGHT / 2);
    packSeams.position.set(-CARD_WIDTH / 2, -CARD_HEIGHT / 2);
    packWordmark.anchor.set(0.5);
    packWordmark.position.set(0, -6);
    packCaption.anchor.set(0.5);
    packCaption.position.set(0, 29);
    pack.addChild(packSurface, packSeams, packWordmark, packCaption);

    cardShadow.position.set(-CARD_WIDTH / 2, -CARD_HEIGHT / 2);
    cardSprite.anchor.set(0.5);
    const cardTextureScale = Math.min(
      (CARD_WIDTH - 16) / texture.width,
      (CARD_HEIGHT - 16) / texture.height,
    );
    cardSprite.scale.set(cardTextureScale);
    cardFrame.position.set(-CARD_WIDTH / 2, -CARD_HEIGHT / 2);
    glare.position.set(-CARD_WIDTH / 2, -CARD_HEIGHT / 2);
    rarityLabel.position.set(-CARD_WIDTH / 2 + 17, -CARD_HEIGHT / 2 + 18);
    outcomeLabel.anchor.set(0.5);
    outcomeLabel.position.set(0, CARD_HEIGHT / 2 + 27);
    card.addChild(cardShadow, cardSprite, cardFrame, glare, rarityLabel, outcomeLabel);

    root.addChild(backdrop, broadcastFrame, aura, particleLayer, pack, card);
    stage.addChild(root);

    const particles = new ParticleEmitter(particleLayer, quality);
    let elapsedMs = 0;
    let burstEmitted = false;
    let destroyed = false;
    let currentStyle: SceneThemeStyle | null = null;

    const redrawTheme = (style: SceneThemeStyle): void => {
      currentStyle = style;
      const { palette, foil } = style.treatment;

      backdrop
        .clear()
        .rect(
          0,
          0,
          gachaRevealSceneMetadata.designSize.width,
          gachaRevealSceneMetadata.designSize.height,
        )
        .fill({ color: '#070907' })
        .circle(CENTER_X, CENTER_Y - 8, 255)
        .fill({ alpha: 0.12 + foil.brightness * 0.12, color: palette.glow })
        .circle(CENTER_X, CENTER_Y, 172)
        .fill({ alpha: 0.08 + foil.iridescence * 0.1, color: palette.accent });

      broadcastFrame
        .clear()
        .roundRect(18, 18, 684, 524, 18)
        .stroke({ alpha: 0.2, color: palette.accent, width: 1 })
        .moveTo(38, 55)
        .lineTo(118, 55)
        .stroke({ alpha: 0.6, color: palette.accent, width: 2 })
        .moveTo(602, 505)
        .lineTo(682, 505)
        .stroke({ alpha: 0.6, color: palette.accent, width: 2 });

      aura
        .clear()
        .circle(0, 0, CARD_WIDTH * 0.73)
        .fill({ alpha: 0.07 + foil.glare * 0.09, color: palette.glow })
        .circle(0, 0, CARD_WIDTH * 0.56)
        .stroke({ alpha: 0.16 + foil.brightness * 0.2, color: palette.accent, width: 2 });

      packSurface
        .clear()
        .roundRect(0, 0, CARD_WIDTH, CARD_HEIGHT, 15)
        .fill({ color: palette.shadow })
        .roundRect(7, 7, CARD_WIDTH - 14, CARD_HEIGHT - 14, 11)
        .fill({ alpha: 0.26, color: palette.surface[0] })
        .roundRect(13, 13, CARD_WIDTH - 26, CARD_HEIGHT - 26, 9)
        .stroke({ alpha: 0.58, color: palette.accent, width: 1.5 });
      drawPackSeams(packSeams, palette.accent);

      cardShadow
        .clear()
        .roundRect(-8, 9, CARD_WIDTH + 16, CARD_HEIGHT + 16, 17)
        .fill({ alpha: 0.56, color: '#000000' });
      cardFrame
        .clear()
        .roundRect(0, 0, CARD_WIDTH, CARD_HEIGHT, 15)
        .stroke({ alpha: 0.78, color: palette.accent, width: 2 })
        .roundRect(5, 5, CARD_WIDTH - 10, CARD_HEIGHT - 10, 12)
        .stroke({ alpha: 0.34, color: palette.glow, width: 1 });
      glare
        .clear()
        .poly([
          -CARD_WIDTH * 0.42,
          CARD_HEIGHT,
          CARD_WIDTH * 0.03,
          CARD_HEIGHT,
          CARD_WIDTH * 0.44,
          0,
          -CARD_WIDTH * 0.01,
          0,
        ])
        .fill({ alpha: 0.05 + foil.glare * 0.16, color: '#FFFFFF' });
      rarityLabel.style.fill = palette.accent;
    };

    const themeAdapter = { applyTheme: redrawTheme };
    applyThemeToScene(themeAdapter, resolution.theme, props.rarity);

    const emitCelebration = (): void => {
      if (!currentStyle) return;
      const count = particleBurstCount(props.rarity);
      particles.emitBurst(count, (index) => {
        const plan = gachaRevealParticle(index, count, props.rarity);
        const display = new Graphics().circle(0, 0, plan.radius).fill({
          alpha: 0.92,
          color:
            index % 3 === 0
              ? currentStyle?.treatment.palette.glow
              : currentStyle?.treatment.palette.accent,
        });
        return {
          display,
          endScale: plan.endScale,
          lifetimeMs: plan.lifetimeMs,
          spinRadiansPerSecond: index % 2 === 0 ? 1.4 : -1.4,
          startScale: plan.startScale,
          velocityX: plan.velocityX,
          velocityY: plan.velocityY,
        };
      });
    };

    const renderFrame = (): void => {
      const frame = gachaRevealFrameAt(props.rarity, elapsedMs);
      pack.alpha = frame.packAlpha;
      pack.rotation = frame.packRotation;
      pack.scale.set(frame.packScale);
      pack.x = CENTER_X + Math.sin(elapsedMs / 31) * (frame.beat === 'hold' ? 3.2 : 0.8);

      card.alpha = frame.cardAlpha;
      card.rotation = frame.cardRotation;
      card.scale.set(frame.cardScale);
      glare.x = -CARD_WIDTH + frame.glareProgress * CARD_WIDTH * 1.85;
      aura.alpha = frame.beat === 'celebrate' ? 1 : frame.cardAlpha * 0.68;
      aura.scale.set(0.9 + frame.cardScale * 0.12);

      if (!burstEmitted && frame.beat === 'celebrate') {
        burstEmitted = true;
        emitCelebration();
      }
    };

    const onTick = (ticker: Ticker): void => {
      const delta = Number.isFinite(ticker.elapsedMS) ? Math.min(50, ticker.elapsedMS) : 0;
      elapsedMs += delta;
      particles.update(delta);
      renderFrame();
    };

    const resize = (nextViewport: typeof viewport): void => {
      const scale = Math.min(
        nextViewport.width / gachaRevealSceneMetadata.designSize.width,
        nextViewport.height / gachaRevealSceneMetadata.designSize.height,
      );
      root.scale.set(scale);
      root.position.set(
        (nextViewport.width - gachaRevealSceneMetadata.designSize.width * scale) / 2,
        (nextViewport.height - gachaRevealSceneMetadata.designSize.height * scale) / 2,
      );
    };

    card.alpha = 0;
    renderFrame();
    resize(viewport);
    application.ticker.add(onTick);

    return {
      applyTheme(style) {
        redrawTheme(style);
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        application.ticker.remove(onTick);
        particles.clear();
        root.removeFromParent();
        root.destroy({ children: true });
      },
      resize,
      setQuality(nextQuality) {
        particles.setQuality(nextQuality);
      },
    };
  },
});

function drawPackSeams(graphics: Graphics, accent: string): void {
  graphics.clear();
  for (let offset = 18; offset < CARD_WIDTH - 18; offset += 14) {
    graphics
      .moveTo(offset, 8)
      .lineTo(offset + 7, 18)
      .stroke({ alpha: 0.32, color: accent, width: 1 });
    graphics
      .moveTo(offset, CARD_HEIGHT - 8)
      .lineTo(offset + 7, CARD_HEIGHT - 18)
      .stroke({ alpha: 0.32, color: accent, width: 1 });
  }
  graphics
    .moveTo(CARD_WIDTH / 2, 30)
    .lineTo(CARD_WIDTH / 2, CARD_HEIGHT - 30)
    .stroke({ alpha: 0.2, color: accent, width: 1 });
}
