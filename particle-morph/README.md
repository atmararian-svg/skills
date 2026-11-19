# Particle Morph: Knight ⇄ Katana

A standalone prototype that rebuilds two GLB models from ~40,000 particles.
ONE persistent GPU particle system morphs between them on scroll.
The formation follows the cursor, and particles break apart locally around the cursor and re-form afterwards.

This is the 3D system only. The demo page is a test harness: a white page, a scroll track and a small dev panel.

## Run locally

```bash
cd particle-morph
npm install
npm run dev        # http://localhost:5173
```

Production build: `npm run build`, output in `dist/`. Serve `dist/` with any static server, for example `npx vite preview`.

Demo URL options:
- `?blend=shader` uses in-canvas difference blending instead of the CSS blend.
- `?count=60000` sets the particle count.
- `?nogui` hides the dev panel.

Scroll to morph. Move the mouse to steer the formation. Hover the object to break it apart.

## Dependencies

| package | version | role |
|---|---|---|
| `three` | 0.187.0 | rendering, `GLTFLoader`, `GPUComputationRenderer` |
| `three-mesh-bvh` | 0.9.18 | BVH-accelerated `Raycaster` against the 460k-triangle proxy |
| `gsap` (+ ScrollTrigger) | 3.15.1 | scroll → morph progress (only in `ScrollController.js`) |
| `vite` (dev) | 8.3.8 | dev server / build |
| `lil-gui` (dev) | 0.21.0 | demo dev controls only |

Requires WebGL2 with float render targets. All current desktop browsers have this.

## Project structure

```
particle-morph/
├─ index.html                     demo harness (white page, scroll track)
├─ public/models/                 the two original GLB files
├─ src/demo/main.js               demo wiring: scroll + lil-gui (NOT part of the component)
└─ src/particle-morph/            ← the reusable component, copy this folder
   ├─ index.js                    public exports
   ├─ ParticleMorphScene.js       entry point: renderer, camera, loop, resize, public API
   ├─ config.js                   DEFAULT_CONFIG + asset preset for the two GLBs
   ├─ ModelLoader.js              GLB → one merged, oriented, normalised geometry
   ├─ PointCloudGenerator.js      area-uniform + blue-noise surface sampling
   ├─ ParticleMorphSystem.js      A↔B correspondence, static target textures, morph uniforms
   ├─ ParticleSimulation.js       GPU physics (GPUComputationRenderer, position + velocity)
   ├─ CursorInteraction.js        look-at spring, Raycaster hover on invisible BVH proxies
   ├─ ParticleRenderer.js         single THREE.Points draw call, blending
   ├─ ScrollController.js         optional GSAP ScrollTrigger adapter
   └─ shaders/                    chunks.js (noise, morph, pointer), simulation.js, render.js
```

## Architecture

```
GLB ─▶ ModelLoader ─▶ PointCloudGenerator ─▶ ParticleMorphSystem ─▶ ParticleSimulation ─▶ ParticleRenderer
        (merge,          (N points per         (pairing + static       (GPU: velocity &        (Points, reads
         orient,          model, blue-noise)    float textures)         position textures)      position tex)
         normalise)                                      ▲                       ▲
                                     ScrollController ──▶ setMorphProgress   CursorInteraction (hit point,
                                     (or any host code)                       velocity, look-at rotation)
```

**Model preparation (`ModelLoader`).** Every mesh's world transform is baked in, and everything is merged into one indexed geometry (position and normal only). Materials and textures are discarded.
- The geometry is then rotated by `orient` and centred.
- It is scaled uniformly so the `fitAxis` dimension equals `fitSize`, which keeps the original proportions.

What the two models are:
- **Knight:** 5 mesh chunks, ~460k triangles. It is an armoured knight figure (helmet, cape, shield, sword) on a round base, not a horse head. It is turned 205° to show a three-quarter front view.
- **Katana:** 12 meshes. It lies along +Z in the file, with the blade and sheath side by side. It is turned to face the camera and tilted 32° to sit diagonally.

**Point clouds (`PointCloudGenerator`).**
1. Stratified sampling weighted by triangle area creates 3× the needed candidates.
2. Weighted Sample Elimination (Yuksel 2015) thins them to exactly N. This gives an even, blue-noise distribution: no clumps, no holes, and small parts keep points in proportion to their area.
3. A small jitter along the normal and tangent adds the stippled grain.

Both models get the same N.

**Correspondence (`ParticleMorphSystem.matchPointSets`).** This is recursive balanced bisection, a fast approximation of optimal transport.
- Both clouds are split at their own median along the same axis, and the halves are paired recursively.
- A local 2-opt pass then swaps partners between nearby pairs when that shortens travel.
- Neighbourhoods map to neighbourhoods, so particles flow in coherent streams. It takes about 110 ms for 40k points.

The pairs, both normal sets and per-particle metadata go into static float textures once. Nothing is uploaded per frame.

**Morph (GLSL `morphTarget`).** Each particle has a delay: a wave from the top of the knight, plus noise. Its local progress `t = clamp((p − delay·spread)/(1 − spread))` is eased with in-out cubic.

