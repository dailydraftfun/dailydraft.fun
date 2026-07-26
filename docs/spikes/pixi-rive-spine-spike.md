# PixiJS v8 rendering and authored-animation spike

Captured 2026-07-26 from a throwaway prototype built against
`bf46193c97c96c15d995e2a781688368ea4f75ac` in the real `apps/app` Next.js
application. The prototype and dependency changes were removed after measurement;
the reproducibility source below and the benchmark results are the deliverable.

## Decision

**Proceed with PixiJS v8 for tier-2 pack-opening scenes, choose Rive as the
default authored-animation format for pack/card reveals, and keep the existing
DOM/CSS holographic card as the fail-closed baseline.**

The important qualifiers are:

- Start production on Pixi's WebGL renderer. Keep the proven WebGPU-first path
  behind a capability/telemetry cohort until the browser and real-device matrix
  is green. Pixi's own renderer guide still recommends WebGL for production.
- Lazy-load the renderer only when a tier-2 reveal is entered. A static named
  Pixi import inside the dynamically loaded scene cost **179.6 KiB gzip** in the
  real app build; a full module-namespace import cost **227.6 KiB gzip**.
- Use Rive for the authored pack shell, logo, masks, and state-driven reveal
  beats; keep scene orchestration, particles, card data, sound, haptics, and
  degradation policy in Pixi/application code. Start with Rive `canvas-lite`
  and keep text/layout/audio in Pixi or DOM so the smallest runtime remains an
  option.
- Do not make Spine a platform dependency now. It remains the better exception
  for a future theme centered on skeletal characters, deformable meshes, or a
  studio already delivering Spine assets.

The authored-animation decision reverses to Spine if a production asset trial
shows that a separate Rive renderer/canvas causes unacceptable composition or
memory cost, if direct single-canvas Pixi batching is mandatory, or if the
content roadmap shifts from pack/card motion to character-heavy skeletal
animation. Any reversal also requires accepting Spine's runtime-license
obligations for the planned externally consumable SDK.

## Scope and evidence

The spike built one responsive, looping pack-open scene at a design size of
390×620:

- a foil pack with a shake/charge phase;
- an 18-ray burst and 96 vector sparks;
- a card reveal with overshoot, float, glow, and fade/reset;
- a 4.8-second deterministic presentation loop capped at 60 ticker updates per
  second;
- no downloaded art or textures, so rendering overhead could be isolated from
  asset-network variance.

The route was `/dev/pixi-spike` in the App Router. It used PixiJS **8.19.0** and
was built with the repository-pinned Next.js **16.2.4** / React **19.2.5**
application.

Host and browser:

| Item | Value |
| --- | --- |
| Machine | Mac Studio `Mac13,1`, Apple M1 Max, 64 GiB RAM |
| Browser | Brave `150.0.7871.182`, automated through its Chromium debugging protocol |
| Production mode | `next build`, then `next start` |
| Mobile viewport | 390×844 CSS pixels, device-pixel ratio 2, touch/mobile context |
| User agent profile | Android 11 / Moto G Power-shaped mobile UA |
| CPU profile | Explicit DevTools `Emulation.setCPUThrottlingRate({ rate: 6 })` |
| GPU caveat | Still the host Apple GPU/Metal adapter; this is a low-end **CPU emulation**, not a physical low-end mobile GPU |

No physical Android or iPhone was available. Thermal behavior, battery use,
tile-based mobile-GPU pressure, and real mobile browser scheduling are therefore
open measurements, not silently inferred from the desktop run.

## What was built in Next.js

The server page imported a very small client boundary. That client boundary
used `next/dynamic` with `ssr: false` to load the actual Pixi scene. Pixi was
therefore absent from server execution and from the initial server-rendered
canvas tree, while Next could still return meaningful route metadata and a
loading state.

The lifecycle was:

1. React mounts the client scene.
2. The effect creates `new Application()` and awaits Pixi v8's asynchronous
   `app.init()`.
3. Only after initialization does it append `app.canvas`.
4. The ticker owns the reveal loop and sampling.
5. Cleanup destroys the application, view, child display objects, textures, and
   texture sources.
6. A cancellation guard destroys a renderer that finishes asynchronous
   initialization after React has already unmounted it.

