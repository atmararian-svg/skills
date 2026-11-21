import * as THREE from 'three';
import { DustPrism } from './DustPrism.js';
import { EnergyCore } from './EnergyCore.js';
import { SkillLabels } from './SkillLabels.js';
import { RotationController } from './RotationController.js';
import { InfoPanel } from './InfoPanel.js';

/**
 * Self-contained scene. Mount into any element:
 *   const s = new DustReleaseScene(el, CONFIG); s.start(); … s.dispose();
 *
 * Hierarchy:
 *   scene
 *   └─ frame (skill frame — user rotation × idle sway)
 *      ├─ prism (traced Dust Release shell)
 *      └─ core  (spring-driven, local coords; rests at the centroid)
 *
 * Labels and their hairlines are a separate 2D overlay (SkillLabels).
 */
export class DustReleaseScene {
  constructor(container, config, { onSelect } = {}) {
    this.container = container;
    this.config = config;
    this.onSelectCallback = onSelect;
    this.state = { hovered: null, active: null };
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(new THREE.Color(config.background), 1);
    this.renderer.domElement.className = 'stage-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(config.camera.fov, 1, 0.1, 100);

    // Object
    this.frame = new THREE.Group();
    this.scene.add(this.frame);
    this.core = new EnergyCore(config.core);
    this.shared = {
      uCore: { value: new THREE.Vector3() },
      uCoreIntensity: this.core.uIntensity,
    };
    this.prism = new DustPrism(config.shell, this.shared);
    this.frame.add(this.prism, this.core);
    // Containment: core radius + travel always stays clear of every plane.
    this.core.maxOffset = Math.min(config.core.maxOffset, this.prism.innerClearance() - config.core.radius - 0.08);
    this.restFrame = new THREE.Object3D(); // resting orientation, for the fixed label layout

    this.directions = new Map(config.skills.map((s) => [s.id, new THREE.Vector3(...s.direction).normalize()]));

    // Interaction
    this.rotation = new RotationController(container, config.rotation);
    this.rotation.onDragChange = (dragging) => {
      if (dragging) this.setHovered(null);
    };
    this.labels = new SkillLabels(container, config.skills, config.labels, {
      onHover: (id, leaving) => {
        if (id === null && leaving && this.state.hovered !== leaving) return;
        this.setHovered(id);
      },
      onSelect: (id) => this.select(id),
      canHover: () => !this.rotation.isDown,
    });
    this.panel = new InfoPanel(container);

    this._onKey = (e) => {
      if (e.key === 'Escape') this.select(null);
    };
    window.addEventListener('keydown', this._onKey);

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);
    this.resize();
    document.fonts?.ready.then(() => this.resize()); // re-measure labels once web fonts land

    this._prevQ = new THREE.Quaternion();
    this._delta = new THREE.Quaternion();
    this._sway = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._clock = new THREE.Clock();
    this._time = 0;
    this._tick = this._tick.bind(this);
    this.updateFrameRotation(0);
    this._prevQ.copy(this.frame.quaternion);
  }

  // ── State ──────────────────────────────────────────────

  setHovered(id) {
    if (this.state.hovered === id) return;
    this.state.hovered = id;
    this.syncState();
  }

  select(id) {
    if (this.state.active === id) return;
    this.state.active = id;
    this.syncState();
    const skill = this.config.skills.find((s) => s.id === id) || null;
    this.panel.show(skill);
    this.onSelectCallback?.(skill);
  }

  syncState() {
    const { hovered, active } = this.state;
    // Hover leads temporarily; otherwise the core rests at the active skill (or centre).
    const targetId = hovered ?? active;
    this.core.setTargetDirection(targetId ? this.directions.get(targetId) : null);
    this.labels.setState(this.state);
  }

  // ── Layout ─────────────────────────────────────────────

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;

    const c = this.config.camera;
    const [fw, fh] = w < c.narrowBreakpoint ? c.scale.narrow : c.scale.wide;
    const ppu = Math.min(w * fw, h * fh); // pixels per world unit
    this.camera.position.set(0, 0, h / (2 * ppu * Math.tan(THREE.MathUtils.degToRad(c.fov / 2))));
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    this.prism.setResolution(w, h);
    this.labels.measure();

    // Hairlines start just outside the object's largest possible screen radius.
    const R = this.prism.outerRadius();
    const D = this.camera.position.z;
    this.lineStart = R * ppu * (D / (D - R)) + this.config.labels.lineGap;
    if (!this.labels.follows) this.layoutLabels(this.restFrame);
  }

  layoutLabels(frame) {
    this.labels.layout(this.camera, frame, this.width, this.height, this.lineStart);
  }

  // ── Loop ───────────────────────────────────────────────

  updateFrameRotation(t) {
    const a = this.reducedMotion ? 0 : this.config.rotation.idleSway;
    this._euler.set(Math.sin(t * 0.21) * a * 0.55, Math.sin(t * 0.13 + 1.3) * a, Math.sin(t * 0.17) * a * 0.15);
    this._sway.setFromEuler(this._euler);
    this.frame.quaternion.multiplyQuaternions(this._sway, this.rotation.quaternion);
  }

  _tick() {
    this._raf = requestAnimationFrame(this._tick);
    const dt = Math.min(this._clock.getDelta(), 1 / 20);
    this._time += dt;
    const t = this._time;

    // 1. Rotation (drag inertia + idle sway)
    this.rotation.update(dt);
    this.updateFrameRotation(t);

    // 2. Core physics in object space: inertial lag from the rotation, then spring.
    this._delta.copy(this.frame.quaternion).invert().multiply(this._prevQ);
    this._prevQ.copy(this.frame.quaternion);
    this.core.applyFrameRotation(this._delta, this.reducedMotion ? 0 : undefined);
    this.core.step(dt);
    this.core.uIntensity.value = this.config.core.intensity * (1 + this.config.core.breathe * Math.sin(t * 1.1));

    // 3. Per-frame visual sync
    this.frame.updateMatrixWorld(true);
    this.core.getWorldPosition(this.shared.uCore.value);
    this.core.faceCamera(this.camera);
    this.prism.update(this.camera);
    if (this.labels.follows) this.layoutLabels(this.frame);

    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (this._raf) return;
    this._clock.getDelta();
    this._tick();
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  dispose() {
    this.stop();
    this._resizeObserver.disconnect();
    window.removeEventListener('keydown', this._onKey);
    this.rotation.dispose();
    this.labels.dispose();
    this.panel.dispose();
    this.prism.dispose();
    this.core.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