The target is `mix(A, B, e)`, plus two effects that peak mid-flight (`sin(πe)`):
- an outward bulge with a random direction,
- a swirl around the vertical axis.

On top of that, the flow noise gets stronger while a particle is travelling. So the object dissolves, swirls and re-forms rather than cross-fading. The function depends only on `p`, so scrolling back reverses it exactly.

**Simulation (`ParticleSimulation`, GPU).** Two fragment-shader passes per fixed 1/120 s step (semi-implicit Euler):
- **Spring** to the *current* morph target. It is underdamped (`springDamping` ≈ 0.55), so there is overshoot and settling.
- **Flow noise** from simplex noise: ambient drift, stronger in flight and when disturbed.
- **Cursor force:** radial push in a noisy direction, plus a push along the cursor's velocity, plus noise. The radius and strength vary per particle so the edge looks ragged.
- **Exponential damping.**

`position.w` stores **heat**. The cursor sets it and it decays at a rate set by `recoverySpeed`. Hot particles get a softer spring and less damping. So dispersed particles keep their momentum (a trail), then pull smoothly back as they cool.

Morph target, cursor force, velocity and global rotation are independent. Hovering during a morph only affects the particles near the cursor. Released particles always return to whatever the morph target is *now*. The simulation never resets on a model switch.

**Interaction (`CursorInteraction`).**
- **Look At:** the cursor position (in normalised device coordinates) sets a target pitch/yaw, limited by `lookAtIntensity`. A damped spring with inertia follows it. The rotation is applied to the formation group, not the particles.
- **Hover:** `Raycaster` (`firstHitOnly`) against two invisible proxy meshes built from the same normalised geometry, with a BVH (about 0.05 ms per ray on 460k triangles).
  - Each proxy is used only while its model is visibly present (weight > 0.2). Mid-morph, the closest hit wins.
  - The hit is converted into the formation's local space and lightly smoothed. Its velocity drives the directional force.
  - The strength fades in and out so nothing pops.

**Rendering (`ParticleRenderer`).** One `THREE.Points` draw call. The vertex shader reads positions from the simulation texture. Shading comes from the per-particle normal, mixed between A and B:
- light direction and backface fade,
- depth cue and skewed per-particle size and alpha,
- heated particles shrink and fade slightly.

Particles output premultiplied white "ink".

### Difference blending: what was tested

Tested in headless Chromium (screenshots at each stage of development):

- `blendMode: 'css'` (default): transparent canvas, white particles blended additively, `mix-blend-mode: difference`. On a white page this gives black particles; denser regions get darker until they saturate to black. **Works.**
  - Caveat: `mix-blend-mode` only blends with content *inside the same stacking context*. If the canvas sits inside a `position: fixed`/`sticky`, `transform`, `opacity < 1`, `isolation: isolate`, `z-index` etc. container, it blends with that container's transparent backdrop and the particles become invisible white-on-white.
  - The fix: put the blend on the container. `cssBlendTarget: 'container'` does this, and the demo uses it because its stage is `position: fixed`.
- `blendMode: 'shader'`: opaque canvas filled with `background`. On a light background the ink is subtracted (`ReverseSubtractEquation`); on a dark one it is added. This is exactly `|bg − ink|`, i.e. difference against a solid colour. It does not depend on CSS or stacking contexts, but it cannot invert other page content behind the canvas. **Works.**

## Integrating `ParticleMorphScene` into a website

Copy `src/particle-morph/` into the site and the GLBs into its static assets. Install `three` and `three-mesh-bvh` (plus `gsap` only if you use `ScrollController`).

```html
<section id="morph-section" style="height: 300vh">
  <div id="morph-stage" style="position: sticky; top: 0; height: 100vh"></div>
</section>
```

```js
import { ParticleMorphScene, KNIGHT_KATANA_MODELS } from './particle-morph/index.js';
import { ScrollController } from './particle-morph/ScrollController.js';

const stage = document.getElementById('morph-stage');
const scene = new ParticleMorphScene(stage, {
  models: KNIGHT_KATANA_MODELS('/assets/'),   // or your own [{url, fitSize, fitAxis, orient}, …]
  cssBlendTarget: 'container',               // stage is sticky → blend the stage itself
  particleCount: 40000,
});
await scene.load();

const scroll = new ScrollController({
  trigger: '#morph-section', start: 'top top', end: 'bottom bottom', scrub: 0.8,
  onUpdate: (p) => scene.setMorphProgress(p),
});

// on route change / unmount
scroll.dispose();
scene.dispose();
```

### API

