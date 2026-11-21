/**
 * Dust Release cube — all tunable values live here.
 *
 * Coordinate system: the "skill frame" is the object's local space.
 * +X right, +Y up, +Z towards the viewer at rest. Everything the user rotates
 * (shell, core, skill directions) lives in this frame, so the core's
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

  shell: {
    /*
     * The eight corners of the Dust Release prism, traced from the anime frame.
     * Corner i: bit 0 → right, bit 1 → top, bit 2 → front (near) face.
     * They were solved so that, seen through this scene's camera at rest, the
     * shape projects onto the reference drawing's 8 corners and 12 edges: a
     * deep, slightly tapered prism seen almost face-on, its rear plane dropping
     * down-right. The faces are not planar or parallel; that hand-drawn skew
     * is part of the silhouette. Centred on the volume's centroid.
     */
    vertices: [
      [-0.603, -0.746, -0.523],
      [0.606, -0.890, -0.250],
      [-0.433, 0.410, -0.946],
      [0.841, 0.241, -0.674],
      [-0.881, -0.249, 0.677],
      [0.445, -0.422, 0.961],
      [-0.636, 0.901, 0.236],
      [0.660, 0.755, 0.520],
    ],
    scale: 1.0,

    tint: '#f6dde1',          // pale dusty rose
    faceOpacity: 0.15,       // front planes at normal incidence
    backFaceOpacity: 0.1,     // rear planes (overlaps build up like the drawing)
    fresnel: 0.22,            // extra opacity at grazing angles
    coreLight: 1.0,           // light spill from the core onto the planes

    edgeColor: '#ffffff',
    edgeWidth: 1.25,          // CSS px, crisp contour
    edgeOpacity: 0.95,
    edgeGlow: { width: 4, opacity: 0.07 }, // soft bleed around each contour
    backEdgeLevel: 0.8,       // the drawing keeps rear edges almost as bright
  },

  core: {
    radius: 0.135,
    travel: 0.17,         // displacement toward a skill direction
    maxOffset: 0.24,      // further clamped at runtime to fit inside the shell
    stiffness: 70,        // spring constant
    damping: 10.5,        // < 2*sqrt(stiffness) → slight, weighty overshoot
    inertia: 0.35,        // 0–1, how much the core lags behind rotation
    haloSize: 1.5,        // billboard quad size (world units)
    intensity: 1.0,
    breathe: 0.02,        // idle intensity pulse amplitude
  },

  rotation: {
    sensitivity: 0.0065,  // radians per dragged pixel
    damping: 3.2,         // inertia decay per second after release
    dragThreshold: 5,     // px before a press becomes a drag (prevents mis-clicks)
    idleSway: 0.05,       // radians, slow restrained idle motion
  },

  labels: {
    // false: labels and their hairlines keep the section's fixed 2D layout.
    // true: they track the 3D anchors as the object rotates.
    followRotation: false,
    lineColor: '#3a3a3a',
    lineActiveColor: '#e6e6e6',
    lineGap: 18,          // px between the object's outer radius and a line's start
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
      distance: 2.15,
      title: 'Interfaces that feel instant, measured and tuned at every layer.',
      body: 'Placeholder — profiling, rendering budgets and load strategies that hold up on real devices.',
    },
    {
      id: 'creative',
      label: 'CREATIVE DEVELOPMENT',
      // Lower diagonal: down, left and toward the viewer.
      direction: [-0.42, -0.72, 0.55],
      distance: 2.15,
      title: 'Interactive web experiences, unconventional ideas turned into engaging products.',
      body: 'Placeholder — real-time graphics, motion and interaction design built for the browser.',
    },
  ],
};
