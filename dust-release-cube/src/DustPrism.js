import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/*
 * The Dust Release prism: a custom hexahedron built from eight traced corners
 * (see CONFIG.shell.vertices). Neutral white translucent planes that bulge
 * slightly outward (like the faces of a die) and thin white contours.
 *
 * Corner i: bit 0 → right, bit 1 → top, bit 2 → front.
 */
export const FACES = {
  left: [0, 2, 6, 4],
  right: [1, 3, 7, 5],
  bottom: [0, 1, 5, 4],
  top: [2, 3, 7, 6],
  rear: [0, 1, 3, 2],
  front: [4, 5, 7, 6],
};
const FACE_LIST = Object.values(FACES);

const EDGES = [];
for (let i = 0; i < 8; i++) {
  for (let j = i + 1; j < 8; j++) {
    const x = i ^ j;
    if (x === 1 || x === 2 || x === 4) EDGES.push([i, j]);
  }
}
const EDGE_FACES = EDGES.map(([a, b]) =>
  FACE_LIST.map((f, k) => (f.includes(a) && f.includes(b) ? k : -1)).filter((k) => k >= 0)
);

/**
 * Each face is a bilinear patch through its 4 corners, pushed outward along the
 * face normal by bulge · sin(πu) · sin(πv). The offset is zero on the border,
 * so every edge stays a straight line and the silhouette stays angular; the
 * curvature shows up in the shading and reflections.
 */
