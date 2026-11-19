import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { mulberry32 } from './PointCloudGenerator.js';

/**
 * ParticleMorphSystem: owns the two target states of the ONE particle system.
 *
 * - Pairs every particle of cloud A with exactly one point of cloud B
 *   (spatial correspondence, see `matchPointSets`).
 * - Uploads both target sets, their normals and per-particle morph metadata
 *   to static float textures. They never change after creation, so nothing is
 *   uploaded per frame: the morph runs entirely on the GPU.
 * - Exposes the morph uniforms shared by the simulation and the renderer.
 */
export class ParticleMorphSystem {
  /**
   * @param {{positions: Float32Array, normals: Float32Array}} cloudA
   * @param {{positions: Float32Array, normals: Float32Array}} cloudB
   * @param {{heightA: number, heightB: number, seed?: number}} opts
   */
  constructor(cloudA, cloudB, opts) {
    const count = cloudA.positions.length / 3;
    if (cloudB.positions.length / 3 !== count) throw new Error('Point clouds must have equal counts');
    this.count = count;
    this.heightA = opts.heightA;
    this.heightB = opts.heightB;

    const t0 = performance.now();
    const { orderA, orderB } = matchPointSets(cloudA.positions, cloudB.positions);
    this.matchTimeMs = performance.now() - t0;

    // texture layout
    this.width = Math.ceil(Math.sqrt(count));
    this.height = Math.ceil(count / this.width);
    const texels = this.width * this.height;

    const rand = mulberry32(opts.seed ?? 7);
    const tA = new Float32Array(texels * 4);
    const tB = new Float32Array(texels * 4);
    const nA = new Float32Array(texels * 4);
    const nB = new Float32Array(texels * 4);
    const meta = new Float32Array(texels * 4);

    // delay field: a travelling wave from the top of model A (plus noise) so the
    // transformation sweeps through the object instead of starting everywhere at once
    const dir = normalize3([0.35, 1.0, 0.25]);
    let pmin = Infinity, pmax = -Infinity;
    const proj = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = orderA[i] * 3;
      const p = cloudA.positions[a] * dir[0] + cloudA.positions[a + 1] * dir[1] + cloudA.positions[a + 2] * dir[2];
      proj[i] = p;
      if (p < pmin) pmin = p;
      if (p > pmax) pmax = p;
    }

    this.distanceStats = { mean: 0, max: 0 };
    for (let i = 0; i < count; i++) {
      const a = orderA[i] * 3;
      const b = orderB[i] * 3;
      for (let k = 0; k < 3; k++) {
        tA[i * 4 + k] = cloudA.positions[a + k];
        tB[i * 4 + k] = cloudB.positions[b + k];
        nA[i * 4 + k] = cloudA.normals[a + k];
        nB[i * 4 + k] = cloudB.normals[b + k];
      }
      tA[i * 4 + 3] = rand();
      tB[i * 4 + 3] = rand();
      const d = Math.hypot(tA[i * 4] - tB[i * 4], tA[i * 4 + 1] - tB[i * 4 + 1], tA[i * 4 + 2] - tB[i * 4 + 2]);
      this.distanceStats.mean += d / count;
      this.distanceStats.max = Math.max(this.distanceStats.max, d);

      const spatial = 1 - (proj[i] - pmin) / (pmax - pmin || 1); // top → 0 (leaves first)
      meta[i * 4] = Math.min(1, Math.max(0, spatial * 0.78 + rand() * 0.22));
      meta[i * 4 + 1] = rand();
      meta[i * 4 + 2] = rand();
      meta[i * 4 + 3] = rand();
    }

    this.textures = {
      targetA: makeTexture(tA, this.width, this.height),
      targetB: makeTexture(tB, this.width, this.height),
      normalA: makeTexture(nA, this.width, this.height),
      normalB: makeTexture(nB, this.width, this.height),
      meta: makeTexture(meta, this.width, this.height),
    };
    this.initialData = { a: tA, b: tB, meta };

