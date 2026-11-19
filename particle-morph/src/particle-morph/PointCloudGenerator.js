/**
 * PointCloudGenerator: area-uniform surface sampling with blue-noise thinning.
 *
 * 1. Stratified, area-weighted triangle sampling produces `count * oversample`
 *    candidates (every square unit of surface gets the same expected number).
 * 2. Weighted Sample Elimination (Yuksel 2015) removes the most crowded
 *    candidates until exactly `count` remain. This removes clumps and fills
 *    holes without the "grid" look of a lattice.
 * 3. A small jitter along the normal and tangent gives the organic stippled grain.
 *
 * Runs once per model on the CPU at load time (≈100–400 ms for 40k points).
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {import('three').BufferGeometry} geometry indexed, with position + normal
 * @param {number} count
 * @param {{oversample?: number, jitter?: number, seed?: number}} opts
 * @returns {{positions: Float32Array, normals: Float32Array, area: number, count: number}}
 */
export function samplePointCloud(geometry, count, opts = {}) {
  const { oversample = 3, jitter = 0.004, seed = 1 } = opts;
  const rand = mulberry32(seed);
  const P = geometry.attributes.position.array;
  const N = geometry.attributes.normal.array;
  const I = geometry.index.array;
  const triCount = I.length / 3;

  // ── triangle areas → cumulative distribution
  const cdf = new Float64Array(triCount);
  let total = 0;
  for (let t = 0; t < triCount; t++) {
    const a = I[t * 3] * 3;
    const b = I[t * 3 + 1] * 3;
    const c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    total += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    cdf[t] = total;
  }

  // ── stratified candidates (u increases monotonically → walk the CDF, no binary search)
  const M = Math.max(count, Math.ceil(count * Math.max(1, oversample)));
  const cp = new Float32Array(M * 3);
  const cn = new Float32Array(M * 3);
  const toneInfo = geometry.attributes.toneSrc ? { tri: new Uint32Array(M), bary: new Float32Array(M * 2) } : null;
  let t = 0;
  for (let i = 0; i < M; i++) {
    const u = ((i + rand()) / M) * total;
    while (t < triCount - 1 && cdf[t] < u) t++;
    const a = I[t * 3] * 3;
    const b = I[t * 3 + 1] * 3;
    const c = I[t * 3 + 2] * 3;
    const s = Math.sqrt(rand());
    const r2 = rand();
    const w0 = 1 - s, w1 = s * (1 - r2), w2 = s * r2;
    if (toneInfo) { toneInfo.tri[i] = t; toneInfo.bary[i * 2] = w1; toneInfo.bary[i * 2 + 1] = w2; }
    for (let k = 0; k < 3; k++) {
      cp[i * 3 + k] = P[a + k] * w0 + P[b + k] * w1 + P[c + k] * w2;
      cn[i * 3 + k] = N[a + k] * w0 + N[b + k] * w1 + N[c + k] * w2;
    }
    let nx = cn[i * 3], ny = cn[i * 3 + 1], nz = cn[i * 3 + 2];
    let len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) {
      // degenerate interpolated normal → face normal
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      len = Math.hypot(nx, ny, nz) || 1;
    }
    cn[i * 3] = nx / len; cn[i * 3 + 1] = ny / len; cn[i * 3 + 2] = nz / len;
  }

  const keep = M > count ? weightedSampleElimination(cp, M, count, total) : identity(count);

  // ── shuffle the kept order (texture layout should carry no spatial pattern)
  for (let i = keep.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = keep[i]; keep[i] = keep[j]; keep[j] = tmp;
  }

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const inkGain = geometry.userData.inkGain ?? 1;
  const tone = toneInfo || inkGain !== 1 ? new Float32Array(count).fill(1) : null;
  for (let i = 0; i < count; i++) {
    const k = keep[i];
    if (toneInfo) tone[i] = surfaceTone(geometry, I, toneInfo.tri[k], toneInfo.bary[k * 2], toneInfo.bary[k * 2 + 1]);
    const nx = cn[k * 3], ny = cn[k * 3 + 1], nz = cn[k * 3 + 2];
    // gaussian-ish offset along the normal + a smaller tangential wobble
    const along = (rand() + rand() + rand() - 1.5) * jitter;
    positions[i * 3] = cp[k * 3] + nx * along + (rand() - 0.5) * jitter * 0.5;
    positions[i * 3 + 1] = cp[k * 3 + 1] + ny * along + (rand() - 0.5) * jitter * 0.5;
    positions[i * 3 + 2] = cp[k * 3 + 2] + nz * along + (rand() - 0.5) * jitter * 0.5;
    normals[i * 3] = nx; normals[i * 3 + 1] = ny; normals[i * 3 + 2] = nz;
  }
  if (tone) {
    // textured models: keep the overall ink level in line with untextured ones (only contrast changes),
    // then apply the model's ink gain (compensates large, face-on surfaces that look sparse)
    let mean = 0;
    for (let i = 0; i < count; i++) mean += tone[i] / count;
    const k = (toneInfo ? 0.92 / Math.max(mean, 0.05) : 1) * inkGain;
    for (let i = 0; i < count; i++) tone[i] = Math.min(2.5, Math.max(0.12, tone[i] * k));
  }
  return { positions, normals, tone, area: total, count };
}

/**
 * Ink multiplier for a surface point: 1 on dark surfaces, down to (1 - 0.75·amount) on white ones.
 * brightness = material colour × base-colour texture (sampled at the interpolated UV).
 */
