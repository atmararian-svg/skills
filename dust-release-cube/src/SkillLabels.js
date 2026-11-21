import * as THREE from 'three';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The section's 2D overlay: six HTML labels plus their hairlines, drawn in SVG
 * and kept separate from the 3D object. Positions come from projecting each
 * skill's 3D anchor; by default with the object's resting orientation, so the
 * layout stays fixed like the existing section (cfg.followRotation tracks the
 * live orientation instead). Lines start outside the object's outer radius,
 * so nothing ever crosses or sticks out of the prism.
 */
export class SkillLabels {
  constructor(container, skills, cfg, { onHover, onSelect, canHover }) {
    this.skills = skills;
    this.cfg = cfg;
    this.root = document.createElement('div');
    this.root.className = 'labels';
    this.root.style.setProperty('--line', cfg.lineColor);
    this.root.style.setProperty('--line-lit', cfg.lineActiveColor);
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'label-lines');
    this.svg.setAttribute('aria-hidden', 'true');
    this.root.appendChild(this.svg);
    container.appendChild(this.root);

    this.items = skills.map((skill) => {
      const line = document.createElementNS(SVG_NS, 'line');
      this.svg.appendChild(line);

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
      return { skill, el, line, anchor, w: 0, h: 0 };
    });

    this._v = new THREE.Vector3();
    this._c = new THREE.Vector3();
  }

  get follows() {
    return this.cfg.followRotation;
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
      it.line.classList.toggle('is-lit', id === hovered || id === active);
    }
  }

  /**
   * @param frame        Object3D whose local space holds the anchors
   * @param innerRadius  px from the object's centre where hairlines begin
   */
  layout(camera, frame, width, height, innerRadius) {
    const toPx = (v) => {
      v.project(camera);
      return [(v.x * 0.5 + 0.5) * width, (-v.y * 0.5 + 0.5) * height];
    };
    frame.getWorldPosition(this._c);
    const [cx, cy] = toPx(this._c);
    const margin = 8;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    for (const it of this.items) {
      this._v.copy(it.anchor);
      frame.localToWorld(this._v);
      const [px, py] = toPx(this._v);
      const len = Math.hypot(px - cx, py - cy) || 1;
      const ux = (px - cx) / len;
      const uy = (py - cy) / len;

      // Hairline: from just outside the object to the label anchor.
      const r0 = Math.min(innerRadius, len);
      it.line.setAttribute('x1', (cx + ux * r0).toFixed(1));
      it.line.setAttribute('y1', (cy + uy * r0).toFixed(1));
      it.line.setAttribute('x2', px.toFixed(1));
      it.line.setAttribute('y2', py.toFixed(1));

      // Label box on the outward side of the anchor.
      const m = Math.max(Math.abs(ux), Math.abs(uy));
      const dx = ux / m;
      const dy = uy / m;
      let x = px - it.w / 2 + (dx * it.w) / 2;
      let y = py - it.h / 2 + (dy * it.h) / 2;
      const clampedX = Math.min(Math.max(x, margin), width - it.w - margin);
      // Not enough room sideways (narrow screens): sit above the anchor instead
      // of sliding over the hairline.
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
