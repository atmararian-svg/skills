# Particle Morph: five-model particle sculpture

A standalone prototype that rebuilds five GLB models from 40,000 particles.
ONE persistent GPU particle system morphs through them on scroll:

**Chess Knight → Pull-up Station → Katana → Piano → MacBook**
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
The dev panel's "jump to model" list scrolls to any of the five states.

### The five model states

| # | model | file | scroll progress |
|---|---|---|---|
| 1 | Chess Knight | `chess_knight_protector.glb` | 0 % |
| 2 | Pull-up Station | `adjustable_pull-up_dip_station.glb` | 25 % |
| 3 | Katana | `katana_with_sheath.glb` | 50 % |
| 4 | Piano (Arturia KeyLab 88 MkII) | `arturia_keylab_88_mk2.glb` | 75 % |
| 5 | MacBook Pro 14" | `macbook_pro_14_m5.glb` | 100 % |

The transitions fill the intervals between those points. `morphHold` (default 0.1) keeps each model fully formed for the first and last 10 % of every interval. So a model is fully formed from 22.5–27.5 % (and 0–2.5 %, 97.5–100 % at the ends) and morphs in between. The demo scroll track is 900vh tall, about two screen heights per transition.

## Testing

```bash
npm run dev          # terminal 1
npm run test:e2e     # terminal 2 (needs Chromium for Playwright: npx playwright install chromium)
```

`tests/verify.mjs` drives the real demo in headless Chromium using software GL, so it needs no GPU. It steps the simulation with a fixed time step and reads the particle positions back from the GPU. It checks:

- each of the five models forms (mean distance to its target < 0.01 units; the grain jitter alone is ~0.0025)
- the full sequence forward and reverse: no NaN or lost particles, and no position jump when crossing a model boundary (the per-frame step there is compared with the rest of the scroll)
- hover dispersion and look-at on every model and halfway through every transition
- reconstruction to the active model after the cursor leaves
- hovering *during* each of the four transitions, then leaving: the new model forms
- rapid scroll direction changes: the simulation stays stable and settles
- no console errors

It saves a screenshot of every model and of every transition at 25/50/75 % to `tests/output/`.

## Handoff package for the site developer

```bash
npm run handoff   # → handoff-dist/particle-morph-handoff.zip
```

Assembles the component, models, Russian integration docs, a ready-to-paste Claude Code prompt, a `CLAUDE.md` for the component folder, and tested vanilla-HTML and React/Next.js examples (sources in `handoff/`).

## Dependencies

| package | version | role |
|---|---|---|
| `three` | 0.187.0 | rendering, `GLTFLoader`, `GPUComputationRenderer` |
| `three-mesh-bvh` | 0.9.18 | BVH-accelerated `Raycaster` against the 460k-triangle proxy |
| `gsap` (+ ScrollTrigger) | 3.15.1 | scroll → morph progress (only in `ScrollController.js`) |
| `vite` (dev) | 8.3.8 | dev server / build |
| `lil-gui` (dev) | 0.21.0 | demo dev controls only |
| `playwright` (dev) | 1.63.0 | `npm run test:e2e` only |

Requires WebGL2 with float render targets. All current desktop browsers have this.

## Project structure

