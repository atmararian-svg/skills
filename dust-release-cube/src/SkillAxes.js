import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/**
 * Hairlines from just outside the shell to each label anchor — the same
 * muted-gray / white-when-active language as the existing section.
 */
export class SkillAxes extends THREE.Group {
  constructor(skills, cfg) {
    super();
    this.cfg = cfg;
    this.visible = cfg.show;
    this.muted = new THREE.Color(cfg.color);
    this.bright = new THREE.Color(cfg.activeColor);
    this.lines = new Map();

    for (const s of skills) {
      const d = new THREE.Vector3(...s.direction).normalize();
      const a = d.clone().multiplyScalar(cfg.start);
      const b = d.clone().multiplyScalar(s.distance - cfg.endInset);
      const geometry = new LineSegmentsGeometry().setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
      const material = new LineMaterial({ color: this.muted.clone(), linewidth: cfg.width, transparent: true, depthWrite: false });
      const line = new LineSegments2(geometry, material);
      line.renderOrder = 4;
      this.add(line);
      this.lines.set(s.id, line);
    }
  }

  setResolution(w, h) {
    for (const l of this.lines.values()) l.material.resolution.set(w, h);
  }

  update(dt, lit) {
    const k = 1 - Math.exp(-dt * 10);
    for (const [id, line] of this.lines) {
      line.material.color.lerp(lit.has(id) ? this.bright : this.muted, k);
    }
  }

  dispose() {
    for (const l of this.lines.values()) {
      l.geometry.dispose();
      l.material.dispose();
    }
  }
}
