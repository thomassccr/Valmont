/**
 * Shaders du noyau.
 *
 * Écrits à la main plutôt que composés de matériaux standards : le rendu
 * recherché — volumétrique, holographique, dense — ne s'obtient pas avec un
 * matériau PBR. Chaque shader est additif et sans éclairage : la lumière ne
 * vient pas d'une source, elle vient du noyau lui-même.
 */

/** Bruit simplex 3D (Ashima / Gustavson). Base de toute la turbulence. */
export const SIMPLEX_3D = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}

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
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
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

/**
 * Bruit de rotationnel (curl noise) : produit un champ de vitesse à
 * divergence nulle. C'est ce qui donne aux particules un mouvement de
 * fluide en circulation plutôt qu'une agitation aléatoire — la différence
 * entre « ça vibre » et « ça vit ».
 */
vec3 curlNoise(vec3 p){
  const float e = 0.1;
  float n1 = snoise(vec3(p.x, p.y + e, p.z));
  float n2 = snoise(vec3(p.x, p.y - e, p.z));
  float n3 = snoise(vec3(p.x, p.y, p.z + e));
  float n4 = snoise(vec3(p.x, p.y, p.z - e));
  float n5 = snoise(vec3(p.x + e, p.y, p.z));
  float n6 = snoise(vec3(p.x - e, p.y, p.z));
  return normalize(vec3(
    (n1 - n2) - (n3 - n4),
    (n3 - n4) - (n5 - n6),
    (n5 - n6) - (n1 - n2)
  ));
}
`;

/** Palette commune : braise profonde → ambre → or → éclat blanc, reflet bleu. */
export const PALETTE = /* glsl */ `
vec3 corePalette(float t){
  vec3 ember  = vec3(0.42, 0.09, 0.01);
  vec3 amber  = vec3(0.95, 0.36, 0.04);
  vec3 gold   = vec3(1.00, 0.72, 0.26);
  vec3 white  = vec3(1.00, 0.95, 0.82);
  vec3 c = mix(ember, amber, smoothstep(0.0, 0.45, t));
  c = mix(c, gold, smoothstep(0.4, 0.78, t));
  c = mix(c, white, smoothstep(0.82, 1.0, t));
  return c;
}
/** Reflet froid sur les bords : ce qui empêche le doré de virer au jaune plat. */
vec3 coldRim(float f){
  return vec3(0.16, 0.34, 0.62) * f;
}
`;

// ── Particules ─────────────────────────────────────────────────────────────

export const PARTICLES_VERTEX = /* glsl */ `
${SIMPLEX_3D}

attribute float aSeed;
attribute float aShell;   // 0 = cœur, 1 = surface externe
attribute float aSize;

uniform float uTime;
uniform float uEnergy;
uniform float uTurbulence;
uniform float uConvergence;
uniform float uPulse;
uniform float uBreathing;
uniform float uPixelRatio;

varying float vIntensity;
varying float vShell;
varying float vSpeed;