That last guard matters under React StrictMode. In a Next development run,
instrumentation recorded **2 effect mounts, 1 cleanup, and exactly 1 live
canvas** after settling. There were no page exceptions or hydration warnings.
The only console error was an unrelated missing `/favicon.ico`.

In the production SSR response:

- response body: **16,811 bytes**;
- `<canvas>` elements: **0**;
- loading fallback occurrences: **1**;
- correct route `<title>`: **1**.

Production hydration completed with one canvas and no page exception. This
confirms the desired boundary: HTML and fallback are server-safe; renderer
construction and canvas ownership are client-only.

## Reproducibility source

Install only for the experiment:

```sh
cd apps/app
bun add pixi.js@8.19.0
```

The App Router page was a server component:

```tsx
// apps/app/app/dev/pixi-spike/page.tsx
import type { Metadata } from 'next';
import { PixiSpikeMount } from './pixi-spike-mount';

export const metadata: Metadata = {
  robots: { follow: false, index: false, nocache: true },
  title: 'Pixi pack-open spike — DailyDraft',
};

export default function PixiSpikePage() {
  return (
    <main>
      <h1>Pack reveal renderer</h1>
      <PixiSpikeMount />
    </main>
  );
}
```

The client mount kept `ssr: false` below a `'use client'` boundary:

```tsx
// apps/app/app/dev/pixi-spike/pixi-spike-mount.tsx
'use client';

import dynamic from 'next/dynamic';

const PixiPackScene = dynamic(
  () => import('./pixi-pack-scene').then((module) => module.PixiPackScene),
  {
    loading: () => <div role="status">Loading renderer…</div>,
    ssr: false,
  },
);

export function PixiSpikeMount() {
  return <PixiPackScene />;
}
```

The essential Pixi bootstrap, renderer detection, cancellation-safe cleanup,
and scene loop were:

