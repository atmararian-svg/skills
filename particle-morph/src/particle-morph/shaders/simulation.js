import { morphProgress, morphTarget, pointerInfluence, simplexNoise } from './chunks.js';

// GPUComputationRenderer injects:
//   uniform sampler2D texturePosition; uniform sampler2D textureVelocity;
//   #define resolution vec2(w, h)

/**
 * Velocity pass. Semi-implicit Euler integration of
 *   spring toward the current morph target (stiffness lowered while "hot")
 * + flow noise (ambient, stronger in flight and when disturbed)
 * + cursor repulsion (radial + directional + noise)
 * with exponential damping.
 *
 * texturePosition.w stores "heat": how disturbed a particle is. Heat is set
 * by the cursor and decays over time. While hot, the spring is softer, so
 * dispersed particles drift and keep momentum (a trail), then reconstruct
 * smoothly as they cool down.
 */
export const velocityShader = /* glsl */ `
${simplexNoise}
${morphProgress}
${morphTarget}
${pointerInfluence}
uniform float uDt;
uniform float uTime;
uniform float uStiffness;
uniform float uDamping;
uniform float uNoise;
uniform float uNoiseScale;
uniform float uMorphNoise;
uniform float uRepulsion;
uniform float uDirectional;

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 posH = texture2D(texturePosition, uv);
  vec3 pos = posH.xyz;
  float heat = posH.w;
  vec3 vel = texture2D(textureVelocity, uv).xyz;

  float transit;
  vec3 target = morphTarget(uv, transit);

  float k = uStiffness * mix(1.0, 0.1, heat);
  vec3 acc = (target - pos) * k;

  vec3 flow = flowNoise(pos * uNoiseScale + vec3(0.0, uTime * 0.11, uTime * 0.05));
  acc += flow * uNoise * (0.6 + uMorphNoise * 5.0 * transit + 4.0 * heat);

  vec4 meta = texture2D(tMeta, uv);
  vec3 dir;
  float infl = pointerInfluence(pos, meta.z, dir);
  if (infl > 0.0) {
    float s = 0.45 + 0.9 * meta.w;                       // per-particle strength
    vec3 push = normalize(dir + flow * 0.75);              // noisy radial direction
    acc += push * (uRepulsion * s * infl);
    acc += uPointerVel * (uDirectional * (0.5 + meta.y) * infl);
    acc += flow * (uRepulsion * 0.6 * infl);
  }

  vel += acc * uDt;
  vel *= exp(-uDamping * mix(1.0, 0.45, heat) * uDt);
  gl_FragColor = vec4(vel, 1.0);
}
`;

/** Position pass: integrate, update heat. */
export const positionShader = /* glsl */ `
uniform sampler2D tMeta;
${pointerInfluence}
uniform float uDt;
uniform float uHeatDecay;

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 posH = texture2D(texturePosition, uv);
  vec3 vel = texture2D(textureVelocity, uv).xyz;
  vec3 pos = posH.xyz + vel * uDt;
  vec3 dir;
  float infl = pointerInfluence(pos, texture2D(tMeta, uv).z, dir);
  float heat = max(posH.w * exp(-uHeatDecay * uDt), min(1.0, infl * 1.4));
  gl_FragColor = vec4(pos, heat);
}
`;