| method | description |
|---|---|
| `new ParticleMorphScene(container, config)` | creates renderer and canvas inside `container` (fills it; size comes from the container) |
| `await scene.load(models?, {onProgress})` | loads both GLBs, samples, matches, builds the GPU system, starts the loop (`autoStart`) |
| `scene.setMorphProgress(p, {immediate})` | 0 = model A … 1 = model B; smoothed by `morphSmoothing` unless `immediate` |
| `scene.morphProgress` | current smoothed progress |
| `scene.setPointer(clientX, clientY)` / `clearPointer()` | manual cursor input (with `autoPointer: false`) |
| `scene.updateConfig(patch)` | live parameter changes; `particleCount` / `sampling` rebuild the system |
| `scene.resize()` | automatic via `ResizeObserver`; call it if you resize without the DOM noticing |
| `scene.start()` / `stop()` / `update(dt)` / `render()` | own the loop yourself with `autoStart: false` (for example inside an existing rAF/GSAP ticker) |
| `scene.dispose()` | stops the loop, removes listeners, frees GPU resources and removes the canvas |
| `scene.stats` | `{fps, particles, loadMs, sampleMs, matchMs, meanTravel, hovering}` |

React/Vue: create the scene in `useEffect`/`onMounted` and call `dispose()` in the cleanup.

## Configuration

All values live in `DEFAULT_CONFIG` (`src/particle-morph/config.js`).

| parameter | default | effect |
|---|---|---|
| `particleCount` | 40000 | particles per model (one shared system). Rebuilds on change |
| `particleSize` | 1.6 | point diameter in CSS px at the reference camera distance |
| `sizeVariation` | 0.7 | per-particle size spread (most fine, a few larger) |
| `opacity` | 0.85 | ink per particle |
| `shading` | 0.55 | normal-based tonal shading (sculptural read) |
| `backfaceFade` | 0.6 | dims particles on surfaces facing away (less see-through clutter) |
| `sampling.oversample` | 3 | blue-noise candidate factor (1 = plain random sampling, faster load) |
| `sampling.jitter` | 0.004 | surface irregularity / grain thickness (world units) |
| `morphProgress` | 0 | initial progress |
| `morphSmoothing` | 6 | how fast internal progress follows `setMorphProgress` (1/s) |
| `morphSpread` | 0.45 | stagger of the travelling wave (0 = all particles together) |
| `morphScatter` | 0.32 | outward bulge mid-flight |
| `morphTwist` | 0.7 | swirl mid-flight (radians, sign sets direction) |
| `morphNoise` | 1.0 | extra flow noise while in flight |
| `recoverySpeed` | 0.8 | spring stiffness and heat decay: how fast disturbed particles re-form |
| `springDamping` | 0.55 | spring damping ratio (< 1 overshoots, ≥ 1 no overshoot) |
| `noiseIntensity` | 0.2 | ambient organic drift |
| `noiseScale` | 1.6 | spatial frequency of the flow noise |
| `interactionRadius` | 0.22 | cursor radius as a fraction of the current model's height |
| `repulsionStrength` | 1.0 | radial push |
| `directionalStrength` | 0.8 | push along the cursor's motion (the trail) |
| `interactionEnabled` | true | hover dispersion on/off |
| `lookAtIntensity` | 0.15 | max rotation (rad) at the viewport edge |
| `lookAtStiffness` / `lookAtDamping` | 10 / 0.75 | look-at spring: snappiness / inertia |
| `blendMode` | `'css'` | `'css'` (mix-blend-mode difference) or `'shader'` (in-canvas difference on `background`) |
| `cssBlendTarget` | `'canvas'` | element that gets `mix-blend-mode`: `'canvas'` or `'container'` |
| `background` | `#ffffff` | background colour for `blendMode: 'shader'` |
| `maxPixelRatio` | 2 | DPR cap |
| `cameraFov` / `cameraDistance` | 35 / 6.5 | camera |
| `fitRadius` | 2.0 | camera backs off on narrow viewports to keep this radius in frame |
| `autoStart` / `autoPointer` | true / true | internal rAF loop / window pointer listeners |
| `simulationHz` / `maxSubsteps` | 120 / 4 | fixed physics step rate / catch-up limit |
| `models` | `[]` | `[{url, fitSize, fitAxis: 'x'\|'y'\|'z'\|'max', orient: [[axis, deg], …]}, …]` (exactly 2) |

## Performance notes

- Per frame the CPU writes only about 15 uniforms and does one or two BVH raycasts. All per-particle work happens on the GPU: two 200×200 compute passes per substep, plus one draw call.
- Tested in headless Chromium on **software** rendering (SwiftShader, no GPU), where the live loop ran at ~30 fps with 40k particles. A desktop GPU should hold 60 fps with a large margin; profile on target hardware.
- Load-time CPU work for 40k particles (two models): GLB parse ~0.3 s, sampling ~1.3 s, matching ~0.1 s, BVH build ~0.3 s. Sampling time grows with `particleCount × oversample`.
  - To shorten it, lower `sampling.oversample` to 2, or move `samplePointCloud` + `matchPointSets` into a Web Worker. Both are pure functions on typed arrays.
  - Another option is to pre-bake the results to a binary file at build time.

## Assets

`public/models/` holds the two GLB files as supplied. They are Sketchfab downloads under the Sketchfab Standard licence: "Chess Knight Protector" by mmtpagels and "katana with sheath" by cold607. Check the licence terms before using them in production.
