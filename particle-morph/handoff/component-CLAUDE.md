# particle-morph: notes for Claude Code

This folder is a finished, self-contained WebGL component (Three.js + GPU particle simulation).
Treat it as a vendored library: **integrate it, don't rewrite it.** The visual settings in `config.js` were
tuned and approved by the site owner. Do not change them, and do not pass them again from the site code.

## Dependencies (exact versions)

`three@0.187.0`, `three-mesh-bvh@0.9.18`, `gsap@3.15.1` (gsap is only needed by `ScrollController.js`).
ES modules with bare imports (`three`, `three/examples/jsm/...`, `three-mesh-bvh`, `gsap`, `gsap/ScrollTrigger`).
On a site without a bundler, map them with an import map (see `examples/vanilla/index.html` in the handoff package).

## Assets

Five `.glb` files (~30 MB total) are expected at `<base>models/<file>.glb`.
`SHOWCASE_MODELS(base)` builds the model list, so with files in `public/models/` call `SHOWCASE_MODELS('/')`.
The files are `chess_knight_protector.glb`, `adjustable_pull-up_dip_station.glb`, `katana_with_sheath.glb`,
`arturia_keylab_88_mk2.glb` and `macbook_pro_14_m5.glb`. Order = morph order. Don't rename or recompress them
without checking visually: a simplify/quantize pass damaged the knight's shape in testing.

## Minimal integration

```js
import { ParticleMorphScene, SHOWCASE_MODELS } from './particle-morph/index.js';
import { ScrollController } from './particle-morph/ScrollController.js';

const scene = new ParticleMorphScene(stageEl, {
  models: SHOWCASE_MODELS('/'),
  cssBlendTarget: 'container', // stageEl is position: sticky → blend the stage itself (see below)
});
await scene.load(); // download + ~3–4 s of synchronous point-cloud generation
const scroll = new ScrollController({
  trigger: sectionEl, start: 'top top', end: 'bottom bottom', scrub: 0.8,
  onUpdate: (p) => scene.setMorphProgress(p),
});
// unmount (SPA): scroll.dispose(); scene.dispose();
```

Markup: `sectionEl` is tall (900vh ≈ two screens per transition). `stageEl` is inside it with
`position: sticky; top: 0; height: 100vh`. The component fills `stageEl` and follows its size (ResizeObserver).

## API

- `new ParticleMorphScene(container, config)` creates the canvas inside `container`.
- `await scene.load()` loads the models and starts the render loop.
- `scene.setMorphProgress(p)`: 0 = knight, 0.25 = pull-up station, 0.5 = katana, 0.75 = piano, 1 = MacBook. Smoothed internally.
- `scene.progressForModel(i)`, `scene.activeModel`, `scene.modelCount` are helpers for "jump to" UI.
- `scene.start()` / `scene.stop()` resume or pause the loop. Pause when the section is off-screen.
- `scene.updateConfig(patch)` changes settings live (only for things like `interactionEnabled`; don't retune the look).
- `scene.dispose()` frees GPU memory, removes listeners and the canvas. Required on unmount.
- `scroll.refresh()` recomputes scroll positions after layout changes above the section (fonts, images, accordions).

## Pitfalls

1. **Blend mode / invisible particles.** Particles are white, and CSS `mix-blend-mode: difference` turns them black on the
   white page. `mix-blend-mode` only blends inside the element's stacking context. With `cssBlendTarget: 'container'`
   the blend is applied to `stageEl`, which works for a sticky or fixed stage. **Ancestors of `stageEl` must not create a
   stacking context**: no `transform`, `filter`, `opacity < 1`, `isolation: isolate`, `will-change`, `contain: paint`, or
   `z-index` on a positioned element. Otherwise the particles become white on white, i.e. invisible.
   - Fallback when that can't be avoided: `blendMode: 'shader'` plus `background: '<page colour>'`. This renders an opaque
     canvas with the same look on a solid background, but it no longer inverts content behind it.
2. **White background assumed.** On a non-white background the colours invert (difference blending).
3. **One instance per page.** Each instance holds ~10 MB of GPU memory and its own render loop.
4. **SSR.** Client-only. In Next.js use `'use client'` and import the module dynamically inside `useEffect`.
   React StrictMode double-mounting is safe if cleanup calls `dispose()` (load() aborts after dispose).
5. **Smooth-scroll libraries** (Lenis, Locomotive): ScrollTrigger must be updated from them
   (`lenis.on('scroll', ScrollTrigger.update)`), or call `scene.setMorphProgress()` from your own scroll handler and skip `ScrollController`.
6. **Main-thread pause after download.** `load()` blocks for ~3–4 s while sampling five meshes. Start loading before
   the section is visible (IntersectionObserver with a generous rootMargin), not on first paint.
7. **CSP.** If the site sets a Content-Security-Policy, it must allow the model URLs in `connect-src`, and `blob:` in `img-src`
   (embedded textures). No `unsafe-eval` is needed.
8. **Touch devices.** There is no hover, so look-at and dispersion simply don't trigger; scrolling works. The canvas uses
   `touch-action: pan-y`. The prototype was tuned for desktop. On weak devices consider `particleCount: 20000` (same look, sparser).

## Files (do not edit unless asked)

`ParticleMorphScene.js` (entry, API) · `config.js` (approved settings + `SHOWCASE_MODELS`) · `ModelLoader.js` ·
`PointCloudGenerator.js` · `ParticleMorphSystem.js` · `ParticleSimulation.js` · `ParticleRenderer.js` ·
`CursorInteraction.js` · `ScrollController.js` (GSAP adapter, optional) · `shaders/`.
