import * as THREE from 'three';
import { DustPrism } from './DustPrism.js';
import { EnergyCore } from './EnergyCore.js';
import { SkillLabels } from './SkillLabels.js';
import { RotationController } from './RotationController.js';
import { ParallaxController } from './ParallaxController.js';
import { InfoPanel } from './InfoPanel.js';

/**
 * Self-contained scene. Mount into any element:
 *   const s = new DustReleaseScene(el, CONFIG); s.start(); … s.dispose();
 *
 * Hierarchy (each transform has exactly one owner):
 *   scene
 *   └─ rig                position only: parallax drift
 *      ├─ tilt            rotation only: parallax tilt (cursor)
 *      │  └─ frame        rotation only: drag × idle sway
 *      │     └─ prism     traced shell + inner hairlines
 *      └─ core            NOT rotated: screen-aligned spring offset
 *
 * Because the core is a sibling of the rotating groups rather than their child,
 * its skill-directed movement is always screen-relative, while the shared rig
 * keeps it inside the prism when the whole object drifts.
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
    this.rig = new THREE.Group();
    this.tilt = new THREE.Group();
    this.frame = new THREE.Group();
    this.scene.add(this.rig);
    this.rig.add(this.tilt);
    this.tilt.add(this.frame);

    this.core = new EnergyCore(config.core);
    this.rig.add(this.core);
    this.shared = {
      uCore: { value: new THREE.Vector3() },
      uCoreIntensity: this.core.uIntensity,
    };
    this.prism = new DustPrism(config.shell, this.shared);
    this.frame.add(this.prism);
    if (config.innerLines.show) {
      const targets = config.skills.map((s) => s.innerLine ?? new THREE.Vector3(...s.direction));
      this.prism.addInnerLines(targets, config.innerLines);
    }
    // Containment: the core is a sphere around the shared centre, so if
    // radius + travel stays below the nearest plane it is inside at any rotation.
    this.core.maxOffset = Math.min(config.core.maxOffset, this.prism.innerClearance() - config.core.radius - 0.08);
    this.restFrame = new THREE.Object3D(); // resting orientation, for the fixed label layout

    // Screen-relative core directions: each skill's resting direction
    // projected onto the screen plane (the camera looks straight down −Z).
    this.screenDirections = new Map(
      config.skills.map((s) => [s.id, new THREE.Vector3(s.direction[0], s.direction[1], 0).normalize()])
    );

    // Interaction
    this.rotation = new RotationController(container, config.rotation);
    this.rotation.onDragChange = (dragging) => {
      if (dragging) this.setHovered(null);
    };
    this.parallax = new ParallaxController(container, config.parallax, { isDragging: () => this.rotation.isDown });
    this.labels = new SkillLabels(container, config.skills, {
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

    this._sway = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._clock = new THREE.Clock();
    this._time = 0;
    this._tick = this._tick.bind(this);
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
    this.core.setTargetDirection(targetId ? this.screenDirections.get(targetId) : null);
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
    this.labels.layout(this.camera, this.restFrame, w, h);
  }

  // ── Loop ───────────────────────────────────────────────

  _tick() {
    this._raf = requestAnimationFrame(this._tick);
    const dt = Math.min(this._clock.getDelta(), 1 / 20);
    this._time += dt;
    const t = this._time;

    // 1. Drag rotation (with release inertia) + idle sway → frame
    this.rotation.update(dt);
    const a = this.reducedMotion ? 0 : this.config.rotation.idleSway;
    this._euler.set(Math.sin(t * 0.21) * a * 0.55, Math.sin(t * 0.13 + 1.3) * a, Math.sin(t * 0.17) * a * 0.15);
    this._sway.setFromEuler(this._euler);
    this.frame.quaternion.multiplyQuaternions(this._sway, this.rotation.quaternion);

    // 2. Cursor parallax → tilt (rotation) and rig (position), separate owners
    if (!this.reducedMotion) {
      this.parallax.update(dt);
      this.tilt.quaternion.copy(this.parallax.quaternion);
      this.rig.position.copy(this.parallax.offset);
    }

    // 3. Core: screen-aligned spring, independent of every rotation above
    this.core.step(dt);
    this.core.uIntensity.value = this.config.core.intensity * (1 + this.config.core.breathe * Math.sin(t * 1.1));

    // 4. Per-frame visual sync
    this.rig.updateMatrixWorld(true);
    this.core.getWorldPosition(this.shared.uCore.value);
    this.core.faceCamera(this.camera);
    this.prism.update(this.camera);

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
    this.parallax.dispose();
    this.labels.dispose();
    this.panel.dispose();
    this.prism.dispose();
    this.core.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
