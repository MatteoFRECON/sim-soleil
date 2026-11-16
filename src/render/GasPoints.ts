import * as THREE from 'three';

/**
 * Affichage des parcelles de gaz : un THREE.Points dont le vertex shader lit
 * directement les textures de la simulation (aucune copie CPU).
 */

const vertexShader = /* glsl */ `
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uSize;          // taille d'une parcelle (unités monde)
uniform float uViewScale;     // hauteur écran (px) / (2 tan(fov/2))
uniform float uAlpha;         // luminosité globale (normalisée par le nombre de parcelles)
uniform int uMode;            // 0 corps noir, 1 carte de chaleur, 2 vitesse radiale
uniform float uSurfaceEmphasis;
uniform float uCut;           // 1 = coupe active
uniform vec3 uCutNormal;
uniform float uCutOffset;
uniform float uCutSlab;       // épaisseur de la tranche mise en valeur
uniform float uCutBack;       // luminosité du gaz derrière la tranche
uniform float uTracers;      // 1 = mode traceurs
uniform float uTracerFraction;
uniform float uVelScale;
uniform float uFollow;        // 1 = mettre en évidence la parcelle suivie
uniform vec2 uFollowRef;
uniform float uTexel;

attribute vec2 reference;
varying vec3 vColor;
varying float vAlpha;

// Couleur « corps noir » approchée sur l'échelle log : surface rouge-orangé -> cœur blanc bleuté.
vec3 blackbody(float t) {
  vec3 c0 = vec3(1.0, 0.25, 0.03);
  vec3 c1 = vec3(1.0, 0.58, 0.15);
  vec3 c2 = vec3(1.0, 0.86, 0.52);
  vec3 c3 = vec3(0.88, 0.93, 1.0);
  vec3 c = t < 0.33 ? mix(c0, c1, t / 0.33)
         : t < 0.7  ? mix(c1, c2, (t - 0.33) / 0.37)
         :            mix(c2, c3, (t - 0.7) / 0.3);
  return c * (0.45 + 1.8 * t * t);
}

// Carte de chaleur : bleu nuit -> violet -> orange -> jaune-blanc.
vec3 heatmap(float t) {
  vec3 c0 = vec3(0.06, 0.08, 0.45);
  vec3 c1 = vec3(0.55, 0.12, 0.65);
  vec3 c2 = vec3(1.0, 0.42, 0.08);
  vec3 c3 = vec3(1.0, 0.97, 0.7);
  return t < 0.33 ? mix(c0, c1, t / 0.33)
       : t < 0.7  ? mix(c1, c2, (t - 0.33) / 0.37)
       :            mix(c2, c3, (t - 0.7) / 0.3);
}

void main() {
  vec4 P = texture2D(tPos, reference);
  vec4 V = texture2D(tVel, reference);
  vec3 pos = P.xyz;
  float T = P.w;
  float r = length(pos);
  float seed = V.w;

  // Coupe : on retire la moitié tournée vers la caméra.
  float depth = uCutOffset - dot(pos, uCutNormal); // distance derrière le plan de coupe
  bool followed = uFollow > 0.5 && all(lessThan(abs(reference - uFollowRef), vec2(uTexel * 0.5)));
  if (uCut > 0.5 && depth < 0.0 && !followed) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float size = uSize * (0.6 + 0.8 * fract(seed * 7.31));
  float a = uAlpha;
  vec3 col;

  if (uMode == 1) {
    col = heatmap(T) * 1.2;
  } else if (uMode == 2) {
    vec3 n = r > 1e-5 ? pos / r : vec3(0.0);
    float s = clamp(dot(V.xyz, n) * uVelScale, -1.0, 1.0);
    vec3 up = vec3(1.0, 0.3, 0.12);
    vec3 down = vec3(0.15, 0.45, 1.0);
    col = s > 0.0 ? mix(vec3(0.35), up, s) : mix(vec3(0.35), down, -s);
    col *= 1.3;
    a *= 0.25 + 1.6 * abs(s);
  } else {
    col = blackbody(T);
    // Vue extérieure : la surface domine, l'intérieur est atténué.
    a *= mix(1.0, 0.06 + 1.5 * smoothstep(0.82, 1.0, r), uSurfaceEmphasis);
  }

  // Coupe : la tranche collée au plan est nette, le reste de la demi-sphère
  // n'est qu'un fond discret (sinon tout s'additionne en une boule blanche).
  if (uCut > 0.5) a *= mix(1.0, uCutBack, smoothstep(0.0, uCutSlab, depth));

  if (uTracers > 0.5) {
    bool tracer = seed < uTracerFraction;
    size *= tracer ? 2.2 : 1.0;
    a *= tracer ? 5.0 : 0.1;
  }

  if (followed) {
    size = uSize * 9.0;
    col = vec3(0.3, 1.6, 0.7);
    a = 1.0;
  }

  float ps = size * uViewScale / max(-mv.z, 0.01);
  // En dessous d'un pixel : on garde 1 px mais on atténue (pas de scintillement).
  a *= clamp(ps * ps, 0.0, 1.0);
  gl_PointSize = clamp(ps, 1.0, 64.0);
  vColor = col;
  vAlpha = a;
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  float fall = exp(-r2 * 3.0);
  gl_FragColor = vec4(vColor, vAlpha * fall);
}
`;

export class GasPoints {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private geometry: THREE.BufferGeometry;

  constructor(size: number) {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        tPos: { value: null },
        tVel: { value: null },
        uSize: { value: 0.012 },
        uViewScale: { value: 800 },
        uAlpha: { value: 0.3 },
        uMode: { value: 0 },
        uSurfaceEmphasis: { value: 0 },
        uCut: { value: 0 },
        uCutNormal: { value: new THREE.Vector3(0, 0, 1) },
        uCutOffset: { value: 0 },
        uCutSlab: { value: 0.12 },
        uCutBack: { value: 0.1 },
        uTracers: { value: 0 },
        uTracerFraction: { value: 0.02 },
        uVelScale: { value: 4 },
        uFollow: { value: 0 },
        uFollowRef: { value: new THREE.Vector2(-1, -1) },
        uTexel: { value: 1 / size },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    this.geometry = GasPoints.buildGeometry(size);
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false; // positions calculées sur GPU
  }

  /** Une coordonnée de texture par parcelle ; les positions viennent du GPU. */
  private static buildGeometry(size: number): THREE.BufferGeometry {
    const n = size * size;
    const ref = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      ref[i * 2] = ((i % size) + 0.5) / size;
      ref[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('reference', new THREE.BufferAttribute(ref, 2));
    return g;
  }

  /** Changement de palier de qualité : nouvelle géométrie. */
  resize(size: number) {
    this.geometry.dispose();
    this.geometry = GasPoints.buildGeometry(size);
    this.points.geometry = this.geometry;
    this.material.uniforms.uTexel.value = 1 / size;
  }

  setTextures(pos: THREE.Texture, vel: THREE.Texture) {
    this.material.uniforms.tPos.value = pos;
    this.material.uniforms.tVel.value = vel;
  }
}
