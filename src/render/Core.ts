import * as THREE from 'three';

/** Texture de halo radial (dégradé dessiné une fois sur un canvas). */
function radialTexture(stops: [number, string][]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const coreVertex = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vViewDir;
varying vec3 vPos;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  vPos = position;
  gl_Position = projectionMatrix * mv;
}
`;

const coreFragment = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying vec3 vPos;
void main() {
  float fres = 1.0 - max(dot(vNormalV, vViewDir), 0.0);
  // Petites ondulations lumineuses à la surface du noyau (fusion « vivante »).
  float w = sin(vPos.x * 60.0 + uTime * 2.1) * sin(vPos.y * 55.0 - uTime * 1.7) * sin(vPos.z * 50.0 + uTime * 1.3);
  float pulse = 1.0 + 0.12 * sin(uTime * 2.0) + 0.15 * w;
  vec3 hot = vec3(1.0, 0.97, 0.9);
  vec3 rim = vec3(1.0, 0.75, 0.35);
  vec3 col = mix(hot, rim, pow(fres, 1.5)) * 3.2 * pulse;
  gl_FragColor = vec4(col * uIntensity, 1.0);
}
`;

/**
 * Le noyau : sphère émissive pulsante + halo, et la couronne autour du soleil.
 */
export class Core {
  readonly group = new THREE.Group();
  private sphere: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private halo: THREE.Sprite;
  private corona: THREE.Sprite;

  constructor(radius: number) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: coreVertex,
      fragmentShader: coreFragment,
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 } },
      // Additif et sans écriture de profondeur : le noyau brille à travers le gaz
      // et disparaît proprement quand son intensité tombe à 0 (vue extérieure).
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.material);
    this.group.add(this.sphere);

    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture([[0, 'rgba(255,245,220,1)'], [0.25, 'rgba(255,200,120,0.55)'], [1, 'rgba(255,140,40,0)']]),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.group.add(this.halo);

    // Couronne : lueur diffuse autour de la surface (vue extérieure).
    this.corona = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture([[0, 'rgba(0,0,0,0)'], [0.33, 'rgba(0,0,0,0)'], [0.38, 'rgba(255,150,60,0.22)'], [0.5, 'rgba(255,110,30,0.05)'], [0.75, 'rgba(255,80,20,0)']]),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        transparent: true,
      }),
    );
    this.corona.scale.setScalar(5.6);
    this.corona.renderOrder = -1;
    this.group.add(this.corona);

    this.setRadius(radius);
  }

  setRadius(r: number) {
    this.sphere.scale.setScalar(r * 0.75);
    this.halo.scale.setScalar(r * 5);
  }

  /** Intensité du noyau (atténué en vue extérieure, plein en coupe). */
  setIntensity(v: number) {
    this.material.uniforms.uIntensity.value = v;
    (this.halo.material as THREE.SpriteMaterial).opacity = v;
    this.sphere.visible = this.halo.visible = v > 0.01;
  }

  setCorona(v: number) {
    (this.corona.material as THREE.SpriteMaterial).opacity = v;
    this.corona.visible = v > 0.01;
  }

  update(time: number) {
    this.material.uniforms.uTime.value = time;
  }
}

/** Fond étoilé fixe (très peu coûteux, donne une référence de mouvement). */
export function createStarfield(count = 3000): THREE.Points {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    const r = 60;
    pos.set([s * Math.cos(a) * r, s * Math.sin(a) * r, z * r], i * 3);
    const b = 0.3 + Math.random() * 0.7;
    const warm = Math.random();
    col.set([b * (0.85 + 0.15 * warm), b * 0.9, b * (1.0 - 0.2 * warm)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false });
  return new THREE.Points(g, m);
}