```
particle-morph/
├─ index.html                     demo harness (white page, scroll track)
├─ public/models/                 the five GLB files (textures are embedded in the GLBs)
├─ tests/verify.mjs               end-to-end browser test (npm run test:e2e)
├─ src/demo/main.js               demo wiring: scroll + lil-gui (NOT part of the component)
└─ src/particle-morph/            ← the reusable component, copy this folder
   ├─ index.js                    public exports
   ├─ ParticleMorphScene.js       entry point: renderer, camera, loop, resize, public API
   ├─ config.js                   DEFAULT_CONFIG + SHOWCASE_MODELS preset (the five GLBs)
   ├─ ModelLoader.js              GLB → one merged, oriented, normalised geometry
   ├─ PointCloudGenerator.js      area-uniform + blue-noise surface sampling
   ├─ ParticleMorphSystem.js      correspondence chain, N static target textures, morph uniforms
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

What the five models are and how each is normalised (`SHOWCASE_MODELS` in `config.js`):

| model | source | normalisation |
|---|---|---|
| Chess Knight | 5 mesh chunks, ~460k triangles. An armoured knight figure on a round base, not a horse head | height 2.35, turned 205° for a three-quarter front view |
| Pull-up Station | 1 mesh, ~37k triangles, Y-up | height 2.4, turned −15° |
| Katana | 12 meshes, lies along +Z with blade and sheath side by side | length 3.5, turned to face the camera, tilted 32° diagonally |
| Piano | 5 primitives, only ~1.4k triangles: the keys are in the texture, not the geometry | width 3.5, turned −18° and tilted 48° toward the camera so the keyboard is visible |
| MacBook | 44 meshes, ~164k triangles, 28 materials | width 2.9, turned −32° and tilted 24° for a three-quarter view of keyboard and screen |

The piano and the MacBook were supplied as ZIP archives. Each contains a `source/*.glb` with all textures already embedded, plus a loose `textures/` folder that duplicates them. Only the GLB is shipped and loaded, so no texture is downloaded twice.

The wide, flat objects (piano, MacBook) use the width as the fitting dimension. The camera keeps `fitRadius` in frame on narrow viewports.

**Surface tone (piano, MacBook).** A model with `textureInk` > 0 gives each sampled point a tone. The tone is the material colour × the base-colour texture brightness (or an emissive texture, such as the MacBook screen), sampled at the point's UV.
- The renderer turns tone into ink: dark keys, the keyboard and the screen get denser ink; white keys and the aluminium get lighter ink.
- Tone is normalised per model, so only the contrast changes, not the overall density.
- `inkGain` raises ink per particle for models with large face-on surfaces, which would otherwise look sparser with the same particle count.
- Particle count, size and distribution stay identical for all models. The knight and katana have neither setting, so they render exactly as before.
- Tone is stored in the `w` channel of the normal textures and blends smoothly during morphs.

**Point clouds (`PointCloudGenerator`).**
1. Stratified sampling weighted by triangle area creates 3× the needed candidates.
2. Weighted Sample Elimination (Yuksel 2015) thins them to exactly N. This gives an even, blue-noise distribution: no clumps, no holes, and small parts keep points in proportion to their area.
3. A small jitter along the normal and tangent adds the stippled grain.

All five models get the same N (40,000).

**Correspondence (`ParticleMorphSystem.matchPointSets`).** This is recursive balanced bisection, a fast approximation of optimal transport.
With five models it runs as a **chain**: model 2 is matched to model 1, model 3 to the re-ordered model 2, and so on. Each particle index therefore has a target in all five models, and every consecutive pair (the only pairs that are ever interpolated) has its own coherent mapping.
- Both clouds are split at their own median along the same axis, and the halves are paired recursively.
- A local 2-opt pass then swaps partners between nearby pairs when that shortens travel.
- Neighbourhoods map to neighbourhoods, so particles flow in coherent streams. It takes about 110 ms for 40k points.

All five target sets and normal sets go into static float textures once (5 × 2 textures of 200×200 RGBA float, ~6.4 MB of GPU memory). So does one metadata texture per transition: the delay wave starts from the top of that transition's source model. Nothing is uploaded per frame.

**N models, same shaders.** The morph and simulation shaders are unchanged; the render shader only gained the surface-tone factor. They still see two targets, A and B. For a sequence position `P` (0…4), `setSequence(P)` binds A = model ⌊P⌋ and B = model ⌊P⌋+1 and sets the local progress to `P − ⌊P⌋`. That is a texture-reference swap, not an upload.
- At every integer `P` each particle's eased local progress is exactly 0 or 1 and the mid-flight bulge and swirl are 0, so the swap at a boundary is seamless.
- The test confirms this: the largest per-frame particle step at the boundaries is no bigger than in the middle of a transition.
- The spring always pulls toward the target of the *current* segment, so dispersed particles rebuild the currently active shape.

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
- **Hover:** `Raycaster` (`firstHitOnly`) against one invisible proxy mesh per model, built from the same normalised geometry, with a BVH (about 0.05 ms per ray on 460k triangles).
  - A proxy is used only while its model is visibly present (presence `1 − |P − i|` > 0.2), so at most two proxies are tested. Mid-morph, the closest hit wins.
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
import { ParticleMorphScene, SHOWCASE_MODELS } from './particle-morph/index.js';
import { ScrollController } from './particle-morph/ScrollController.js';

const stage = document.getElementById('morph-stage');
const scene = new ParticleMorphScene(stage, {
  models: SHOWCASE_MODELS('/assets/'),       // or your own [{name, url, fitSize, fitAxis, orient, textureInk, inkGain}, …] (2 or more)
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
| `scene.setMorphProgress(p, {immediate})` | 0 = first model … 1 = last model (model k at k/(N−1)); smoothed by `morphSmoothing` unless `immediate` |
| `scene.morphProgress` | current smoothed progress (0..1) |
| `scene.sequencePosition` | position in the model sequence (0 … N−1, `morphHold` applied) |
| `scene.activeModel` / `scene.modelCount` | index of the nearest model / number of models |
| `scene.progressForModel(i)` | progress (0..1) at which model i is fully formed, e.g. for "jump to" buttons |
| `scene.setPointer(clientX, clientY)` / `clearPointer()` | manual cursor input (with `autoPointer: false`) |
| `scene.updateConfig(patch)` | live parameter changes; `particleCount` / `sampling` rebuild the system |
| `scene.resize()` | automatic via `ResizeObserver`; call it if you resize without the DOM noticing |
| `scene.start()` / `stop()` / `update(dt)` / `render()` | own the loop yourself with `autoStart: false` (for example inside an existing rAF/GSAP ticker) |
| `scene.dispose()` | stops the loop, removes listeners, frees GPU resources and removes the canvas |
| `scene.stats` | `{fps, particles, loadMs, sampleMs, matchMs, meanTravel (per transition), hovering}` |

React/Vue: create the scene in `useEffect`/`onMounted` and call `dispose()` in the cleanup.

## Configuration

All values live in `DEFAULT_CONFIG` (`src/particle-morph/config.js`).

| parameter | default | effect |
|---|---|---|
| `particleCount` | 40000 | particles per model (one shared system). Rebuilds on change |
| `particleSize` | 1.25 | point diameter in CSS px at the reference camera distance |
| `sizeVariation` | 0.7 | per-particle size spread (most fine, a few larger) |
| `opacity` | 0.85 | ink per particle |
| `shading` | 0.76 | normal-based tonal shading (sculptural read) |
| `backfaceFade` | 0.6 | dims particles on surfaces facing away (less see-through clutter) |
| `sampling.oversample` | 3 | blue-noise candidate factor (1 = plain random sampling, faster load) |
| `sampling.jitter` | 0.004 | surface irregularity / grain thickness (world units) |
| `morphProgress` | 0 | initial progress |
| `morphHold` | 0.1 | fraction of each transition, at both ends, where the model stays fully formed |
| `morphSmoothing` | 6 | how fast internal progress follows `setMorphProgress` (1/s) |
| `morphSpread` | 0.5 | stagger of the travelling wave (0 = all particles together) |
| `morphScatter` | 1.14 | outward bulge mid-flight |
| `morphTwist` | 2.24 | swirl mid-flight (radians, sign sets direction) |
| `morphNoise` | 1.0 | extra flow noise while in flight |
| `recoverySpeed` | 0.8 | spring stiffness and heat decay: how fast disturbed particles re-form |
| `springDamping` | 0.55 | spring damping ratio (< 1 overshoots, ≥ 1 no overshoot) |
| `noiseIntensity` | 0.39 | ambient organic drift |
| `noiseScale` | 1.6 | spatial frequency of the flow noise |
| `interactionRadius` | 0.3 | cursor radius as a fraction of the current model's height |
| `repulsionStrength` | 2.15 | radial push |
| `directionalStrength` | 0.8 | push along the cursor's motion (the trail) |
| `interactionEnabled` | true | hover dispersion on/off |
| `lookAtIntensity` | 0.37 | max rotation (rad) at the viewport edge |
| `lookAtStiffness` / `lookAtDamping` | 10 / 0.75 | look-at spring: snappiness / inertia |
| `blendMode` | `'css'` | `'css'` (mix-blend-mode difference) or `'shader'` (in-canvas difference on `background`) |
| `cssBlendTarget` | `'canvas'` | element that gets `mix-blend-mode`: `'canvas'` or `'container'` |
| `background` | `#ffffff` | background colour for `blendMode: 'shader'` |
| `maxPixelRatio` | 2 | DPR cap |
| `cameraFov` / `cameraDistance` | 35 / 6.5 | camera |
| `fitRadius` | 2.0 | camera backs off on narrow viewports to keep this radius in frame |
| `autoStart` / `autoPointer` | true / true | internal rAF loop / window pointer listeners |
| `simulationHz` / `maxSubsteps` | 120 / 4 | fixed physics step rate / catch-up limit |
| `models` | `[]` | `[{name, url, fitSize, fitAxis: 'x'\|'y'\|'z'\|'max', orient: [[axis, deg], …], textureInk, inkGain}, …]` (2 or more, in sequence order) |
| `models[i].textureInk` | 0 | 0..1: material/texture brightness → particle ink (piano 0.85, MacBook 0.7) |
| `models[i].inkGain` | 1 | ink multiplier per particle for that model (piano 1.8, MacBook 1.7) |

## Performance notes

- Per frame the CPU writes only about 15 uniforms and does one or two BVH raycasts. All per-particle work happens on the GPU: two 200×200 compute passes per substep, plus one draw call.
- Tested in headless Chromium on **software** rendering (SwiftShader, no GPU), where the live loop ran at ~30 fps with 40k particles. A desktop GPU should hold 60 fps with a large margin; profile on target hardware.
- Load-time CPU work for 40k particles and five models: GLB parse ~0.5 s, sampling ~2.7 s, matching ~0.35 s, BVH build ~0.4 s. Sampling time grows with `particleCount × oversample`.
- The page is frozen during that time; the demo shows "loading models…".
  - To shorten it, lower `sampling.oversample` to 2, or move `samplePointCloud` + `matchPointSets` into a Web Worker. Both are pure functions on typed arrays.
  - Another option is to pre-bake the results to a binary file at build time.

- The five GLBs total ~30 MB; the knight (12 MB) and MacBook (11 MB) account for most of it. Since only geometry and base-colour/emissive textures are used, they could be shrunk a lot for production: meshopt or Draco compression, or welding/simplifying the 460k-triangle knight. Check visually; a simplify/quantize test on the knight noticeably damaged its sampled shape.

## Assets

`public/models/` holds the five GLB files.
- The knight, katana and pull-up station are the files as supplied.
- The piano and MacBook are the `source/*.glb` files extracted from the supplied ZIPs, renamed.

The knight, katana and pull-up station are Sketchfab downloads under the Sketchfab Standard licence: "Chess Knight Protector" by mmtpagels, "katana with sheath" by cold607, "Adjustable pull-up dip station" by bzika4u. The piano and MacBook files carry no licence information. Check the licence terms for all five before using them in production.
