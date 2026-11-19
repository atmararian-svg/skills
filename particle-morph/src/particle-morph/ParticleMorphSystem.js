import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { mulberry32 } from './PointCloudGenerator.js';

/**
 * ParticleMorphSystem: owns the N target states of the ONE particle system.
 *
 * - Builds a correspondence chain: model k is paired with model k-1 using the
 *   spatial matching (`matchPointSets`). After that, every particle index has
 *   a target in all N models, and each consecutive pair is spatially coherent.
 * - Uploads each target set, its normals (w = surface tone) and per-transition
 *   metadata to static float textures, once. Nothing is uploaded per frame.
 * - The shaders always see two targets: A = model[i], B = model[i+1] for the
 *   current transition i. `setSequence(P)` (P in 0..N-1) only swaps texture
 *   references. At every integer P all particles sit exactly on model P (the
 *   eased local progress is 0 or 1 and the mid-flight offsets are 0), so the
 *   swap at a segment boundary is seamless.
 */
export class ParticleMorphSystem {
  /**
   * @param {{positions: Float32Array, normals: Float32Array, tone?: Float32Array}[]} clouds  N ≥ 2, equal counts
   * @param {{heights: number[], seed?: number}} opts
   */
  constructor(clouds, opts) {
    if (clouds.length < 2) throw new Error('ParticleMorphSystem: at least two point clouds required');
    const count = clouds[0].positions.length / 3;
    for (const c of clouds) if (c.positions.length / 3 !== count) throw new Error('Point clouds must have equal counts');
    this.count = count;
    this.modelCount = clouds.length;
    this.heights = opts.heights;

    // ── correspondence chain (aligned[k][i] is particle i's target in model k)
    const t0 = performance.now();
    const aligned = [clouds[0]];
    for (let k = 1; k < clouds.length; k++) {
      const prev = aligned[k - 1];
      const cur = clouds[k];
      const { orderA, orderB } = matchPointSets(prev.positions, cur.positions);
      const map = new Uint32Array(count);
      for (let i = 0; i < count; i++) map[orderA[i]] = orderB[i];
      const positions = new Float32Array(count * 3);
      const normals = new Float32Array(count * 3);
      const tone = cur.tone ? new Float32Array(count) : null;
      for (let j = 0; j < count; j++) {
        const m = map[j];
        for (let c = 0; c < 3; c++) {
          positions[j * 3 + c] = cur.positions[m * 3 + c];
          normals[j * 3 + c] = cur.normals[m * 3 + c];
        }
        if (tone) tone[j] = cur.tone[m];
      }
      aligned.push({ positions, normals, tone });
    }
    this.matchTimeMs = performance.now() - t0;

    // ── texture layout
    this.width = Math.ceil(Math.sqrt(count));
    this.height = Math.ceil(count / this.width);
    const texels = this.width * this.height;
    const rand = mulberry32(opts.seed ?? 7);

    // per-particle randoms shared by every transition (scatter direction, cursor radius/strength)
    const shared = new Float32Array(count * 3);
    for (let i = 0; i < shared.length; i++) shared[i] = rand();

    this.targetData = [];
    this.textures = { targets: [], normals: [], metas: [] };
    for (const a of aligned) {
      const t = new Float32Array(texels * 4);
      const n = new Float32Array(texels * 4);
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < 3; c++) {
          t[i * 4 + c] = a.positions[i * 3 + c];
          n[i * 4 + c] = a.normals[i * 3 + c];
        }
        t[i * 4 + 3] = rand();
        n[i * 4 + 3] = a.tone ? a.tone[i] : 1; // surface tone (ink multiplier)
      }
      this.targetData.push(t);
      this.textures.targets.push(makeTexture(t, this.width, this.height));
      this.textures.normals.push(makeTexture(n, this.width, this.height));
    }

    // ── per-transition metadata. x: delay. A travelling wave from the top of the
    // source model (plus noise) sweeps through the object instead of starting everywhere at once.
    const dir = normalize3([0.35, 1.0, 0.25]);
    this.metaData = [];
    this.distanceStats = [];
    for (let s = 0; s < aligned.length - 1; s++) {
      const P = aligned[s].positions;
      const Q = aligned[s + 1].positions;
      let pmin = Infinity, pmax = -Infinity;
      const proj = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const p = P[i * 3] * dir[0] + P[i * 3 + 1] * dir[1] + P[i * 3 + 2] * dir[2];
        proj[i] = p;
        if (p < pmin) pmin = p;
        if (p > pmax) pmax = p;
      }
      const meta = new Float32Array(texels * 4);
      const stats = { mean: 0, max: 0 };
      for (let i = 0; i < count; i++) {
        const spatial = 1 - (proj[i] - pmin) / (pmax - pmin || 1); // top → 0 (leaves first)
        meta[i * 4] = Math.min(1, Math.max(0, spatial * 0.78 + rand() * 0.22));
        meta[i * 4 + 1] = shared[i * 3];
        meta[i * 4 + 2] = shared[i * 3 + 1];
        meta[i * 4 + 3] = shared[i * 3 + 2];
        const d = Math.hypot(P[i * 3] - Q[i * 3], P[i * 3 + 1] - Q[i * 3 + 1], P[i * 3 + 2] - Q[i * 3 + 2]);
        stats.mean += d / count;
        stats.max = Math.max(stats.max, d);
      }
      this.metaData.push(meta);
      this.textures.metas.push(makeTexture(meta, this.width, this.height));
      this.distanceStats.push({ mean: +stats.mean.toFixed(3), max: +stats.max.toFixed(3) });
    }

    // shared morph uniforms (the same objects are referenced by every material)
    this.uniforms = {
      tTargetA: { value: null },
      tTargetB: { value: null },
      tNormalA: { value: null },
      tNormalB: { value: null },
      tMeta: { value: null },
      uProgress: { value: 0 },
      uSpread: { value: 0.45 },
      uScatter: { value: 0.3 },
      uTwist: { value: 0.7 },
    };
    this.segment = -1;
    this.sequence = 0;
    this.setSequence(0);
  }

  setParams({ morphSpread, morphScatter, morphTwist }) {
    if (morphSpread !== undefined) this.uniforms.uSpread.value = Math.min(0.95, Math.max(0, morphSpread));
    if (morphScatter !== undefined) this.uniforms.uScatter.value = morphScatter;
    if (morphTwist !== undefined) this.uniforms.uTwist.value = morphTwist;
  }

  /** Splits a sequence position P (0 … N-1) into transition index + local progress. */
  segmentOf(P) {
    const max = this.modelCount - 1;
    const x = Math.min(max, Math.max(0, P));
    const segment = Math.min(max - 1, Math.floor(x));
    return { segment, local: x - segment };
  }

  /** P = 0 → model 0, P = 1 → model 1, …, P = N-1 → last model. */
  setSequence(P) {
    const { segment, local } = this.segmentOf(P);
    this.sequence = P;
    if (segment !== this.segment) {
      const u = this.uniforms;
      const tx = this.textures;
      u.tTargetA.value = tx.targets[segment];
      u.tTargetB.value = tx.targets[segment + 1];
      u.tNormalA.value = tx.normals[segment];
      u.tNormalB.value = tx.normals[segment + 1];
      u.tMeta.value = tx.metas[segment];
      this.segment = segment;
    }
    this.uniforms.uProgress.value = local;
  }

  /** CPU copies of the data for transition `segment` (used to initialise the simulation). */
  segmentData(segment) {
    return { a: this.targetData[segment], b: this.targetData[segment + 1], meta: this.metaData[segment] };
  }

  /** Visible size of the formation at sequence position P (for the interaction radius). */
  heightAt(P) {
    const { segment, local } = this.segmentOf(P);
    return this.heights[segment] + (this.heights[segment + 1] - this.heights[segment]) * local;
  }

  dispose() {
    for (const list of Object.values(this.textures)) for (const t of list) t.dispose();
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