    // shared morph uniforms (the same objects are referenced by every material)
    this.uniforms = {
      tTargetA: { value: this.textures.targetA },
      tTargetB: { value: this.textures.targetB },
      tMeta: { value: this.textures.meta },
      uProgress: { value: 0 },
      uSpread: { value: 0.45 },
      uScatter: { value: 0.3 },
      uTwist: { value: 0.7 },
    };
  }

  setParams({ morphSpread, morphScatter, morphTwist }) {
    if (morphSpread !== undefined) this.uniforms.uSpread.value = Math.min(0.95, Math.max(0, morphSpread));
    if (morphScatter !== undefined) this.uniforms.uScatter.value = morphScatter;
    if (morphTwist !== undefined) this.uniforms.uTwist.value = morphTwist;
  }

  setProgress(p) {
    this.uniforms.uProgress.value = p;
  }

  /** Visible height of the formation at a given progress (for the interaction radius). */
  heightAt(p) {
    return this.heightA + (this.heightB - this.heightA) * p;
  }

  dispose() {
    for (const t of Object.values(this.textures)) t.dispose();
  }
}

function makeTexture(data, w, h) {
  const t = new DataTexture(data, w, h, RGBAFormat, FloatType);
  t.minFilter = t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Spatial correspondence between two equally sized point sets.
 *
 * Recursive balanced bisection (a fast approximation of optimal transport):
 * both sets are split at their own median along the SAME axis (the axis with
 * the largest combined extent), and the halves are paired recursively. The
 * result: neighbourhoods map to neighbourhoods. The top of A goes to the top of B,
 * left to left, and so on, so particles travel in coherent streams instead of
 * crossing chaotically. A local 2-opt pass then swaps partners between nearby
 * pairs whenever that reduces total squared travel.
 *
 * O(n log n). About 40–80 ms for 40k points.
 *
 * @returns {{orderA: Uint32Array, orderB: Uint32Array}} pair i = (A[orderA[i]], B[orderB[i]])
 */
export function matchPointSets(A, B) {
  const n = A.length / 3;
  const ia = new Uint32Array(n);
  const ib = new Uint32Array(n);
  for (let i = 0; i < n; i++) ia[i] = ib[i] = i;
  const rand = mulberry32(1234);

  const stack = [0, n];
  while (stack.length) {
    const hi = stack.pop();
    const lo = stack.pop();
    const len = hi - lo;
    if (len <= 1) continue;

    // combined extents
    let best = 0;
    let bestExt = -1;
    for (let axis = 0; axis < 3; axis++) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let i = lo; i < hi; i++) {
        const va = A[ia[i] * 3 + axis];
        const vb = B[ib[i] * 3 + axis];
        if (va < a0) a0 = va; if (va > a1) a1 = va;
        if (vb < b0) b0 = vb; if (vb > b1) b1 = vb;
      }
      const ext = a1 - a0 + (b1 - b0);
      if (ext > bestExt) { bestExt = ext; best = axis; }
    }
    const mid = lo + (len >> 1);
    quickSelect(ia, A, best, lo, hi - 1, mid, rand);
    quickSelect(ib, B, best, lo, hi - 1, mid, rand);
    stack.push(lo, mid, mid, hi);
  }

  // local 2-opt refinement on neighbouring pairs (array neighbours are spatial neighbours)
  const cost = (i, j) => {
    const a = ia[i] * 3, b = ib[j] * 3;
    const dx = A[a] - B[b], dy = A[a + 1] - B[b + 1], dz = A[a + 2] - B[b + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  for (let pass = 0; pass < 3; pass++) {
    for (const k of [1, 2, 3, 5, 8, 13]) {
      for (let i = 0; i + k < n; i++) {
        const j = i + k;
        if (cost(i, j) + cost(j, i) < cost(i, i) + cost(j, j)) {
          const t = ib[i]; ib[i] = ib[j]; ib[j] = t;
        }
      }
    }
  }
  return { orderA: ia, orderB: ib };
}

function quickSelect(idx, P, axis, left, right, k, rand) {
  while (right > left) {
    const pi = left + Math.floor(rand() * (right - left + 1));
    const pv = P[idx[pi] * 3 + axis];
    let t = idx[pi]; idx[pi] = idx[right]; idx[right] = t;
    let store = left;
    for (let i = left; i < right; i++) {
      if (P[idx[i] * 3 + axis] < pv) {
        t = idx[store]; idx[store] = idx[i]; idx[i] = t;
        store++;
      }
    }
    t = idx[right]; idx[right] = idx[store]; idx[store] = t;
    if (store === k) return;
    if (k < store) right = store - 1;
    else left = store + 1;
  }
}
