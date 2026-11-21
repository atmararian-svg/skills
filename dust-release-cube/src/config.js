/**
 * Dust Release cube — all tunable values live here.
 *
 * Coordinate system: the "skill frame" is the object's local space.
 * +X right, +Y up, +Z towards the viewer at rest. Everything the user rotates
 * (shell, core, axes, label anchors) lives in this frame, so the core's
 * movement is always computed in object space, never in screen space.
 */
export const CONFIG = {
  background: '#0A0A0A',

  camera: {
    fov: 30,
    // Pixels per world unit, as a fraction of viewport width / height (min wins).
    scale: { wide: [0.135, 0.18], narrow: [0.19, 0.14] },
    narrowBreakpoint: 700,
  },

  cube: {
    // Width, height, depth. Slightly taller than wide, slightly shallow —
    // the anime prism is never a perfect cube.
    size: [1.3, 1.4, 1.22],
    // Per-corner hand-drawn irregularity (world units) and its seed.
    jitter: 0.024,
    seed: 11,
    // Resting pose of the shell inside the skill frame (Euler XYZ, radians).
    // Gives the three-quarter view from the reference while the skill axes
    // stay screen-aligned at rest.
    pose: [0.34, -0.62, 0.05],

    tint: '#f0c3ca',          // dusty rose
    faceOpacity: 0.06,       // front planes at normal incidence
    backFaceOpacity: 0.045,    // rear planes
    fresnel: 0.38,            // extra opacity at grazing angles
    coreLight: 1.1,           // how much the core lights the glass

    edgeColor: '#ffffff',
    edgeWidth: 1.15,          // CSS px
    edgeOpacity: 0.95,
    backEdgeLevel: 0.45,      // perceived brightness of rear edges (0–1)

    // Faint inset shell that reads as glass thickness (double contour).
    innerShell: { scale: 0.935, opacity: 0.16, width: 1 },
  },

  core: {
    radius: 0.21,
    travel: 0.15,         // displacement toward a skill direction
    maxOffset: 0.21,      // hard clamp; radius + maxOffset < inner half-extent
    stiffness: 70,        // spring constant
    damping: 10.5,        // < 2*sqrt(stiffness) → slight, weighty overshoot
    inertia: 0.35,        // 0–1, how much the core lags behind rotation
    haloSize: 2.4,        // billboard quad size (world units)
    intensity: 1.0,
    breathe: 0.025,       // idle intensity pulse amplitude
  },

  rotation: {
    sensitivity: 0.0065,  // radians per dragged pixel
    damping: 3.2,         // inertia decay per second after release
    dragThreshold: 5,     // px before a press becomes a drag (prevents mis-clicks)
    idleSway: 0.06,       // radians, slow restrained idle motion
  },

  axes: {
    show: true,
    start: 1.28,          // where hairlines begin (outside the shell)
    endInset: 0.06,       // gap between line end and label anchor
    color: '#3a3a3a',
    activeColor: '#e6e6e6',
    width: 1,
  },

  skills: [
    {
      id: 'product',
      label: 'PRODUCT DEVELOPMENT',
      direction: [0, 1, 0],
      distance: 2.3,
      title: 'Turning early ideas into products people come back to.',
      body: 'Placeholder — scoping, prototyping and iterating with real users until the product earns its place.',
    },
    {
      id: 'complex',
      label: 'COMPLEX WEB APPLICATIONS',
      direction: [0, -1, 0],
      distance: 2.3,
      title: 'Large, stateful applications that stay fast and maintainable.',
      body: 'Placeholder — architecture, data flow and tooling for products that keep growing.',
    },
    {
      id: 'experimental',
      label: 'EXPERIMENTAL TECHNOLOGIES',
      direction: [-1, 0, 0],
      distance: 2.3,
      title: 'Exploring new technologies before they become mainstream.',
      body: 'Placeholder — WebGPU, spatial interfaces, on-device models and other emerging platforms.',
    },
    {
      id: 'fullstack',
      label: 'FULL-STACK DEVELOPMENT',
      direction: [1, 0, 0],
      distance: 2.3,
      title: 'End-to-end systems, from database schema to the last pixel.',
      body: 'Placeholder — APIs, infrastructure and interfaces designed as one coherent system.',
    },
    {
      id: 'performance',
      label: 'PERFORMANCE ENGINEERING',
      // Upper diagonal: up, right and away from the viewer (oblique depth axis).
      direction: [0.42, 0.72, -0.55],
      distance: 1.85,
      title: 'Interfaces that feel instant, measured and tuned at every layer.',
      body: 'Placeholder — profiling, rendering budgets and load strategies that hold up on real devices.',
    },
    {
      id: 'creative',
      label: 'CREATIVE DEVELOPMENT',
      // Lower diagonal: down, left and toward the viewer.
      direction: [-0.42, -0.72, 0.55],
      distance: 1.85,
      title: 'Interactive web experiences, unconventional ideas turned into engaging products.',
      body: 'Placeholder — real-time graphics, motion and interaction design built for the browser.',
    },
  ],
};