```tsx
// apps/app/app/dev/pixi-spike/pixi-pack-scene.tsx
'use client';

import {
  Application,
  Container,
  Graphics,
  RendererType,
  Text,
  TextStyle,
} from 'pixi.js';
import { useEffect, useRef, useState } from 'react';

const WIDTH = 390;
const HEIGHT = 620;
const LOOP_MS = 4_800;

export function PixiPackScene() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState('initializing');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const sceneHost = host;

    let cancelled = false;
    let destroyApp: (() => void) | undefined;

    async function mountScene() {
      const app = new Application();
      await app.init({
        antialias: true,
        autoDensity: true,
        backgroundAlpha: 0,
        height: HEIGHT,
        powerPreference: 'high-performance',
        // An array restricts the candidates and fixes their attempt order.
        preference: ['webgpu', 'webgl'],
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        width: WIDTH,
      });
      app.ticker.maxFPS = 60;

      if (cancelled) {
        app.destroy({ removeView: true }, { children: true });
        return;
      }

      const rendererName =
        app.renderer.type === RendererType.WEBGPU
          ? 'WebGPU'
          : app.renderer.type === RendererType.WEBGL
            ? 'WebGL'
            : `renderer-${String(app.renderer.type)}`;
      setRenderer(rendererName);
      sceneHost.appendChild(app.canvas);

      const background = new Graphics()
        .rect(0, 0, WIDTH, HEIGHT)
        .fill({ color: 0x05040a });
      const halo = new Graphics()
        .circle(WIDTH / 2, 300, 190)
        .fill({ alpha: 0.16, color: 0x7338ff });
      app.stage.addChild(background, halo);

      const pack = new Container();
      const packBody = new Graphics()
        .roundRect(-93, -132, 186, 264, 16)
        .fill({ color: 0x34126d })
        .stroke({ color: 0xb97cff, width: 4 });
      const packLabel = new Text({
        text: 'DAILY\nDRAFT',
        style: new TextStyle({
          align: 'center',
          fill: 0xffffff,
          fontFamily: 'Arial',
          fontSize: 22,
          fontWeight: '800',
        }),
      });
      packLabel.anchor.set(0.5);
      pack.addChild(packBody, packLabel);
      pack.position.set(WIDTH / 2, 304);
      app.stage.addChild(pack);

      const card = new Graphics()
        .roundRect(-101, -143, 202, 286, 18)
        .fill({ color: 0xf3e9ff })
        .stroke({ color: 0xd7b5ff, width: 4 });
      card.position.set(WIDTH / 2, 304);
      card.scale.set(0.2);
      card.alpha = 0;
      app.stage.addChild(card);

      const sparks = new Container();
      const particles = Array.from({ length: 96 }, (_, index) => {
        const spark = new Graphics()
          .circle(0, 0, 1.5 + (index % 4))
          .fill({ color: index % 3 === 0 ? 0xffdf63 : 0xc28bff });
        sparks.addChild(spark);
        return {
          angle: (Math.PI * 2 * index) / 96 + (index % 7) * 0.08,
          distance: 60 + ((index * 37) % 220),
          phase: ((index * 29) % 100) / 100,
          spark,
        };
      });
      sparks.position.set(WIDTH / 2, 304);
      app.stage.addChild(sparks);

      const startedAt = performance.now();
      app.ticker.add((ticker) => {
        const now = performance.now();
        const progress = ((now - startedAt) % LOOP_MS) / LOOP_MS;
        const burst = clamp((progress - 0.3) / 0.18);
        const settle = clamp((progress - 0.48) / 0.22);
        const fade = progress > 0.88 ? clamp((1 - progress) / 0.12) : 1;
        const shake =
          progress < 0.3
            ? Math.sin(progress * 120) * (1 - progress / 0.3) * 7
            : 0;

        pack.alpha =
          progress < 0.48 ? 1 : Math.max(0, 1 - (progress - 0.48) * 9);
        pack.position.x = WIDTH / 2 + shake;
        pack.rotation = shake * 0.009;

        halo.scale.set(0.85 + burst * 0.38);
        halo.alpha = 0.12 + Math.sin(now * 0.002) * 0.035 + burst * 0.12;

        card.alpha = settle * fade;
        card.scale.set(0.2 + easeOutBack(settle) * 0.8);
        card.rotation = (1 - settle) * -0.22;

        sparks.alpha = Math.sin(burst * Math.PI) * fade;
        for (const particle of particles) {
          const travel = clamp(burst * 1.8 - particle.phase * 0.34);
          particle.spark.position.set(
            Math.cos(particle.angle) * particle.distance * travel,
            Math.sin(particle.angle) * particle.distance * travel +
              70 * travel * travel,
          );
          particle.spark.alpha = 1 - travel * 0.72;
        }

        // `ticker.deltaMS` was sampled here for frame-time evidence.
        void ticker.deltaMS;
      });

      destroyApp = () =>
        app.destroy(
          { removeView: true },
          { children: true, texture: true, textureSource: true },
        );
    }

    void mountScene();
    return () => {
      cancelled = true;
      destroyApp?.();
    };
  }, []);

  return (
    <section aria-label="Pixi pack reveal benchmark">
      <div ref={hostRef} />
      <output>{renderer}</output>
    </section>
  );
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function easeOutBack(value: number) {
  const overshoot = 1.70158;
  const shifted = value - 1;
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}
```

## Renderer behavior

Pixi v8 initializes asynchronously because renderer selection may involve
requesting a WebGPU adapter. In PixiJS 8.19.0, `preference` can be a string or
an ordered array:

- a string tries that renderer first and then Pixi's remaining defaults;
- an array tries only the listed renderers, in order.

