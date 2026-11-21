import * as THREE from 'three';

/**
 * Restrained cursor parallax: the object tilts slightly toward the mouse and
 * shifts a touch in its direction, with eased lag. It produces its own
 * quaternion and offset, which the scene layers on top of (never into) the
 * drag rotation, so the two controls cannot fight.
 *
 * Priority: while a drag is in progress the target freezes; when the cursor
 * leaves the stage it eases back to rest.
 */
export class ParallaxController {
  constructor(element, cfg, { isDragging }) {
    this.el = element;
    this.cfg = cfg;
    this.isDragging = isDragging;
    this.target = new THREE.Vector2(); // -1..1, +y up
    this.current = new THREE.Vector2();
    this.quaternion = new THREE.Quaternion();
    this.offset = new THREE.Vector3();
    this._euler = new THREE.Euler();

    this._move = (e) => {
      if (e.pointerType !== 'mouse' || this.isDragging()) return;
      const r = this.el.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) return this.target.set(0, 0);
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
      this.target.set(THREE.MathUtils.clamp(nx, -1, 1), THREE.MathUtils.clamp(ny, -1, 1));
    };
    this._leave = () => this.target.set(0, 0);
    window.addEventListener('pointermove', this._move);
    element.addEventListener('pointerleave', this._leave);
    document.documentElement.addEventListener('mouseleave', this._leave);
  }

  update(dt) {
    const k = 1 - Math.exp(-this.cfg.ease * dt);
    this.current.lerp(this.target, k);
    const { x, y } = this.current;
    // Cursor right → front turns right (+Y rotation); cursor up → front turns up (−X rotation).
    this._euler.set(-y * this.cfg.tilt, x * this.cfg.tilt, 0, 'YXZ');
    this.quaternion.setFromEuler(this._euler);
    this.offset.set(x * this.cfg.shift, y * this.cfg.shift, 0);
  }

  dispose() {
    window.removeEventListener('pointermove', this._move);
    this.el.removeEventListener('pointerleave', this._leave);
    document.documentElement.removeEventListener('mouseleave', this._leave);
  }
}
