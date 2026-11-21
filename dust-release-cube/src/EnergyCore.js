import * as THREE from 'three';

/*
 * The glowing core: an opaque white sphere plus a camera-facing additive halo.
 * Its position is simulated in the skill frame (object space) with a damped
 * spring, so it moves with weight and always stays inside the shell.
 */

const sphereVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const sphereFragment = /* glsl */ `
  uniform float uIntensity;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
    // Hot white centre, a breath of rose at the limb so it still reads as a sphere.
    vec3 col = mix(vec3(0.96, 0.9, 0.91), vec3(1.0), smoothstep(0.0, 0.55, ndv));
    gl_FragColor = vec4(col * uIntensity, 1.0);
  }
`;

const haloVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const haloFragment = /* glsl */ `
  uniform float uSize;
  uniform float uRadius;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * uSize;
    float x = max(r - uRadius, 0.0);
    // Tight corona + soft scatter + faint wide falloff.
    float g = 0.8 * exp(-x / 0.03) + 0.3 * exp(-x / 0.1) + 0.08 * exp(-x / 0.28);
    g *= 1.0 - smoothstep(uSize * 0.36, uSize * 0.5, r);
    vec3 col = mix(vec3(1.0, 0.84, 0.87), vec3(1.0), clamp(g * 1.6, 0.0, 1.0));
    gl_FragColor = vec4(col * g * uIntensity, 1.0);
  }
`;

export class EnergyCore extends THREE.Group {
  constructor(cfg) {
    super();
    this.cfg = cfg;

    this.uIntensity = { value: cfg.intensity };

    this.sphere = new THREE.Mesh(
      new THREE.SphereGeometry(cfg.radius, 48, 32),
      new THREE.ShaderMaterial({
        vertexShader: sphereVertex,
        fragmentShader: sphereFragment,
        uniforms: { uIntensity: this.uIntensity },
      })
    );
    this.sphere.renderOrder = 2;

    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(cfg.haloSize, cfg.haloSize),
      new THREE.ShaderMaterial({
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
        uniforms: {
          uSize: { value: cfg.haloSize },
          uRadius: { value: cfg.radius },
          uIntensity: this.uIntensity,
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.halo.renderOrder = 10;

    this.add(this.sphere, this.halo);

    // Spring state, in the parent's (skill frame) coordinates.
    this.maxOffset = cfg.maxOffset;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
  }

  /** Direction in the skill frame (or null for centre). */
  setTargetDirection(dir) {
    if (!dir) this.target.set(0, 0, 0);
    else this.target.copy(dir).normalize().multiplyScalar(Math.min(this.cfg.travel, this.maxOffset * 0.8));
  }

  /**
   * The frame rotated by `delta` (= qNew⁻¹ · qOld) this tick. A free-floating
   * mass wants to keep its world position, so part of that rotation is undone
   * on the core — it lags, then the spring pulls it back.
   */
  applyFrameRotation(delta, amount = this.cfg.inertia) {
    if (amount <= 0 || this.pos.lengthSq() < 1e-8) return;
    this._q.identity().slerp(delta, amount);
    this.pos.applyQuaternion(this._q);
  }

  step(dt) {
    const { stiffness: k, damping: c } = this.cfg;
    const maxOffset = this.maxOffset;
    const n = 3;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this._a.subVectors(this.target, this.pos).multiplyScalar(k).addScaledVector(this.vel, -c);
      this.vel.addScaledVector(this._a, h);
      this.pos.addScaledVector(this.vel, h);
    }
    // Containment: the core can never reach the shell.
    const len = this.pos.length();
    if (len > maxOffset) {
      this.pos.multiplyScalar(maxOffset / len);
      const radial = this.vel.dot(this._v.copy(this.pos).normalize());
      if (radial > 0) this.vel.addScaledVector(this._v, -radial);
    }
    this.position.copy(this.pos);
  }

  /** Billboard the halo toward the camera. */
  faceCamera(camera) {
    this.getWorldQuaternion(this._q);
    this.halo.quaternion.copy(this._q.invert().multiply(camera.quaternion));
  }

  dispose() {
    for (const m of [this.sphere, this.halo]) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
