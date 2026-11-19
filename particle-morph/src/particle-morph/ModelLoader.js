import { BufferAttribute, BufferGeometry, Box3, Matrix4, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const AXES = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };

/**
 * ModelLoader: loads a GLB/GLTF file, bakes every mesh's world transform,
 * merges everything into one indexed BufferGeometry (position + normal only),
 * then orients, centres and scales it into the shared coordinate system.
 *
 * Original proportions are preserved: only a uniform scale is applied.
 */
export class ModelLoader {
  constructor(loader = new GLTFLoader()) {
    this.loader = loader;
  }

  /**
   * @param {object} spec  { url, fitSize, fitAxis: 'x'|'y'|'z'|'max', orient: [[axis, deg], ...] }
   * @returns {Promise<{geometry: BufferGeometry, size: Vector3, triangleCount: number, meshCount: number}>}
   */
  async load(spec, onProgress) {
    const gltf = await this._loadGLTF(spec, onProgress);
    const result = extractGeometry(gltf.scene, spec);
    disposeObject(gltf.scene);
    return result;
  }
}

ModelLoader.prototype._loadGLTF = async function (spec, onProgress) {
  // 1) raw bytes supplied by the host (ArrayBuffer of a .glb)
  if (spec.data) return this.loader.parseAsync(spec.data, '');
  // 2) base64-encoded GLB served as text (for hosts that refuse binary files or
  //    whose CSP blocks data: URIs). Decoded here, so no extra requests are made.
  if (/\.b64(\.txt)?$/i.test(spec.url)) {
    const res = await fetch(spec.url);
    if (!res.ok) throw new Error(`ModelLoader: ${res.status} for ${spec.url}`);
    const bin = atob((await res.text()).replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return this.loader.parseAsync(bytes.buffer, '');
  }
  // 3) regular .glb / .gltf URL
  return this.loader.loadAsync(spec.url, onProgress);
};

export function extractGeometry(root, { fitSize = 2, fitAxis = 'max', orient = [] } = {}) {
  root.updateMatrixWorld(true);

  const parts = [];
  root.traverse((obj) => {
    if (!obj.isMesh || obj.isSkinnedMesh || !obj.geometry?.attributes?.position) return;
    if (obj.geometry.drawRange && obj.geometry.drawRange.count === 0) return;
    let g = obj.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    g.morphAttributes = {};
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(obj.matrixWorld); // also transforms normals with the normal matrix
    parts.push(g);
  });
  if (!parts.length) throw new Error('ModelLoader: no mesh geometry found');

  // ── merge (manual, keeps it independent of BufferGeometryUtils attribute rules)
  let vCount = 0;
  let iCount = 0;
  for (const g of parts) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const indices = new Uint32Array(iCount);
  let vOff = 0;
  let iOff = 0;
  for (const g of parts) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      positions[(vOff + i) * 3] = p.getX(i);
      positions[(vOff + i) * 3 + 1] = p.getY(i);
      positions[(vOff + i) * 3 + 2] = p.getZ(i);
      normals[(vOff + i) * 3] = n.getX(i);
      normals[(vOff + i) * 3 + 1] = n.getY(i);
      normals[(vOff + i) * 3 + 2] = n.getZ(i);
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) indices[iOff + i] = g.index.getX(i) + vOff;
      iOff += g.index.count;
    } else {
      for (let i = 0; i < p.count; i++) indices[iOff + i] = vOff + i;
      iOff += p.count;
    }
    vOff += p.count;
    g.dispose();
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));

  // ── orient
  const rot = new Matrix4();
  const step = new Matrix4();
  for (const [axis, deg] of orient) {
    step.makeRotationAxis(AXES[axis], (deg * Math.PI) / 180);
    rot.premultiply(step);
  }
  geometry.applyMatrix4(rot);

  // ── centre + uniform scale
  const box = new Box3().setFromBufferAttribute(geometry.attributes.position);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const ref = fitAxis === 'max' ? Math.max(size.x, size.y, size.z) : size[fitAxis];
  const s = fitSize / ref;
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(s, s, s);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return {
    geometry,
    size: geometry.boundingBox.getSize(new Vector3()),
    triangleCount: indices.length / 3,
    meshCount: parts.length,
  };
}

function disposeObject(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose();
    }
  });
}
