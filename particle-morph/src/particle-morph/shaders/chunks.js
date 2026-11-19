// Shared GLSL chunks.

// Simplex 3D noise: Ian McEwan, Ashima Arts (MIT License).
export const simplexNoise = /* glsl */ `
vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
vec3 flowNoise(vec3 p){
  return vec3(snoise(p), snoise(p + vec3(31.416, -12.7, 7.1)), snoise(p + vec3(-17.23, 45.1, -3.9)));
}
`;

// Per-particle morph progress: identical in the simulation and the renderer.
export const morphProgress = /* glsl */ `
uniform sampler2D tMeta;
uniform float uProgress;
uniform float uSpread;
float easeInOutCubic(float t){
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
}
// x: delay (0..1), returns eased local progress
float particleEase(vec4 meta){
  float t = clamp((uProgress - meta.x * uSpread) / max(1.0 - uSpread, 1e-3), 0.0, 1.0);
  return easeInOutCubic(t);
}
`;

// Morph target: where a particle wants to be at the current progress.
// Straight interpolation plus an outward bulge and a swirl that peak mid-flight,
// so the object visibly dissolves and re-forms instead of cross-fading.
export const morphTarget = /* glsl */ `
uniform sampler2D tTargetA;
uniform sampler2D tTargetB;
uniform float uScatter;
uniform float uTwist;
vec3 morphTarget(vec2 uv, out float transit){
  vec4 meta = texture2D(tMeta, uv);
  float e = particleEase(meta);
  transit = sin(3.14159265 * e);
  vec3 a = texture2D(tTargetA, uv).xyz;
  vec3 b = texture2D(tTargetB, uv).xyz;
  vec3 p = mix(a, b, e);
  vec3 rnd = meta.yzw * 2.0 - 1.0;
  vec3 outward = p / max(length(p), 1e-3);
  p += (outward * 0.7 + rnd * 0.5) * (uScatter * transit);
  float ang = uTwist * transit * (0.65 + 0.7 * meta.y);
  float cs = cos(ang), sn = sin(ang);
  p.xz = mat2(cs, -sn, sn, cs) * p.xz;
  return p;
}
`;

// Cursor influence (shared by the velocity and position passes).
export const pointerInfluence = /* glsl */ `
uniform vec3 uPointer;
uniform vec3 uPointerVel;
uniform float uPointerStrength;
uniform float uRadius;
// rnd: per-particle random 0..1, so the dispersed region has a ragged, organic edge
float pointerInfluence(vec3 pos, float rnd, out vec3 dir){
  vec3 d = pos - uPointer;
  float dist = length(d);
  dir = d / max(dist, 1e-4);
  float f = clamp(1.0 - dist / (uRadius * (0.55 + 0.7 * rnd)), 0.0, 1.0);
  return f * f * (3.0 - 2.0 * f) * uPointerStrength;
}
`;
