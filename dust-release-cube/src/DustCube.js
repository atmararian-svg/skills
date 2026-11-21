import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/*
 * The transparent prism: translucent rose-tinted planes, thin white contours,
 * and a faint inset shell that reads as glass thickness.
 *
 * Corner i has bit 0 → +X, bit 1 → +Y, bit 2 → +Z.
 */
const FACES = [
  [0, 2, 6, 4], // -X
  [1, 3, 7, 5], // +X
  [0, 1, 5, 4], // -Y
  [2, 3, 7, 6], // +Y
  [0, 1, 3, 2], // -Z
  [4, 5, 7, 6], // +Z
];

const EDGES = [];
for (let i = 0; i < 8; i++) {
  for (let j = i + 1; j < 8; j++) {
    const x = i ^ j;
    if (x === 1 || x === 2 || x === 4) EDGES.push([i, j]);
  }
}
const EDGE_FACES = EDGES.map(([a, b]) =>
  FACES.map((f, k) => (f.includes(a) && f.includes(b) ? k : -1)).filter((k) => k >= 0)
);

function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildCorners([w, h, d], jitter, seed) {
  const rnd = mulberry32(seed);
  const j = () => (rnd() * 2 - 1) * jitter;
  const corners = [];
  for (let i = 0; i < 8; i++) {
    corners.push(
      new THREE.Vector3(
        (i & 1 ? 1 : -1) * (w / 2) + j(),
        (i & 2 ? 1 : -1) * (h / 2) + j(),
        (i & 4 ? 1 : -1) * (d / 2) + j()
      )
    );
  }
  return corners;
}

/** Flat-shaded faces; every quad gets a 0–1 UV so the shader knows where its borders are. */
function buildFaceGeometry(corners) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const centroids = [];
  const normals = [];
  const quadUV = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (const face of FACES) {
    let q = face.map((i) => corners[i]);
    const c = q.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(0.25);
    const n = ab.subVectors(q[1], q[0]).cross(ac.subVectors(q[2], q[0])).clone();
    if (n.dot(c) < 0) q = [q[0], q[3], q[2], q[1]];

    const faceN = new THREE.Vector3();
    for (const [a, b, e] of [[0, 1, 2], [0, 2, 3]]) {
      const tn = ab.subVectors(q[b], q[a]).cross(ac.subVectors(q[e], q[a])).normalize().clone();
      faceN.add(tn);
      for (const k of [a, b, e]) {
        pos.push(q[k].x, q[k].y, q[k].z);
        nrm.push(tn.x, tn.y, tn.z);
        uv.push(...quadUV[k]);
      }
    }
    centroids.push(c);
    normals.push(faceN.normalize());
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return { geometry: g, centroids, normals };
}

const glassVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const glassFragment = /* glsl */ `
  uniform vec3 uTint;
  uniform vec3 uCore;
  uniform float uCoreIntensity;
  uniform float uCoreLight;
  uniform float uOpacity;
  uniform float uFresnel;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 3.0);

    // Light from the core falling on the plane (inverse-square-ish falloff).
    float d = distance(vWorld, uCore);
    float glow = uCoreIntensity * uCoreLight / (1.0 + d * d * 6.0);

    // Soft studio reflections: a broad overhead softbox and a narrow key strip.
    vec3 R = reflect(-V, N);
    float sky = smoothstep(0.45, 1.0, R.y) * 0.55;
    float strip = smoothstep(0.965, 0.995, dot(R, normalize(vec3(-0.55, 0.45, 0.7))));
    float refl = sky + strip * 0.8;

    // Plane borders catch a little light, like the edge of a glass slab.
    vec2 e = min(vUv, 1.0 - vUv);
    float border = 1.0 - smoothstep(0.0, 0.045, min(e.x, e.y));

    vec3 col = uTint * (0.6 + 0.6 * fres)
             + vec3(1.0, 0.92, 0.93) * glow
             + vec3(1.0) * (refl * 0.22 + border * 0.12);
    float a = uOpacity + fres * uFresnel + glow * 0.16 + refl * 0.06 + border * 0.05;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
  }
`;

