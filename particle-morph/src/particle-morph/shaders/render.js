import { morphProgress } from './chunks.js';

export const particleVertexShader = /* glsl */ `
${morphProgress}
uniform sampler2D tPosition;
uniform sampler2D tNormalA;
uniform sampler2D tNormalB;
uniform float uSize;
uniform float uSizeVariation;
uniform float uPixelRatio;
uniform float uViewportScale;
uniform float uRefDistance;
uniform float uOpacity;
uniform float uShading;
uniform float uBackfaceFade;
uniform vec3 uLightDir; // view space

attribute vec2 aRef;
attribute vec4 aRand;

varying float vAlpha;

void main(){
  vec4 posH = texture2D(tPosition, aRef);
  float heat = posH.w;
  vec4 mvPos = modelViewMatrix * vec4(posH.xyz, 1.0);
  gl_Position = projectionMatrix * mvPos;

  // normal of the current morph state → tonal shading for a sculpted read
  float e = particleEase(texture2D(tMeta, aRef));
  vec3 n = mix(texture2D(tNormalA, aRef).xyz, texture2D(tNormalB, aRef).xyz, e);
  vec3 nv = normalize(normalMatrix * n + 1e-5);
  float lit = 0.5 + 0.5 * dot(nv, uLightDir);
  float tone = 1.0 - uShading * lit * 0.8;
  float facing = smoothstep(-0.35, 0.35, nv.z);
  tone *= mix(1.0 - uBackfaceFade, 1.0, facing);

  float depth = -mvPos.z;
  float depthCue = clamp(1.0 - (depth - uRefDistance) * 0.28, 0.5, 1.2);

  // size: skewed distribution, most particles fine, a few slightly larger
  float r = aRand.x;
  float sizeMul = mix(1.0, 0.55 + 1.35 * r * r, uSizeVariation);
  float size = uSize * sizeMul * uPixelRatio * uViewportScale * (uRefDistance / depth);
  size *= 1.0 - 0.3 * heat;

  float alpha = uOpacity * (0.35 + 0.65 * aRand.y) * tone * depthCue * (1.0 - 0.3 * heat);
  // sub-pixel points: keep 1px footprint, fade instead (avoids shimmering)
  float minSize = uPixelRatio;
  if (size < minSize) { alpha *= size / minSize; size = minSize; }
  gl_PointSize = size;
  vAlpha = alpha;
}
`;

export const particleFragmentShader = /* glsl */ `
varying float vAlpha;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  float a = vAlpha * (1.0 - smoothstep(0.45, 1.0, d));
  if (a < 0.002) discard;
  // premultiplied white "ink"; blending turns it into the difference look
  gl_FragColor = vec4(vec3(a), a);
}
`;
