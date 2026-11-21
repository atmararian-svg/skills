import * as THREE from 'three';

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

/**
 * Free drag rotation (screen-space trackball) with inertia after release.
 * A press only becomes a drag after `dragThreshold` px, and the click that
 * ends a drag is swallowed — so dragging never activates a skill.
 */
export class RotationController {
  constructor(element, cfg) {
    this.el = element;
    this.cfg = cfg;
    this.quaternion = new THREE.Quaternion();
    this.isDown = false;
    this.isDragging = false;
    this.vx = 0; // rad/s around screen Y (from horizontal drag)
    this.vy = 0; // rad/s around screen X (from vertical drag)
    this._suppressClick = false;
    this._qa = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
    this.onDragChange = null;

    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);
    this._click = this._click.bind(this);
    element.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
    element.addEventListener('click', this._click, true);
  }

  rotate(ax, ay) {
    this._qa.setFromAxisAngle(AXIS_Y, ax);
    this._qb.setFromAxisAngle(AXIS_X, ay);
    this.quaternion.premultiply(this._qa).premultiply(this._qb).normalize();
  }

  _down(e) {
    if (e.button !== 0 || e.target.closest('[data-no-drag]')) return;
    this.isDown = true;
    this.isDragging = false;
    this.startX = this.lastX = e.clientX;
    this.startY = this.lastY = e.clientY;
    this.lastT = performance.now();
    this.vx = this.vy = 0;
  }

  _move(e) {
    if (!this.isDown) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    if (!this.isDragging) {
      if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) < this.cfg.dragThreshold) return;
      this.isDragging = true;
      this.el.classList.add('is-dragging');
      this.onDragChange?.(true);
    }
    const now = performance.now();
    const dt = Math.max(now - this.lastT, 1) / 1000;
    const s = this.cfg.sensitivity;
    this.rotate(dx * s, dy * s);
    // Smoothed angular velocity for the release fling.
    const k = Math.min(1, dt * 18);
    this.vx += ((dx * s) / dt - this.vx) * k;
    this.vy += ((dy * s) / dt - this.vy) * k;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastT = now;
  }

  _up() {
    if (!this.isDown) return;
    this.isDown = false;
    if (this.isDragging) {
      this._suppressClick = true;
      setTimeout(() => (this._suppressClick = false), 0);
      // Held still before release → no fling.
      if (performance.now() - this.lastT > 90) this.vx = this.vy = 0;
      const max = 9;
      this.vx = THREE.MathUtils.clamp(this.vx, -max, max);
      this.vy = THREE.MathUtils.clamp(this.vy, -max, max);
      this.isDragging = false;
      this.el.classList.remove('is-dragging');
      this.onDragChange?.(false);
    }
  }

  _click(e) {
    if (this._suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      this._suppressClick = false;
    }
  }

  update(dt) {
    if (this.isDown) return;
    if (Math.abs(this.vx) + Math.abs(this.vy) < 1e-4) return;
    this.rotate(this.vx * dt, this.vy * dt);
    const decay = Math.exp(-this.cfg.damping * dt);
    this.vx *= decay;
    this.vy *= decay;
  }

  dispose() {
    this.el.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointercancel', this._up);
    this.el.removeEventListener('click', this._click, true);
  }
}