function buildFaces(corners, bulge, segments) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const index = [];
  const centroids = [];
  const normals = [];
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  const p = new THREE.Vector3();

  for (const face of FACE_LIST) {
    let q = face.map((i) => corners[i]);
    const c = q.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(0.25);
    if (ab.subVectors(q[1], q[0]).cross(ac.subVectors(q[2], q[0])).dot(c) < 0) q = [q[0], q[3], q[2], q[1]];
    const n = ab.subVectors(q[2], q[0]).cross(ac.subVectors(q[3], q[1])).normalize().clone();
    centroids.push(c);
    normals.push(n);

    const S = (u, v, out) => {
      out.set(0, 0, 0)
        .addScaledVector(q[0], (1 - u) * (1 - v))
        .addScaledVector(q[1], u * (1 - v))
        .addScaledVector(q[2], u * v)
        .addScaledVector(q[3], (1 - u) * v);
      return out.addScaledVector(n, bulge * Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
    };

    const base = pos.length / 3;
    const e = 1e-3;
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    for (let j = 0; j <= segments; j++) {
      for (let i = 0; i <= segments; i++) {
        const u = i / segments;
        const v = j / segments;
        S(u, v, p);
        pos.push(p.x, p.y, p.z);
        // Analytic-ish normal from central differences of the patch.
        du.subVectors(S(Math.min(u + e, 1), v, tmpA), S(Math.max(u - e, 0), v, tmpB));
        dv.subVectors(S(u, Math.min(v + e, 1), tmpA), S(u, Math.max(v - e, 0), tmpB));
        const sn = du.cross(dv).normalize();
        if (sn.dot(n) < 0) sn.negate();
        nrm.push(sn.x, sn.y, sn.z);
        uv.push(u, v);
      }
    }
    const row = segments + 1;
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = base + j * row + i;
        index.push(a, a + 1, a + row + 1, a, a + row + 1, a + row);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
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

// Strictly neutral: every colour term below is white, planes are told apart
// by opacity, Fresnel and reflections only.
const glassFragment = /* glsl */ `
  uniform vec3 uCore;
  uniform float uCoreIntensity;
  uniform float uCoreLight;
  uniform float uOpacity;
  uniform float uFresnel;
  uniform float uReflection;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 3.0);

    // Light transmitted from the core onto nearby planes.
    float d = distance(vWorld, uCore);
    float glow = uCoreIntensity * uCoreLight / (1.0 + d * d * 9.0);

    // White studio reflections; the curved faces bend these into soft gradients.
    vec3 R = reflect(-V, N);
    float top = smoothstep(0.35, 1.0, R.y);
    float key = smoothstep(0.93, 0.995, dot(R, normalize(vec3(-0.6, 0.5, 0.62))));
    float rim = smoothstep(0.9, 0.99, dot(R, normalize(vec3(0.75, -0.2, 0.62))));
    float refl = (top * 0.5 + key * 0.9 + rim * 0.35) * uReflection;

    vec2 e = min(vUv, 1.0 - vUv);
    float border = 1.0 - smoothstep(0.0, 0.03, min(e.x, e.y));

    float light = 0.55 + 0.45 * fres + glow + refl * 0.6 + border * 0.12;
    float a = uOpacity + fres * uFresnel + glow * 0.12 + refl * 0.1 + border * 0.035;
    gl_FragColor = vec4(vec3(light), clamp(a, 0.0, 0.75));
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
      uCore: shared.uCore,
      uCoreIntensity: shared.uCoreIntensity,
      uCoreLight: { value: cfg.coreLight },
      uOpacity: { value: opacity },
      uFresnel: { value: cfg.fresnel },
      uReflection: { value: cfg.reflection },
    },
  });
}

function makeLines(points, { width, opacity, color = '#ffffff', vertexColors = false }) {
  const geometry = new LineSegmentsGeometry().setPositions(points);
  if (vertexColors) geometry.setColors(new Float32Array((points.length / 6) * 6).fill(1));
  const material = new LineMaterial({ color, linewidth: width, vertexColors, transparent: true, opacity, depthWrite: false });
  return new LineSegments2(geometry, material);
}

export class DustPrism extends THREE.Group {
  /**
   * @param cfg    CONFIG.shell
   * @param shared { uCore: {value: Vector3}, uCoreIntensity: {value: number} } — driven by the core
   */
  constructor(cfg, shared) {
    super();
    this.cfg = cfg;

    const corners = cfg.vertices.map((v) => new THREE.Vector3(...v).multiplyScalar(cfg.scale));
    this.corners = corners;
    const { geometry, centroids, normals } = buildFaces(corners, cfg.bulge, cfg.segments);
    this.faceCentroids = centroids;
    this.faceNormals = normals;

    this.backFaces = new THREE.Mesh(geometry, makeGlassMaterial(THREE.BackSide, cfg.backFaceOpacity, cfg, shared));
    this.backFaces.renderOrder = 1;
    this.frontFaces = new THREE.Mesh(geometry, makeGlassMaterial(THREE.FrontSide, cfg.faceOpacity, cfg, shared));
    this.frontFaces.renderOrder = 3;

    const edgePts = [];
    for (const [a, b] of EDGES) edgePts.push(...corners[a].toArray(), ...corners[b].toArray());
    this.edgeGlow = makeLines(edgePts, { width: cfg.edgeGlow.width, opacity: cfg.edgeGlow.opacity });
    this.edgeGlow.renderOrder = 4;
    this.edges = makeLines(edgePts, { width: cfg.edgeWidth, opacity: cfg.edgeOpacity, vertexColors: true });
    this.edges.renderOrder = 5;

    this.add(this.backFaces, this.frontFaces, this.edgeGlow, this.edges);

    this._backLevel = Math.pow(cfg.backEdgeLevel, 2.2); // perceptual → linear
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._facing = new Float32Array(6);
  }

  /** Distance from the centre to the nearest (flat) plane: how far the core may travel. */
  innerClearance() {
    return Math.min(...this.faceNormals.map((n, i) => Math.abs(n.dot(this.faceCentroids[i]))));
  }

  setResolution(w, h) {
    for (const l of [this.edges, this.edgeGlow]) l.material.resolution.set(w, h);
  }

  /** Rear contours sit a touch dimmer than front ones, which keeps depth readable. */
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
      const t = THREE.MathUtils.smoothstep(Math.max(this._facing[f1], this._facing[f2]), -0.12, 0.12);
      arr.fill(this._backLevel + (1 - this._backLevel) * t, e * 6, e * 6 + 6);
    }
    attr.data.needsUpdate = true;
  }

  dispose() {
    this.backFaces.geometry.dispose();
    this.backFaces.material.dispose();
    this.frontFaces.material.dispose();
    for (const l of [this.edges, this.edgeGlow]) {
      l.geometry.dispose();
      l.material.dispose();
    }
  }
}
