import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  OneFactor,
  Points,
  ReverseSubtractEquation,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mulberry32 } from './PointCloudGenerator.js';
import { particleFragmentShader, particleVertexShader } from './shaders/render.js';

/**
 * ParticleRenderer: one THREE.Points draw call. Positions are read from the
 * simulation's float texture in the vertex shader (no per-frame buffer upload).
 */
export class ParticleRenderer {
  constructor(morph, simulation) {
    this.morph = morph;
    this.simulation = simulation;
    const { count, width, height } = morph;

    const geometry = new BufferGeometry();
    const ref = new Float32Array(count * 2);
    const rnd = new Float32Array(count * 4);
    const rand = mulberry32(99);
    for (let i = 0; i < count; i++) {
      ref[i * 2] = ((i % width) + 0.5) / width;
      ref[i * 2 + 1] = (Math.floor(i / width) + 0.5) / height;
      for (let k = 0; k < 4; k++) rnd[i * 4 + k] = rand();
    }
    // `position` is required by three for the draw count; the real position comes from tPosition
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aRef', new BufferAttribute(ref, 2));
    geometry.setAttribute('aRand', new BufferAttribute(rnd, 4));

    this.uniforms = {
      tMeta: morph.uniforms.tMeta,
      uProgress: morph.uniforms.uProgress,
      uSpread: morph.uniforms.uSpread,
      tPosition: { value: null },
      tNormalA: { value: morph.textures.normalA },
      tNormalB: { value: morph.textures.normalB },
      uSize: { value: 1.6 },
      uSizeVariation: { value: 0.7 },
      uPixelRatio: { value: 1 },
      uViewportScale: { value: 1 },
      uRefDistance: { value: 6.5 },
      uOpacity: { value: 0.85 },
      uShading: { value: 0.55 },
      uBackfaceFade: { value: 0.45 },
      uLightDir: { value: new Vector3(-0.45, 0.65, 0.6).normalize() },
    };

    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendEquation: AddEquation,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneFactor,
      blendEquationAlpha: AddEquation,
    });

    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
  }

  /**
   * 'css'    → additive white ink on a transparent canvas (CSS difference does the rest).
   * 'shader' → opaque background; ink is subtracted from a light background or
   *            added to a dark one, which is exactly |bg − ink| (difference) on a solid colour.
   */
  setBlendMode(mode, background = '#ffffff') {
    const m = this.material;
    const bg = new Color(background);
    const light = bg.r * 0.2126 + bg.g * 0.7152 + bg.b * 0.0722 > 0.5;
    m.blendEquation = mode === 'shader' && light ? ReverseSubtractEquation : AddEquation;
    m.blendEquationAlpha = AddEquation;
    m.blendSrcAlpha = OneFactor;
    m.blendDstAlpha = OneFactor;
    m.needsUpdate = true;
  }

  setParams(cfg) {
    const u = this.uniforms;
    u.uSize.value = cfg.particleSize;
    u.uSizeVariation.value = cfg.sizeVariation;
    u.uOpacity.value = cfg.opacity;
    u.uShading.value = cfg.shading;
    u.uBackfaceFade.value = cfg.backfaceFade;
  }

  /** Must be called after every simulation step (ping-pong target changes). */
  update() {
    this.uniforms.tPosition.value = this.simulation.positionTexture;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
