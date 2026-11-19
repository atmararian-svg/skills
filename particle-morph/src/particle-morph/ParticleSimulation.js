import { Vector3 } from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { positionShader, velocityShader } from './shaders/simulation.js';

/**
 * ParticleSimulation: GPU particle physics (position + velocity in float
 * render targets, ping-ponged by GPUComputationRenderer).
 *
 * The CPU only writes a handful of uniforms per step. Per-particle data never
 * leaves the GPU after initialisation.
 */
export class ParticleSimulation {
  /**
   * @param {import('three').WebGLRenderer} renderer
   * @param {import('./ParticleMorphSystem.js').ParticleMorphSystem} morph
   */
  constructor(renderer, morph, { introScatter = 0.0 } = {}) {
    this.morph = morph;
    const { width, height } = morph;
    const gpu = new GPUComputationRenderer(width, height, renderer);
    this.gpu = gpu;

    const pos0 = gpu.createTexture();
    const vel0 = gpu.createTexture();
    this._initialState(pos0.image.data, vel0.image.data, introScatter);

    this.posVar = gpu.addVariable('texturePosition', positionShader, pos0);
    this.velVar = gpu.addVariable('textureVelocity', velocityShader, vel0);
    gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);

    // pointer uniforms are shared objects so both passes always agree
    const pointer = {
      uPointer: { value: new Vector3(0, 0, 999) },
      uPointerVel: { value: new Vector3() },
      uPointerStrength: { value: 0 },
      uRadius: { value: 0.5 },
    };
    this.uniforms = {
      ...morph.uniforms,
      ...pointer,
      uDt: { value: 1 / 120 },
      uTime: { value: 0 },
      uStiffness: { value: 30 },
      uDamping: { value: 6 },
      uNoise: { value: 0.2 },
      uNoiseScale: { value: 1.6 },
      uMorphNoise: { value: 1 },
      uRepulsion: { value: 10 },
      uDirectional: { value: 1 },
      uHeatDecay: { value: 1.2 },
    };
    Object.assign(this.velVar.material.uniforms, this.uniforms);
    Object.assign(this.posVar.material.uniforms, pointer, {
      tMeta: morph.uniforms.tMeta,
      uDt: this.uniforms.uDt,
      uHeatDecay: this.uniforms.uHeatDecay,
    });

    const err = gpu.init();
    if (err) throw new Error(`ParticleSimulation: ${err}`);
    this.time = 0;
    this._acc = 0;
  }

  /** Start at the morph state matching the current progress (no pop on rebuild). */
  _initialState(pos, vel, introScatter) {
    const { a, b, meta } = this.morph.segmentData(this.morph.segment);
    const p = this.morph.uniforms.uProgress.value;
    const spread = this.morph.uniforms.uSpread.value;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    for (let i = 0; i < this.morph.count; i++) {
      const t = Math.min(1, Math.max(0, (p - meta[i * 4] * spread) / (1 - spread)));
      const e = ease(t);
      for (let k = 0; k < 3; k++) {
        const jitter = introScatter ? (meta[i * 4 + 1 + k] - 0.5) * introScatter : 0;
        pos[i * 4 + k] = a[i * 4 + k] + (b[i * 4 + k] - a[i * 4 + k]) * e + jitter;
        vel[i * 4 + k] = 0;
      }
      pos[i * 4 + 3] = introScatter ? 1 : 0;
      vel[i * 4 + 3] = 1;
    }
  }

  setParams(cfg) {
    const u = this.uniforms;
    const rs = Math.max(0.05, cfg.recoverySpeed);
    u.uStiffness.value = 38 * rs;
    u.uDamping.value = 2 * cfg.springDamping * Math.sqrt(u.uStiffness.value);
    u.uHeatDecay.value = 1.4 * rs;
    u.uNoise.value = cfg.noiseIntensity;
    u.uNoiseScale.value = cfg.noiseScale;
    u.uMorphNoise.value = cfg.morphNoise;
    u.uRepulsion.value = 14 * cfg.repulsionStrength;
    u.uDirectional.value = 2.2 * cfg.directionalStrength;
  }

  setPointer(localPos, localVel, strength, radius) {
    const u = this.uniforms;
    u.uPointer.value.copy(localPos);
    u.uPointerVel.value.copy(localVel);
    u.uPointerStrength.value = strength;
    u.uRadius.value = radius;
  }

  /** Fixed-timestep stepping; frame-rate independent behaviour. */
  step(dt, hz = 120, maxSubsteps = 4) {
    const h = 1 / hz;
    this._acc = Math.min(Math.max(0, this._acc + (dt > 0 ? dt : 0)), h * maxSubsteps);
    this.uniforms.uDt.value = h;
    while (this._acc >= h) {
      this.time += h;
      this.uniforms.uTime.value = this.time;
      this.gpu.compute();
      this._acc -= h;
    }
  }

  get positionTexture() {
    return this.gpu.getCurrentRenderTarget(this.posVar).texture;
  }

  dispose() {
    this.gpu.dispose();
  }
}