function makeGlassMaterial(side, opacity, cfg, shared) {
  return new THREE.ShaderMaterial({
    vertexShader: glassVertex,
    fragmentShader: glassFragment,
    side,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTint: { value: new THREE.Color(cfg.tint) },
      uCore: shared.uCore,
      uCoreIntensity: shared.uCoreIntensity,
      uCoreLight: { value: cfg.coreLight },
      uOpacity: { value: opacity },
      uFresnel: { value: cfg.fresnel },
    },
  });
}

function makeEdges(corners, { width, opacity, color, vertexColors }) {
  const pts = [];
  for (const [a, b] of EDGES) pts.push(corners[a].x, corners[a].y, corners[a].z, corners[b].x, corners[b].y, corners[b].z);
  const geometry = new LineSegmentsGeometry().setPositions(pts);
  if (vertexColors) geometry.setColors(new Float32Array(EDGES.length * 6).fill(1));
  const material = new LineMaterial({
    color,
    linewidth: width,
    vertexColors,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  return new LineSegments2(geometry, material);
}

export class DustCube extends THREE.Group {
  /**
   * @param cfg    CONFIG.cube
   * @param shared { uCore: {value: Vector3}, uCoreIntensity: {value: number} } — driven by the core
   */
  constructor(cfg, shared) {
    super();
    this.cfg = cfg;
    this.rotation.set(...cfg.pose);

    const corners = buildCorners(cfg.size, cfg.jitter, cfg.seed);
    const { geometry, centroids, normals } = buildFaceGeometry(corners);
    this.faceCentroids = centroids;
    this.faceNormals = normals;

    this.backFaces = new THREE.Mesh(geometry, makeGlassMaterial(THREE.BackSide, cfg.backFaceOpacity, cfg, shared));
    this.backFaces.renderOrder = 1;
    this.frontFaces = new THREE.Mesh(geometry, makeGlassMaterial(THREE.FrontSide, cfg.faceOpacity, cfg, shared));
    this.frontFaces.renderOrder = 3;

    this.edges = makeEdges(corners, {
      width: cfg.edgeWidth,
      opacity: cfg.edgeOpacity,
      color: cfg.edgeColor,
      vertexColors: true,
    });
    this.edges.renderOrder = 5;

    const s = cfg.innerShell;
    const inner = corners.map((v) => v.clone().multiplyScalar(s.scale));
    this.innerEdges = makeEdges(inner, { width: s.width, opacity: s.opacity, color: cfg.edgeColor, vertexColors: false });
    this.innerEdges.renderOrder = 5;

    this.add(this.backFaces, this.frontFaces, this.innerEdges, this.edges);

    this._backLevel = Math.pow(cfg.backEdgeLevel, 2.2); // perceptual → linear
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._facing = new Float32Array(6);
  }

  setResolution(w, h) {
    this.edges.material.resolution.set(w, h);
    this.innerEdges.material.resolution.set(w, h);
  }

  /** Rear edges are dimmer than front edges, which sells depth through the glass. */
  update(camera) {
    this.getWorldQuaternion(this._q);
    for (let f = 0; f < 6; f++) {
      this._c.copy(this.faceCentroids[f]);
      this.localToWorld(this._c);
      this._n.copy(this.faceNormals[f]).applyQuaternion(this._q);
      this._facing[f] = this._n.dot(this._p.subVectors(camera.position, this._c).normalize());
    }
    const attr = this.edges.geometry.attributes.instanceColorStart;
    const arr = attr.data.array;
    for (let e = 0; e < EDGES.length; e++) {
      const [f1, f2] = EDGE_FACES[e];
      const front = Math.max(this._facing[f1], this._facing[f2]);
      const t = THREE.MathUtils.smoothstep(front, -0.12, 0.12);
      const level = this._backLevel + (1 - this._backLevel) * t;
      arr.fill(level, e * 6, e * 6 + 6);
    }
    attr.data.needsUpdate = true;
  }

  dispose() {
    this.backFaces.geometry.dispose();
    this.backFaces.material.dispose();
    this.frontFaces.material.dispose();
    for (const l of [this.edges, this.innerEdges]) {
      l.geometry.dispose();
      l.material.dispose();
    }
  }
}