void main(){
  vec3 dir = normalize(position);
  float baseRadius = length(position);

  // Respiration lente : le noyau se dilate et se contracte en permanence.
  float breath = 1.0 + 0.045 * sin(uTime * 0.55 * uBreathing + aSeed * 6.28);

  // Pulsation vocale : concentrée sur les couches externes, pour que la
  // surface vibre sans que le cœur se déforme.
  float voice = 1.0 + uPulse * 0.22 * (0.35 + aShell);

  // Convergence : à l'écoute, tout se rassemble vers le centre.
  float gather = mix(1.0, 0.62, uConvergence * (0.4 + aShell * 0.6));

  float radius = baseRadius * breath * voice * gather;

  // Circulation de fluide. L'échelle spatiale varie par coquille : les
  // couches externes tourbillonnent plus large que le cœur.
  float scale = mix(1.6, 0.7, aShell);
  vec3 flow = curlNoise(dir * scale + vec3(0.0, uTime * 0.11, aSeed * 0.4));
  float amplitude = uTurbulence * mix(0.06, 0.28, aShell) * (0.5 + uEnergy);
  // À l'écoute, la turbulence s'éteint : le noyau se fige et écoute.
  amplitude *= (1.0 - uConvergence * 0.8);

  vec3 displaced = dir * radius + flow * amplitude;

  // Bandes de densité : donne l'impression de couches et d'épaisseur.
  float band = sin(displaced.y * 9.0 + uTime * 0.4) * 0.5 + 0.5;

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);

  vSpeed = length(flow) * amplitude;
  vShell = aShell;
  // Le cœur brille bien plus fort que la périphérie. Sans ce gradient, la
  // sphère est une poussière homogène ; avec lui, elle a un foyer — et c'est
  // ce foyer qui donne l'impression que l'intelligence est *à l'intérieur*.
  float coreBoost = 1.0 + pow(1.0 - aShell, 2.0) * 2.6;
  vIntensity = (0.35 + 0.65 * uEnergy) * (0.5 + 0.5 * band) * (0.6 + 0.4 * aSeed) * coreBoost;

  // Atténuation par la distance : les particules du fond sont plus petites,
  // c'est ce qui crée la profondeur volumétrique.
  gl_PointSize = aSize * uPixelRatio * (1.0 + uEnergy * 0.9) * (14.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const PARTICLES_FRAGMENT = /* glsl */ `
${PALETTE}

varying float vIntensity;
varying float vShell;
varying float vSpeed;

uniform float uEnergy;

void main(){
  // Point circulaire à bord doux : un carré se verrait immédiatement.
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float alpha = smoothstep(0.5, 0.02, d);
  // Halo interne : chaque particule a son propre petit cœur brillant.
  alpha *= 0.35 + 0.65 * smoothstep(0.42, 0.0, d);

  // La couleur suit la vitesse : les particules rapides chauffent vers le
  // blanc. C'est ce qui rend la réflexion visible sans changer la palette.
  float heat = clamp(vIntensity + vSpeed * 2.2, 0.0, 1.0);
  vec3 color = corePalette(heat);
  color += coldRim(pow(vShell, 3.0) * 0.5 * (0.4 + uEnergy));

  gl_FragColor = vec4(color, alpha * vIntensity * (0.45 + uEnergy * 0.55));
}
`;

// ── Anneaux holographiques ─────────────────────────────────────────────────

export const RING_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

void main(){
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const RING_FRAGMENT = /* glsl */ `
${PALETTE}

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

uniform float uTime;
uniform float uEnergy;
uniform float uMachinery;
uniform float uSegments;   // nombre de graduations sur l'anneau
uniform float uOpacity;
uniform float uTint;       // 0 = or, 1 = froid

void main(){
  // Graduations : l'anneau n'est pas un tore lisse mais un instrument gradué.
  float ticks = fract(vUv.x * uSegments - uTime * uMachinery * 0.35);
  float tick = smoothstep(0.0, 0.06, ticks) * smoothstep(0.32, 0.14, ticks);

  // Graduations majeures, plus rares et plus lumineuses.
  float major = fract(vUv.x * uSegments / 8.0 - uTime * uMachinery * 0.044);
  float majorTick = smoothstep(0.0, 0.02, major) * smoothstep(0.1, 0.04, major);

  // Balayage : une onde lumineuse parcourt l'anneau en continu.
  float sweep = pow(max(0.0, sin(vUv.x * 6.2831 - uTime * (0.4 + uMachinery))), 12.0);

  // Fresnel : les bords vus de biais s'allument. C'est ce qui donne
  // l'aspect « projection » plutôt que « objet solide ».
  float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 2.2);

  float intensity = (tick * 0.5 + majorTick * 1.1 + sweep * 0.9 + fresnel * 0.7) * (0.35 + uEnergy);

  vec3 color = mix(corePalette(0.55 + intensity * 0.4), vec3(0.35, 0.6, 1.0), uTint * 0.7);
  float alpha = clamp(intensity, 0.0, 1.0) * uOpacity;

  if (alpha < 0.006) discard;
  gl_FragColor = vec4(color * intensity, alpha);
}
`;

// ── Engrenages ─────────────────────────────────────────────────────────────

export const GEAR_FRAGMENT = /* glsl */ `
${PALETTE}

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

uniform float uTime;
uniform float uEnergy;
uniform float uMachinery;
uniform float uTeeth;
uniform float uOpacity;

void main(){
  // L'anneau est vu comme un disque plan : on repasse en polaire pour
  // dessiner une denture et des rayons.
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float angle = atan(p.y, p.x);

  float spin = uTime * uMachinery * 0.6;

  // Denture : créneaux réguliers sur la couronne externe.
  float teeth = step(0.5, fract((angle + spin) * uTeeth / 6.2831));
  float crown = smoothstep(0.86, 0.9, r) * smoothstep(1.0, 0.96, r);
  float toothed = crown * mix(0.25, 1.0, teeth);

  // Rayons internes.
  float spokes = step(0.82, fract((angle - spin * 0.6) * 6.0 / 6.2831));
  float hub = smoothstep(0.3, 0.34, r) * smoothstep(0.78, 0.7, r);
  float spoked = hub * spokes * 0.55;

  // Moyeu.
  float center = smoothstep(0.2, 0.16, r) * 0.6;

  float intensity = (toothed + spoked + center) * (0.3 + uEnergy * 0.8) * uMachinery;
  if (intensity < 0.01) discard;

  vec3 color = corePalette(0.5 + intensity * 0.35);
  gl_FragColor = vec4(color * intensity, intensity * uOpacity);
}
`;

// ── Circuits volumétriques ─────────────────────────────────────────────────

export const CIRCUIT_FRAGMENT = /* glsl */ `
${SIMPLEX_3D}
${PALETTE}

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vPosition;

uniform float uTime;
uniform float uEnergy;
uniform float uCircuitry;
uniform float uOpacity;

void main(){
  vec3 p = normalize(vPosition);

  // Lignes de circuit : on isole les lignes de niveau d'un champ de bruit.
  // Le résultat ressemble à des pistes gravées, sans texture ni géométrie.
  float field = snoise(p * 3.4 + vec3(0.0, uTime * 0.06, 0.0));
  float lines = 1.0 - smoothstep(0.0, 0.045, abs(fract(field * 5.0) - 0.5));

  // Deuxième couche, plus fine et plus lente : donne de la profondeur.
  float fine = snoise(p * 8.0 - vec3(uTime * 0.03));
  float fineLines = 1.0 - smoothstep(0.0, 0.02, abs(fract(fine * 9.0) - 0.5));

  // Impulsions qui parcourent les pistes — les « données » qui circulent.
  float pulse = pow(max(0.0, sin(field * 12.0 - uTime * 2.2)), 22.0);

  // Fresnel fort : les circuits n'apparaissent que sur la silhouette, ce qui
  // suggère une coque de verre plutôt qu'une sphère peinte.
  float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 3.0);

  float intensity = (lines * 0.55 + fineLines * 0.3 + pulse * 1.2) * fresnel * uCircuitry * (0.4 + uEnergy);
  if (intensity < 0.008) discard;

  vec3 color = corePalette(0.45 + intensity * 0.5) + coldRim(fresnel * 0.4);
  gl_FragColor = vec4(color * intensity, intensity * uOpacity);
}
`;

export const CIRCUIT_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vPosition;

void main(){
  vUv = uv;
  vPosition = position;
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}
`;

// ── Halo volumétrique ──────────────────────────────────────────────────────

export const GLOW_FRAGMENT = /* glsl */ `
${PALETTE}

varying vec3 vNormal;
varying vec3 vViewDir;

uniform float uEnergy;
uniform float uPulse;

void main(){
  // Fresnel très serré : le halo ne doit exister que sur la silhouette.
  // Une puissance faible étale la lueur sur toute la sphère et produit une
  // grosse boule brune opaque qui avale la scène — le halo doit se deviner,
  // pas dominer.
  float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 6.0);
  float intensity = fresnel * (0.2 + uEnergy * 0.45 + uPulse * 0.25);
  vec3 color = corePalette(0.4 + uEnergy * 0.4);
  gl_FragColor = vec4(color, intensity * 0.16);
}
`;
