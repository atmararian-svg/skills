import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/**
 * One hairline per skill, shown only while that skill is hovered: it runs from
 * the centre of the prism toward the skill's on-screen direction and stops at
 * the inner surface. It fades in with a gradient — invisible at the centre,
 * brightest where it meets the face — and fades out when the hover ends.
 *
 * Lives in the core's screen-aligned space (not the rotating frame), so it
 * always points at its label, like the core. Its end point is re-found every
 * frame by raycasting the current (rotated, curved) shell from the inside.
 */
export class SkillRays extends THREE.Group {
  constructor(skillDirections, prism, cfg) {
    super();
    this.cfg = cfg;
    // Invisible double-sided twin of the shell for raycasting from inside.
    this.probe = new THREE.Mesh(prism.frontFaces.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    this.probe.visible = false;
    prism.add(this.probe);

    this.rays = new Map();
    for (const [id, dir] of skillDirections) {
      const geometry = new LineSegmentsGeometry().setPositions([0, 0, 0, 0, 0, 0]);
      // Additive blending + black→white vertex colours = transparent→bright gradient.
      geometry.setColors([0, 0, 0, 1, 1, 1]);
      const material = new LineMaterial({
        color: '#ffffff',
        linewidth: cfg.width,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const line = new LineSegments2(geometry, material);
      line.renderOrder = 6;
      line.visible = false;
      this.add(line);
      this.rays.set(id, { line, dir: dir.clone(), level: 0 });
    }

    this._ray = new THREE.Raycaster();
    this._o = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  setResolution(w, h) {
    for (const r of this.rays.values()) r.line.material.resolution.set(w, h);
  }

  update(dt, hoveredId) {
    const k = 1 - Math.exp(-dt * this.cfg.fade);
    this.getWorldPosition(this._o);
    this.getWorldQuaternion(this._q);
    for (const [id, r] of this.rays) {
      r.level += ((id === hoveredId ? 1 : 0) - r.level) * k;
      const visible = r.level > 0.003;
      r.line.visible = visible;
      if (!visible) continue;
      r.line.material.opacity = r.level * this.cfg.opacity;

      this._d.copy(r.dir).applyQuaternion(this._q);
      this._ray.set(this._o, this._d);
      const hit = this._ray.intersectObject(this.probe, false)[0];
      if (!hit) continue;
      const len = hit.distance - this.cfg.inset;
      const arr = r.line.geometry.attributes.instanceStart.data.array;
      arr[3] = r.dir.x * len;
      arr[4] = r.dir.y * len;
      arr[5] = r.dir.z * len;
      r.line.geometry.attributes.instanceStart.data.needsUpdate = true;
      r.line.geometry.computeBoundingSphere();
    }
  }

  dispose() {
    this.probe.removeFromParent();
    this.probe.material.dispose();
    for (const r of this.rays.values()) {
      r.line.geometry.dispose();
      r.line.material.dispose();
    }
  }
}
