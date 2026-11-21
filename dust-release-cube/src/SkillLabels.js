import * as THREE from 'three';

/**
 * The section's six HTML labels, kept separate from the 3D object. Positions
 * come from projecting each skill's anchor once, at the object's resting
 * orientation, so the layout stays fixed like the existing section.
 */
export class SkillLabels {
  constructor(container, skills, { onHover, onSelect, canHover }) {
    this.skills = skills;
    this.root = document.createElement('div');
    this.root.className = 'labels';
    container.appendChild(this.root);

    this.items = skills.map((skill) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'skill-label';
      el.textContent = skill.label;
      el.dataset.id = skill.id;
      el.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse' && canHover()) onHover(skill.id);
      });
      el.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse') onHover(null, skill.id);
      });
      el.addEventListener('focus', () => onHover(skill.id));
      el.addEventListener('blur', () => onHover(null, skill.id));
      el.addEventListener('click', () => onSelect(skill.id));
      this.root.appendChild(el);
      const anchor = new THREE.Vector3(...skill.direction).normalize().multiplyScalar(skill.distance);
      return { skill, el, anchor, w: 0, h: 0 };
    });

    this._v = new THREE.Vector3();
    this._c = new THREE.Vector3();
  }

  measure() {
    for (const it of this.items) {
      it.w = it.el.offsetWidth;
      it.h = it.el.offsetHeight;
    }
  }

  setState({ hovered, active }) {
    for (const it of this.items) {
      const id = it.skill.id;
      it.el.classList.toggle('is-hover', id === hovered);
      it.el.classList.toggle('is-active', id === active);
      it.el.setAttribute('aria-pressed', String(id === active));
    }
  }

  /** @param frame Object3D whose local space holds the anchors (the resting orientation) */
  layout(camera, frame, width, height) {
    const toPx = (v) => {
      v.project(camera);
      return [(v.x * 0.5 + 0.5) * width, (-v.y * 0.5 + 0.5) * height];
    };
    frame.getWorldPosition(this._c);
    const [cx, cy] = toPx(this._c);
    const margin = 8;

    for (const it of this.items) {
      this._v.copy(it.anchor);
      frame.localToWorld(this._v);
      const [px, py] = toPx(this._v);
      const len = Math.hypot(px - cx, py - cy) || 1;
      const ux = (px - cx) / len;
      const uy = (py - cy) / len;

      // Label box on the outward side of the anchor.
      const m = Math.max(Math.abs(ux), Math.abs(uy));
      const dx = ux / m;
      const dy = uy / m;
      let x = px - it.w / 2 + (dx * it.w) / 2;
      let y = py - it.h / 2 + (dy * it.h) / 2;
      const clampedX = Math.min(Math.max(x, margin), width - it.w - margin);
      // Not enough room sideways (narrow screens): sit above the anchor instead
      // of running off the screen edge.
      if (Math.abs(clampedX - x) > 2 && Math.abs(dy) < 0.6) y = py - it.h;
      x = clampedX;
      y = Math.min(Math.max(y, margin), height - it.h - margin);
      it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      it.el.style.textAlign = dx < -0.35 ? 'right' : dx > 0.35 ? 'left' : 'center';
    }
  }

  dispose() {
    this.root.remove();
  }
}
