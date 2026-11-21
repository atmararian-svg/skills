import * as THREE from 'three';

/**
 * Crisp HTML labels pinned to 3D anchors in the skill frame. Each label is
 * placed on the outward side of its anchor (based on the projected direction
 * from the object's centre), so it stays readable at any orientation.
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
      it.el.classList.toggle('is-hover', it.skill.id === hovered);
      it.el.classList.toggle('is-active', it.skill.id === active);
      it.el.setAttribute('aria-pressed', String(it.skill.id === active));
    }
  }

  update(camera, frame, width, height) {
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
      let dx = px - cx;
      let dy = py - cy;
      const m = Math.max(Math.abs(dx), Math.abs(dy), 1e-3);
      dx /= m;
      dy /= m;
      // Top-left of the label box: centred on the anchor, pushed outward.
      let x = px - it.w / 2 + (dx * it.w) / 2;
      let y = py - it.h / 2 + (dy * it.h) / 2;
      const cx2 = Math.min(Math.max(x, margin), width - it.w - margin);
      // Not enough room sideways (narrow screens): sit above the anchor instead
      // of sliding over the hairline.
      if (Math.abs(cx2 - x) > 2 && Math.abs(dy) < 0.6) y = py - it.h;
      x = cx2;
      y = Math.min(Math.max(y, margin), height - it.h - margin);
      it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      it.el.style.textAlign = dx < -0.35 ? 'right' : dx > 0.35 ? 'left' : 'center';
    }
  }

  dispose() {
    this.root.remove();
  }
}