The spike used `['webgpu', 'webgl']`, deliberately excluding Pixi's Canvas
renderer. Pixi calls its WebGPU support check, dynamically loads
`WebGPURenderer` if that succeeds, then moves to its WebGL support check and
`WebGLRenderer` if it does not. The implementation is documented in Pixi's
[Application guide](https://pixijs.com/8.x/guides/components/application) and
[renderer guide](https://pixijs.com/8.x/guides/components/renderers).

### What happened on this machine

- Normal WebGPU-first run: **WebGPU selected**.
- Reported adapter: vendor `apple`, architecture `metal-3`.
- Forced negative WebGPU test (`navigator.gpu` unavailable before app code):
  **WebGL selected**, one canvas, no page exception.
- The app recorded the selected path from `app.renderer.type`; it did not infer
  the renderer from browser feature presence.

This proves both branches in the integration code. It does not prove that all
Pixi filters or future Rive/Spine assets have identical output across the two
renderers.

### Browser-support implication

| Browser/device class | Expected tier-2 path | Shipping posture |
| --- | --- | --- |
| Current supported Chromium on a modern GPU/OS | WebGPU can be offered | Cohort first; fall back on adapter/init failure |
| Safari/iOS versions with WebGPU support | WebGPU is possible | Require real iPhone/iPad visual and thermal evidence before enabling |
| Firefox/platform combinations with WebGPU support | WebGPU is possible but platform coverage varies | Capability-test; never browser-sniff |
| Older browsers, older OS/GPU, constrained webviews | WebGL/WebGL2 | Primary tier-2 compatibility renderer |
| WebGL initialization/context failure | No tier-2 canvas | Render the existing DOM/CSS holo-card treatment |

The conservative posture is intentional. MDN still marks
[WebGPU as limited availability](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API),
while [WebGL is available across modern browsers](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API).
Pixi also currently recommends WebGL for production. WebGPU is worth preserving
as an ordered first attempt for qualified clients, not worth making a reveal
unavailable.

## Measurements

Every number below came from a real build or browser run. Estimates and missing
measurements are labeled.

### Bundle cost

Method:

1. `bun install --frozen-lockfile`.
2. Production baseline: `NEXT_TELEMETRY_DISABLED=1 bun --filter @dailydraft/app build`.
3. For every emitted `apps/app/.next/static/chunks/*.js`, record raw bytes and
   gzip that file independently with `gzip -9 -c`; sum both sets.
4. Add Pixi 8.19.0 and the prototype route, rebuild.
5. Repeat for two import shapes with the same scene:
   - statically named Pixi exports inside the dynamically loaded React scene;
   - `await import('pixi.js')` followed by runtime namespace destructuring.

| Build | Raw client-chunk delta | Gzip client-chunk delta | Result |
| --- | ---: | ---: | --- |
| Dynamic route + named ESM imports | 617,702 B / **603.2 KiB** | 183,920 B / **179.6 KiB** | Candidate |
| Dynamic route + full module namespace | 770,668 B / **752.6 KiB** | 233,107 B / **227.6 KiB** | Reject |
| Named-import saving | 152,966 B / 149.4 KiB | **49,187 B / 48.0 KiB (21.1%)** | Material |

For a sanity check, the installed package's complete
`dist/pixi.min.js` was 797,792 raw bytes and 224,741 gzip bytes. That is not a
Next route delta, but its proximity to the namespace-import result confirms
that the full import defeated useful tree shaking.

The profiled production route loaded 362,884 encoded bytes of JavaScript in
total, including Next/React/shared application chunks. That network number
must not be misreported as the Pixi delta; the before/after build result above
is the attributable figure.

### Frame rate and frame pacing

Method:

- production build and production server;
- Brave headless using the Brave application binary, not Chrome;
- mobile context 390×844, DPR 2, touch enabled;
- Pixi canvas backing resolution up to DPR 2;
- DevTools CPU throttling rate **6×**;
- WebGPU selected on the Apple Metal adapter;
- ticker capped at 60;
- wait for renderer readiness, discard the first 2 half-second FPS windows and
  first 60 frame-time samples, then sample for 15 seconds;
- 29 warmed half-second FPS samples and 807 warmed frame samples.

| Metric | Measured result |
| --- | ---: |
| Mean FPS | **54.48 fps** |
| 5th-percentile FPS window | **51.64 fps** |
| 95th-percentile ticker frame time | **32.8 ms** |
| 99th-percentile ticker frame time | **34.4 ms** |
| Page exceptions | **0** |

Interpretation: the simple vector reveal remained visually fluid under a
synthetic low-end CPU profile, but it did not hold a perfect 16.7 ms frame
budget. A physical low-end GPU could be materially worse once texture uploads,
filters, authored animation, audio, and browser UI are present. This is enough
to de-risk framework integration, not enough to set a production minimum-device
claim.

The forced WebGL fallback run was a branch check at 1× CPU, not a comparable
low-end benchmark: 55.27 mean fps and 53.01 5th-percentile fps under the same
60-fps cap. Headless scheduling makes the absolute 1× figure unsuitable for a
WebGPU-versus-WebGL performance conclusion.

### Memory

Method:

- load the existing `/dev/holo-card` tier-1 reference in the same page/context;
- force V8 garbage collection through the debugging protocol and read
  `Runtime.getHeapUsage`;
- navigate to the Pixi route, run the 15-second 6× profile, force collection,
  and read again;
- navigate back to the tier-1 route, wait two seconds, force collection, and
  measure post-unmount retention.

| Heap state | Measured result |
| --- | ---: |
| Tier-1 holo-card route | **3.37 MiB** |
| Active WebGPU Pixi route | **6.64 MiB** |
| Active incremental heap | **+3.27 MiB** |
| Tier-1 after Pixi unmount | **3.56 MiB** |
| Post-unmount residual over initial tier 1 | **+0.19 MiB** |

The return close to baseline supports the canvas/application cleanup design. It
does not prove long-session leak freedom.

**Stated gap:** browser JavaScript heap metrics do not expose trustworthy
per-scene GPU allocation. GPU texture/buffer memory was **not measured**. The
prototype used vector geometry and no card textures, so estimating production
GPU memory from it would be misleading. A follow-up must use real atlases/card
art and browser/OS GPU tooling on physical mobile hardware.

## Rive versus Spine

Terms and packages were re-verified on 2026-07-26; prices are snapshots, not
contractual quotes.

| Dimension | Rive | Spine |
| --- | --- | --- |
| Authoring model | Browser-based vector design, timeline animation, state machines, responsive layout, and data binding | Desktop 2D skeletal animation centered on bones, slots, meshes, weights, constraints, mixing, and physics |
| Best fit | Interactive product motion, UI, logos, pack shells, masks, vector effects, data-driven variants | Character rigs, deformable sprite meshes, secondary motion, attachment/skin swaps, game-studio skeletal pipelines |
| Designer/developer contract | State machines and data-bound view models are designed as an explicit handoff contract; real-time collaboration is available on team plans | Exported skeleton/atlas data plus named animations, skins, and runtime tracks; disciplined version synchronization between editor and runtime |
| Pixi integration | Separate Rive JS/WASM renderer; can be driven from a custom loop, but is not a native Pixi display-object plugin | Official `spine-pixi-v8` installs loaders and render pipes directly into Pixi WebGPU, WebGL, and Canvas |
| Web runtime | `canvas-lite`, Canvas, or recommended WebGL2 runtime; WASM is a separate fetch unless self-hosted/bundled | TypeScript runtime layered directly on Pixi; atlas and skeleton assets are additional |
| Runtime size | Vendor-reported Brotli-9 WASM: **222 KB** `canvas-lite`, **567 KB** Canvas, **648 KB** WebGL2; JS and `.riv` assets are additional | Measured official `spine-pixi-v8@4.3.13` minified IIFE: **232,581 B raw, 67,219 B gzip-9, 62,410 B Brotli-9**; Pixi and atlas/skeleton assets are additional |
| Runtime license | Official runtimes are open source, **MIT**, allowed for personal and commercial applications | Source-available custom Spine Runtimes License; integration requires the applicable editor license, and the notice must travel with the product |
| Editor cost | Free for learning, but production `.riv` export requires a paid plan. Cadet is **$9/seat/month billed annually ($108/year)** or **$17 monthly**; Voyager is **$32/seat/month annually ($384/year)** or **$49 monthly** | Current purchase page: Essential **$69** and Professional **$379** promotional one-time prices per named user (listed as $99/$449); businesses at **$500,000+** annual revenue/funding require Enterprise at **$2,499 base + $379/user/year** |
| SDK/distribution risk | Low runtime-license friction for an external SDK because MIT permits redistribution/modification | High enough to require counsel: third parties modifying a product/SDK containing the runtime may need their own editor license; the runtime is not FOSS |
| Pack/card reveal fit | Strong: vector masks, foil motion, responsive artboards, named reveal states, and designer-owned iteration map directly to the content | Adequate but specialized: excellent if the pack has a rigged mascot or deforming illustrated character; ordinary wrappers/cards underuse the skeletal model |

Runtime-size sources:

- Rive's [runtime-size table](https://rive.app/docs/runtimes/runtime-sizes)
  reports Brotli-9 WASM sizes and identifies WASM as the majority of runtime
  weight.
- The Spine figure was measured from the official npm/unpkg artifact linked by
  the [maintained `spine-pixi-v8` documentation](https://esotericsoftware.com/spine-pixi):
  `@esotericsoftware/spine-pixi-v8@4.3.13/dist/iife/spine-pixi-v8.min.js`,
  SHA-256
  `1cebcaead81b5d990b4d1634019f753d240d22fb94961ca3bffed824618dc7b1`.
- Rive recommends WebGL2 for quality/performance and Canvas/`canvas-lite` for
  smaller or simpler work in its
  [renderer comparison](https://rive.app/docs/runtimes/web/canvas-vs-webgl).

Licensing/cost sources:

- Rive's [current pricing page](https://rive.app/pricing) and
  [billing-period table](https://rive.app/docs/account-admin/pricing).
- Rive's [runtime licensing guide](https://rive.app/docs/runtimes/getting-started)
  explicitly states MIT and commercial use.
- Spine's [purchase page](https://esotericsoftware.com/spine-purchase),
  [Runtimes License](https://esotericsoftware.com/spine-runtimes-license), and
  [Editor License §2](https://esotericsoftware.com/spine-editor-license#s2).

Workflow sources:

- Rive's [state-machine guide](https://rive.app/docs/editor/state-machine/state-machine)
  and [data-binding guide](https://rive.app/docs/editor/data-binding/overview)
  describe the designer/developer contract.
- Spine's [Pixi runtime guide](https://esotericsoftware.com/spine-pixi) confirms
  maintained Pixi 8 integration across WebGPU/WebGL/Canvas and full Spine
  feature support.

### Why Rive wins this use case despite its larger runtime

Pack reveal work is primarily authored vector/product motion rather than
skeletal character animation. Rive lets design own named states and
data-bound variants, its runtime license does not encumber an eventual public
SDK, and Cadet is cheap enough for the current team shape.

The size penalty is real: even `canvas-lite`'s vendor-reported 222 KB Brotli
WASM is larger than this spike's 179.6 KiB gzip Pixi build delta. That is why
Rive must be theme-scoped and lazy-loaded, not part of the lobby or base app
shell. The first production asset should prove that a small Rive canvas can be
composited with Pixi without loading the 648 KB WebGL2 runtime. If it cannot,
Spine's 60.9 KiB Brotli add-on and native Pixi pipe become materially more
attractive.

## Quality tiers and degradation

The runtime should choose a quality policy once per reveal, then step down
without changing the committed game result. Rarity and result data remain
presentation-only inputs.

| Quality | Eligibility | Rendering treatment |
| --- | --- | --- |
| Ultra | Qualified desktop cohort, WebGPU adapter succeeds, no reduced-motion/data-saver request, healthy warm-up telemetry | WebGPU; DPR up to 2; 60 fps; full particles/rays; authored Rive pack; bounded post-processing; stereo sound where allowed |
| Standard | Broad modern desktop/mobile with WebGL2 and stable frame pacing | WebGL; DPR 1.5–2; 60 fps target; half particle count; no expensive full-screen filter; lazy authored asset |
| Lite | Slow warm-up, 2–4 logical cores, low device-memory signal, data saver, thermal/frame degradation, or WebGL1-only path | DPR 1; 30 fps; 12–24 pooled particles; static authored-asset frame or code-only pack/card tween; no blur/bloom |
| Baseline | Renderer init failure, context loss, repeated slow frames, unsupported browser/webview, reduced-motion policy requiring minimal motion | Existing `apps/app/app/components/holo-card/` DOM/CSS card; short opacity/scale reveal or immediate state; no canvas |

Recommended gates:

1. Respect `prefers-reduced-motion` before renderer initialization. Do not
   replace required result information with animation; show the card/result
   immediately with a restrained crossfade.
2. Treat `navigator.connection.saveData`, `navigator.deviceMemory`, and
   `navigator.hardwareConcurrency` as hints, never as sole allow/deny checks.
3. Sample the first two seconds. Two consecutive windows below 45 fps or a
   95th-percentile frame time above 33 ms move down one quality level.
4. Cap resolution before removing semantic content: 2 → 1.5 → 1 DPR.
5. Reduce pooled particles and filters next; keep the reveal duration and
   result timing stable.
6. On renderer initialization error, `webglcontextlost`, WebGPU device loss, or
   a second failed recovery, destroy the canvas and mount tier 1. Never leave a
   blank reveal.
7. Cache the chosen quality for the session but permit downward movement after
   thermal or frame-pressure evidence. Do not automatically promote mid-reveal.
8. Lazy-load Pixi/Rive only on entry to the reveal. Lobby cards, history, and
   result receipts stay DOM.

Audio and haptics degrade independently: muted/autoplay-blocked audio and
unsupported vibration must not change visual timing or completion. Assistive
technology receives the result through DOM live/status content outside the
canvas.

## Risks and open questions

### Must answer before a production tier-2 rollout

1. **Physical low-end device profile.** Repeat on at least one Android Go/class
   device and an older supported iPhone, including 60-second thermal soak,
   battery/energy view, Safari/Chrome, background/resume, and orientation
   changes.
2. **Real assets and GPU memory.** Replace vectors with representative card
   textures, compressed atlases, masks, and filters. Measure upload stalls,
   decoded image memory, GPU allocation, context loss, and post-unmount release.
3. **Rive composition spike.** Author the same 3–5 second pack shell in a real
   `.riv`, run `canvas-lite` beside/over Pixi, verify transparent composition,
   pointer behavior, DPR scaling, state-machine/data-binding control, CSP, and
   exact incremental network/heap cost.
4. **WebGPU parity.** Golden-image and timing comparison across WebGPU and
   WebGL on Chromium, Safari/iOS, and Firefox; specifically test blend modes,
   masks, filters, color space, device loss, and screenshots.
5. **Accessibility contract.** Define the DOM result announcement, skip/fast
   reveal control, reduced-motion storyboard, focus behavior, and canvas
   alternative before the scene can carry real outcomes.

### Pipeline/product questions

- Can designers keep a `canvas-lite`-compatible Rive asset, or do typography,
  layout, audio, scripting, or vector-feathering requirements force the much
  larger Canvas/WebGL2 runtime?
- Should Rive WASM be self-hosted and preloaded only on reveal intent? The
  runtime otherwise fetches WASM separately; CSP may need `wasm-unsafe-eval`.
- What is the maximum theme-pack asset budget for first view and for cached
  view? Runtime and authored file budgets need separate gates.
- Does the future external SDK expose authored assets only, or permit consumers
  to modify the runtime integration? This is low-risk under Rive MIT and a
  material Spine licensing boundary.
- Does a future theme roadmap include rigged mascots/characters? If yes, run a
  bounded Spine trial for that theme rather than forcing character work through
  Rive.
- How is visual telemetry sampled without collecting device fingerprinting
  data? Only coarse quality decisions and anonymous frame/context-loss events
  should leave the client.

## Evidence limits

- The prototype proved Next.js/React lifecycle compatibility, production build
  integration, WebGPU selection, WebGL fallback, and a simple scene's
  CPU-throttled behavior. It did not validate production art.
- The CPU throttle is real DevTools emulation; the GPU remained the M1 Max.
  Numbers must not be marketed as “Moto G Power measured.”
- JavaScript heap was measured after forced GC. GPU memory was unavailable and
  is explicitly not estimated.
- Frame results came from headless Brave to make the run repeatable. A headed
  browser and physical display/browser compositor can schedule differently.
- The Rive runtime sizes are vendor-reported Brotli-9 WASM sizes. The Spine
  size is a locally reproduced compression of its official minified IIFE.
  Neither includes authored asset files, and Rive's number excludes its JS
  wrapper.
- Pricing and license summaries are implementation-planning notes, not legal
  advice. Spine's SDK/distribution boundary needs counsel before adoption.
- The prototype source, `pixi.js` dependency, package manifest changes, and
  lockfile changes were intentionally removed. Only this memo is retained so
  changed-code coverage is not spent on throwaway code.
