/**
 * Configuration for ParticleMorphScene.
 *
 * Every value here can be overridden in the constructor
 * (`new ParticleMorphScene(el, { ... })`) and most can be changed live
 * through `scene.updateConfig({ ... })`.
 * The README lists every parameter and what it does.
 */

export const DEFAULT_CONFIG = {
  // ── Particles ───────────────────────────────────────────────────────────
  particleCount: 40000, // same count for both models (changing it rebuilds the system)
  particleSize: 1.6, // point diameter in CSS px at the reference camera distance
  sizeVariation: 0.7, // 0 = uniform size, 1 = strong per-particle size variation
  opacity: 0.85, // overall ink density of a single particle
  shading: 0.55, // 0 = flat, 1 = strong normal-based tonal shading
  backfaceFade: 0.6, // how much particles on surfaces facing away are dimmed

  // ── Sampling ────────────────────────────────────────────────────────────
  sampling: {
    oversample: 3, // candidate multiplier for blue-noise sample elimination (1 = pure random)
    jitter: 0.004, // surface irregularity (world units, ~0.2% of model height)
  },

  // ── Morphing ────────────────────────────────────────────────────────────
  morphProgress: 0, // 0 = model A (knight), 1 = model B (katana)
  morphSmoothing: 6, // how fast the internal progress follows the requested progress (1/s)
  morphSpread: 0.45, // stagger: 0 = every particle moves together, ~0.6 = strong travelling wave
  morphScatter: 0.32, // how far particles bulge outward mid-flight (world units)
  morphTwist: 0.7, // swirl around the vertical axis mid-flight (radians)
  morphNoise: 1.0, // extra flow-noise while particles are in flight

  // ── Physics ─────────────────────────────────────────────────────────────
  recoverySpeed: 0.8, // spring stiffness and how fast disturbed particles "cool down"
  springDamping: 0.55, // damping ratio of the spring (<1 gives overshoot and settling)
  noiseIntensity: 0.2, // ambient organic drift
  noiseScale: 1.6, // spatial frequency of the flow noise

  // ── Cursor interaction ──────────────────────────────────────────────────
  interactionRadius: 0.22, // fraction of the current model's visible height
  repulsionStrength: 1.0, // radial push away from the cursor
  directionalStrength: 0.8, // push along the cursor's movement direction
  interactionEnabled: true,
  lookAtIntensity: 0.15, // max formation rotation (radians) at the viewport edge
  lookAtStiffness: 10, // look-at spring stiffness (higher = snappier)
  lookAtDamping: 0.75, // look-at damping ratio (lower = more inertia / sway)

  // ── Rendering ───────────────────────────────────────────────────────────
  // 'css'    → transparent canvas with white additive particles and CSS
  //            `mix-blend-mode: difference` (inverts whatever is behind the canvas).
  // 'shader' → opaque canvas, the difference is computed in WebGL against `background`
  //            (identical look on a solid background, works inside any stacking context).
  blendMode: 'css',
  cssBlendTarget: 'canvas', // 'canvas' | 'container' — which element receives mix-blend-mode
  background: '#ffffff', // used by blendMode 'shader'
  maxPixelRatio: 2,
  cameraFov: 35,
  cameraDistance: 6.5,
  fitRadius: 2.0, // the camera backs off on narrow viewports to keep this radius visible

  // ── Runtime ─────────────────────────────────────────────────────────────
  autoStart: true, // run an internal requestAnimationFrame loop
  autoPointer: true, // listen to window pointer events (otherwise call setPointer())
  simulationHz: 120, // fixed simulation step rate
  maxSubsteps: 4,

  // Models: [A, B]. `orient` is a list of [axis, degrees] rotations applied in order,
  // then the model is centred and scaled so that its `fitAxis` dimension equals `fitSize`.
  models: [],
};

/** Asset presets for the two GLB files shipped with the demo. */
export const KNIGHT_KATANA_MODELS = (base = '/', ext = 'glb') => [
  {
    url: `${base}models/chess_knight_protector.${ext}`,
    fitSize: 2.35,
    fitAxis: 'y',
    orient: [['y', 205]],
  },
  {
    url: `${base}models/katana_with_sheath.${ext}`,
    fitSize: 3.5,
    fitAxis: 'max',
    // lies along +Z (handle at +Z): roll slightly, turn to face camera, tilt diagonally
    orient: [['z', 12], ['y', 90], ['x', 18], ['z', 32]],
  },
];

export function mergeConfig(base, patch = {}) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = { ...base[k], ...v };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}
