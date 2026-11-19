import { Color, Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { DEFAULT_CONFIG, mergeConfig } from './config.js';
import { ModelLoader } from './ModelLoader.js';
import { samplePointCloud } from './PointCloudGenerator.js';
import { ParticleMorphSystem } from './ParticleMorphSystem.js';
import { ParticleSimulation } from './ParticleSimulation.js';
import { ParticleRenderer } from './ParticleRenderer.js';
import { CursorInteraction } from './CursorInteraction.js';

/**
 * ParticleMorphScene: the reusable entry point.
 *
 *   const pms = new ParticleMorphScene(containerEl, { models: [a, b], ...overrides });
 *   await pms.load();
 *   pms.setMorphProgress(0.4);  // 0 = model A, 1 = model B
 *   pms.dispose();              // on unmount
 *
 * It owns its renderer, camera, rAF loop (optional), ResizeObserver and pointer
 * listeners (optional). It knows nothing about scrolling or UI.
 */
export class ParticleMorphScene {
  constructor(container, config = {}) {
    if (!container) throw new Error('ParticleMorphScene: container element required');
    this.container = container;
    this.config = mergeConfig(DEFAULT_CONFIG, config);
    this.ready = false;
    this.stats = { fps: 0, particles: 0, loadMs: 0, sampleMs: 0, matchMs: 0, hovering: false };

    // ── renderer
    this.renderer = new WebGLRenderer({
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: false,
    });
    const canvas = this.renderer.domElement;
    Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'pan-y' });
    container.appendChild(canvas);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(this.config.cameraFov, 1, 0.1, 100);
    this.formation = new Group();
    this.scene.add(this.formation);

    this.cursor = new CursorInteraction({
      camera: this.camera,
      formation: this.formation,
      domElement: canvas,
      autoPointer: this.config.autoPointer,
    });

    this._progressTarget = this.config.morphProgress;
    this._progress = this.config.morphProgress;
    this._raf = 0;
    this._last = 0;
    this._fpsAcc = { t: 0, n: 0 };

    this._applyBlendStyle();
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);
    this.resize();
  }

  // ───────────────────────────────────────────────────────────── loading

  /** Loads both models (config.models or the given specs), builds the particle system. */
  async load(models = this.config.models, { onProgress } = {}) {
    if (!models || models.length !== 2) throw new Error('ParticleMorphScene.load: exactly two model specs required');
    const t0 = performance.now();
    const loader = new ModelLoader();
    let done = 0;
    this.sources = await Promise.all(
      models.map((spec) =>
        loader.load(spec).then((r) => {
          onProgress?.(++done / models.length);
          return r;
        }),
      ),
    );
    if (this._disposed) return this;
    this.stats.loadMs = Math.round(performance.now() - t0);
    this._build();
    this.cursor.setProxies(this.sources.map((s) => s.geometry));
    this.ready = true;
    if (this.config.autoStart) this.start();
    return this;
  }

  _build() {
    this._disposeSystem();
    const cfg = this.config;
    const n = Math.max(1000, Math.round(cfg.particleCount));
    const t0 = performance.now();
    const clouds = this.sources.map((s, i) =>
      samplePointCloud(s.geometry, n, { ...cfg.sampling, seed: 11 + i * 101 }),
    );
    this.stats.sampleMs = Math.round(performance.now() - t0);

    this.morph = new ParticleMorphSystem(clouds[0], clouds[1], {
      heightA: this.sources[0].size.y,
      heightB: this.sources[1].size.y,
    });
    this.stats.matchMs = Math.round(this.morph.matchTimeMs);
    this.stats.meanTravel = +this.morph.distanceStats.mean.toFixed(3);
    this.morph.setParams(cfg);
    this.morph.setProgress(this._progress);

    this.simulation = new ParticleSimulation(this.renderer, this.morph, { introScatter: this._built ? 0 : 0.6 });
    this.simulation.setParams(cfg);
    this.particles = new ParticleRenderer(this.morph, this.simulation);
    this.particles.setParams(cfg);
    this.particles.setBlendMode(cfg.blendMode, cfg.background);
    this.particles.update();
    this.formation.add(this.particles.points);
    this.stats.particles = n;
    this._built = true;
    this._updateRenderUniforms();
  }

  // ───────────────────────────────────────────────────────────── public API

  /** 0 → model A, 1 → model B. Smoothed internally (config.morphSmoothing). */
  setMorphProgress(p, { immediate = false } = {}) {
    this._progressTarget = Math.min(1, Math.max(0, p));
    if (immediate) this._progress = this._progressTarget;
  }

  get morphProgress() {
    return this._progress;
  }

  /** Manual pointer input (use with autoPointer: false, or to synthesise input). */
  setPointer(clientX, clientY) {
    this.cursor.setPointerFromClient(clientX, clientY);
  }

  clearPointer() {
    this.cursor.clearPointer();
  }

  updateConfig(patch) {
    const prev = this.config;
    this.config = mergeConfig(prev, patch);
    const cfg = this.config;
    if (patch.morphProgress !== undefined) this.setMorphProgress(patch.morphProgress);
    if (patch.cameraFov !== undefined || patch.cameraDistance !== undefined || patch.fitRadius !== undefined) this.resize();
    if (patch.blendMode !== undefined || patch.background !== undefined || patch.cssBlendTarget !== undefined) {
      this._applyBlendStyle(prev);
    }
    if (!this.ready) return;
    if ((patch.particleCount !== undefined && Math.round(patch.particleCount) !== this.stats.particles) || patch.sampling) {
      this._build();
      return;
    }
    this.morph.setParams(cfg);
    this.simulation.setParams(cfg);
    this.particles.setParams(cfg);
    this.particles.setBlendMode(cfg.blendMode, cfg.background);
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.config.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    const cam = this.camera;
    cam.fov = this.config.cameraFov;
    cam.aspect = w / h;
    // keep `fitRadius` inside the frame on narrow viewports
    const tanV = Math.tan((cam.fov * Math.PI) / 360);
    const distH = this.config.fitRadius / (tanV * cam.aspect);
    cam.position.set(0, 0, Math.max(this.config.cameraDistance, distH));
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    this._viewport = { w, h, pr };
    this._updateRenderUniforms();
    if (this.ready && !this._raf) this.render();
  }

  start() {
    if (this._raf) return;
    this._last = performance.now();
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this._last) / 1000);
      this._last = now;
      this.update(dt);
      this.render();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  /** Advance the simulation by dt seconds (call yourself when autoStart is false). */
  update(dt) {
    if (!this.ready) return;
    const cfg = this.config;
    // critically damped approach to the requested progress
    const a = 1 - Math.exp(-dt * cfg.morphSmoothing);
    this._progress += (this._progressTarget - this._progress) * a;
    if (Math.abs(this._progressTarget - this._progress) < 1e-5) this._progress = this._progressTarget;
    this.morph.setProgress(this._progress);

    const { hit } = this.cursor.update(dt, this._progress, cfg);
    this.stats.hovering = hit;
    const radius = cfg.interactionRadius * this.morph.heightAt(this._progress);
    this.simulation.setPointer(this.cursor.local, this.cursor.localVel, this.cursor.strength, radius);
    this.simulation.step(dt, cfg.simulationHz, cfg.maxSubsteps);
    this.particles.update();

    const f = this._fpsAcc;
    f.t += dt;
    f.n++;
    if (f.t >= 0.5) {
      this.stats.fps = Math.round(f.n / f.t);
      f.t = 0;
      f.n = 0;
    }
  }

  render() {
    if (!this.ready) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._disposed = true;
    this.stop();
    this._resizeObserver.disconnect();
    this.cursor.dispose();
    this._disposeSystem();
    for (const s of this.sources || []) s.geometry.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
    this._restoreBlendStyle();
  }

  // ───────────────────────────────────────────────────────────── internals

  _disposeSystem() {
    this.particles?.dispose();
    this.simulation?.dispose();
    this.morph?.dispose();
    this.particles = this.simulation = this.morph = null;
  }

  _updateRenderUniforms() {
    if (!this.particles || !this._viewport) return;
    const u = this.particles.uniforms;
    u.uPixelRatio.value = this._viewport.pr;
    u.uViewportScale.value = Math.min(1.5, Math.max(0.7, this._viewport.h / 950));
    u.uRefDistance.value = this.config.cameraDistance;
  }

  _blendElement(cfg = this.config) {
    return cfg.cssBlendTarget === 'container' ? this.container : this.renderer.domElement;
  }

  _applyBlendStyle(prev) {
    if (prev) this._restoreBlendStyle(prev);
    const cfg = this.config;
    const el = this._blendElement();
    if (cfg.blendMode === 'css') {
      this._savedBlend = { el, value: el.style.mixBlendMode };
      el.style.mixBlendMode = 'difference';
      this.renderer.setClearColor(0x000000, 0);
    } else {
      this.renderer.setClearColor(new Color(cfg.background), 1);
    }
  }

  _restoreBlendStyle() {
    if (this._savedBlend) {
      this._savedBlend.el.style.mixBlendMode = this._savedBlend.value;
      this._savedBlend = null;
    }
  }
}
