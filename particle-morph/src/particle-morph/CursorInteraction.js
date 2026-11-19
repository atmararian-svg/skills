import { Mesh, MeshBasicMaterial, Raycaster, Vector2, Vector3 } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

/**
 * CursorInteraction
 *  - tracks the pointer (window listeners, or fed manually via setPointer)
 *  - Look At: spring-damped rotation of the formation toward the cursor
 *  - Hover: Raycaster against invisible BVH-accelerated proxies of BOTH
 *    original meshes; returns the hit in formation-local space together with a
 *    smoothed velocity and a fading strength for the GPU repulsion.
 */
export class CursorInteraction {
  constructor({ camera, formation, domElement, autoPointer = true }) {
    this.camera = camera;
    this.formation = formation;
    this.domElement = domElement;
    this.raycaster = new Raycaster();
    this.raycaster.firstHitOnly = true;

    this.ndc = new Vector2();
    this.inside = false;
    this.hasPointer = false;

    // look-at spring state
    this.rot = new Vector2(); // x: pitch, y: yaw
    this.rotVel = new Vector2();

    // hover state (formation-local)
    this.local = new Vector3(0, 0, 999);
    this.localVel = new Vector3();
    this.strength = 0;
    this._prevLocal = new Vector3();
    this._hadHit = false;
    this._tmp = new Vector3();
    this._hits = [];

    this.proxies = [];
    this.proxyMaterial = new MeshBasicMaterial({ visible: false });

    if (autoPointer) this._bind();
  }

  _bind() {
    this._onMove = (e) => this.setPointerFromClient(e.clientX, e.clientY);
    this._onLeave = () => this.clearPointer();
    this._onOut = (e) => { if (!e.relatedTarget) this.clearPointer(); };
    window.addEventListener('pointermove', this._onMove, { passive: true });
    window.addEventListener('pointerdown', this._onMove, { passive: true });
    document.addEventListener('pointerleave', this._onLeave);
    window.addEventListener('pointerout', this._onOut);
    window.addEventListener('blur', this._onLeave);
  }

  setPointerFromClient(clientX, clientY) {
    const r = this.domElement.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.inside = Math.abs(this.ndc.x) <= 1 && Math.abs(this.ndc.y) <= 1;
    this.hasPointer = true;
  }

  /** NDC input (-1..1) for hosts that drive the pointer themselves. */
  setPointerNDC(x, y) {
    this.ndc.set(x, y);
    this.inside = Math.abs(x) <= 1 && Math.abs(y) <= 1;
    this.hasPointer = true;
  }

  clearPointer() {
    this.inside = false;
    this.hasPointer = false;
  }

  /** @param {import('three').BufferGeometry[]} geometries [A, B] in normalised space */
  setProxies(geometries) {
    this.disposeProxies();
    this.proxies = geometries.map((g) => {
      if (!g.boundsTree) g.boundsTree = computeBoundsTree.call(g); // BVH: ~0.05 ms raycasts on 460k tris
      const m = new Mesh(g, this.proxyMaterial);
      m.raycast = acceleratedRaycast;
      m.visible = false; // never rendered; Raycaster ignores visibility
      m.matrixAutoUpdate = false;
      this.formation.add(m);
      return m;
    });
  }

  disposeProxies() {
    for (const m of this.proxies) {
      m.removeFromParent();
      if (m.geometry.boundsTree) disposeBoundsTree.call(m.geometry);
    }
    this.proxies = [];
  }

  /**
   * @param {number} dt
   * @param {number} progress current (smoothed) morph progress 0..1
   * @param {object} cfg config
   */
  update(dt, progress, cfg) {
    // ── Look At: damped spring toward a target rotation
    const tx = this.hasPointer ? -this.ndc.y * cfg.lookAtIntensity * 0.75 : 0;
    const ty = this.hasPointer ? this.ndc.x * cfg.lookAtIntensity : 0;
    const k = cfg.lookAtStiffness;
    const c = 2 * cfg.lookAtDamping * Math.sqrt(k);
    const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      this.rotVel.x += ((tx - this.rot.x) * k - this.rotVel.x * c) * h;
      this.rotVel.y += ((ty - this.rot.y) * k - this.rotVel.y * c) * h;
      this.rot.x += this.rotVel.x * h;
      this.rot.y += this.rotVel.y * h;
    }
    this.formation.rotation.set(this.rot.x, this.rot.y, 0);
    this.formation.updateMatrixWorld(true);

    // ── Hover: raycast both proxies; accept hits on the model(s) that are visibly present
    let hit = null;
    if (cfg.interactionEnabled && this.inside && this.proxies.length) {
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const weights = [1 - progress, progress];
      let best = Infinity;
      for (let i = 0; i < this.proxies.length; i++) {
        if (weights[i] < 0.2) continue;
        this._hits.length = 0;
        this.raycaster.intersectObject(this.proxies[i], false, this._hits);
        const h0 = this._hits[0];
        if (h0 && h0.distance < best) {
          best = h0.distance;
          hit = h0.point;
        }
      }
    }

    const fadeIn = 1 - Math.exp(-dt * 14);
    const fadeOut = 1 - Math.exp(-dt * 4);
    if (hit) {
      this._tmp.copy(hit);
      this.formation.worldToLocal(this._tmp);
      if (!this._hadHit) {
        // fresh entry: jump there, do not slide in from the last exit point
        this.local.copy(this._tmp);
        this._prevLocal.copy(this._tmp);
        this.localVel.set(0, 0, 0);
      }
      // slight smoothing of the hit point itself (removes jitter on fine geometry)
      this.local.lerp(this._tmp, 1 - Math.exp(-dt * 30));
      const inst = this._tmp.subVectors(this.local, this._prevLocal).divideScalar(Math.max(dt, 1e-3));
      this.localVel.lerp(inst, 1 - Math.exp(-dt * 10));
      const max = 6;
      if (this.localVel.length() > max) this.localVel.setLength(max);
      this._prevLocal.copy(this.local);
      this.strength += (1 - this.strength) * fadeIn;
    } else {
      // keep last position: particles near the exit point settle back gradually
      this.localVel.multiplyScalar(Math.exp(-dt * 6));
      this.strength += (0 - this.strength) * fadeOut;
      if (this.strength < 1e-3) this.strength = 0;
    }
    this._hadHit = !!hit;
    return { hit: !!hit };
  }

  dispose() {
    if (this._onMove) {
      window.removeEventListener('pointermove', this._onMove);
      window.removeEventListener('pointerdown', this._onMove);
      document.removeEventListener('pointerleave', this._onLeave);
      window.removeEventListener('pointerout', this._onOut);
      window.removeEventListener('blur', this._onLeave);
    }
    this.disposeProxies();
    this.proxyMaterial.dispose();
  }
}