function surfaceTone(geometry, I, t, w1, w2) {
  const amount = geometry.userData.textureInk;
  const src = geometry.attributes.toneSrc.array;
  const uv = geometry.attributes.toneUv.array;
  const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
  const w0 = 1 - w1 - w2;
  const texId = src[a * 2];
  let lum = src[a * 2 + 1];
  if (texId >= 0) {
    const tex = geometry.userData.toneTextures[texId];
    let u = uv[a * 2] * w0 + uv[b * 2] * w1 + uv[c * 2] * w2;
    let v = uv[a * 2 + 1] * w0 + uv[b * 2 + 1] * w1 + uv[c * 2 + 1] * w2;
    const m = tex.matrix; // 3x3 column-major uv transform (offset / repeat / rotation)
    const tu = m[0] * u + m[3] * v + m[6];
    const tv = m[1] * u + m[4] * v + m[7];
    u = tex.repeat ? tu - Math.floor(tu) : Math.min(1, Math.max(0, tu));
    v = tex.repeat ? tv - Math.floor(tv) : Math.min(1, Math.max(0, tv));
    if (tex.flipY) v = 1 - v;
    const x = Math.min(tex.w - 1, Math.floor(u * tex.w));
    const y = Math.min(tex.h - 1, Math.floor(v * tex.h));
    lum *= tex.lum[y * tex.w + x];
  }
  const darkness = 1 - Math.min(1, Math.max(0, lum));
  return 1 - amount * 0.75 * (1 - darkness);
}

function identity(n) {
  const a = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

/** Yuksel, "Sample Elimination for Generating Poisson Disk Sample Sets" (2015). */
function weightedSampleElimination(P, M, N, area) {
  const rmax = Math.sqrt(area / (2 * Math.sqrt(3) * N));
  const R = 2 * rmax;
  const R2 = R * R;

  // bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < M; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const cell = Math.max(R, ext / 160);
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const ny = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
  const cells = nx * ny * nz;

  // counting sort of candidates into cells
  const cellOf = new Uint32Array(M);
  const cellStart = new Uint32Array(cells + 1);
  for (let i = 0; i < M; i++) {
    const cx = Math.floor((P[i * 3] - minX) / cell);
    const cy = Math.floor((P[i * 3 + 1] - minY) / cell);
    const cz = Math.floor((P[i * 3 + 2] - minZ) / cell);
    const c = cx + nx * (cy + ny * cz);
    cellOf[i] = c;
    cellStart[c + 1]++;
  }
  for (let c = 0; c < cells; c++) cellStart[c + 1] += cellStart[c];
  const fill = cellStart.slice(0, cells);
  const items = new Uint32Array(M);
  for (let i = 0; i < M; i++) items[fill[cellOf[i]]++] = i;

  // neighbour lists (CSR) — two passes
  const forEachNeighbour = (i, fn) => {
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
    const cx = Math.floor((px - minX) / cell);
    const cy = Math.floor((py - minY) / cell);
    const cz = Math.floor((pz - minZ) / cell);
    for (let z = Math.max(0, cz - 1); z <= Math.min(nz - 1, cz + 1); z++)
      for (let y = Math.max(0, cy - 1); y <= Math.min(ny - 1, cy + 1); y++)
        for (let x = Math.max(0, cx - 1); x <= Math.min(nx - 1, cx + 1); x++) {
          const c = x + nx * (y + ny * z);
          for (let s = cellStart[c], e = cellStart[c + 1]; s < e; s++) {
            const j = items[s];
            if (j === i) continue;
            const dx = P[j * 3] - px, dy = P[j * 3 + 1] - py, dz = P[j * 3 + 2] - pz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < R2) fn(j, d2);
          }
        }
  };

  const nbStart = new Uint32Array(M + 1);
  for (let i = 0; i < M; i++) {
    let n = 0;
    forEachNeighbour(i, () => n++);
    nbStart[i + 1] = nbStart[i] + n;
  }
  const nbIdx = new Uint32Array(nbStart[M]);
  const nbW = new Float32Array(nbStart[M]);
  const w = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    let o = nbStart[i];
    let sum = 0;
    forEachNeighbour(i, (j, d2) => {
      const q = 1 - Math.sqrt(d2) / R;
      const q2 = q * q, q4 = q2 * q2;
      const wij = q4 * q4; // alpha = 8
      nbIdx[o] = j;
      nbW[o++] = wij;
      sum += wij;
    });
    w[i] = sum;
  }

  // max-heap on weights
  const heap = new Uint32Array(M);
  const where = new Int32Array(M);
  let size = M;
  for (let i = 0; i < M; i++) { heap[i] = i; where[i] = i; }
  const swap = (a, b) => {
    const ha = heap[a], hb = heap[b];
    heap[a] = hb; heap[b] = ha; where[hb] = a; where[ha] = b;
  };
  const siftDown = (k) => {
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      let m = k;
      if (l < size && w[heap[l]] > w[heap[m]]) m = l;
      if (r < size && w[heap[r]] > w[heap[m]]) m = r;
      if (m === k) return;
      swap(k, m);
      k = m;
    }
  };
  for (let k = (size >> 1) - 1; k >= 0; k--) siftDown(k);

  while (size > N) {
    const top = heap[0];
    swap(0, size - 1);
    size--;
    where[top] = -1;
    siftDown(0);
    for (let o = nbStart[top], e = nbStart[top + 1]; o < e; o++) {
      const j = nbIdx[o];
      const pos = where[j];
      if (pos < 0) continue;
      w[j] -= nbW[o];
      siftDown(pos); // weight only decreases
    }
  }
  return heap.slice(0, N);
}
