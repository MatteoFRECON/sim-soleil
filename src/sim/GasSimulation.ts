import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import commonGlsl from './shaders/common.glsl?raw';
import velocityGlsl from './shaders/velocity.glsl?raw';
import positionGlsl from './shaders/position.glsl?raw';

type Variable = ReturnType<GPUComputationRenderer['addVariable']>;

/** Nombre de couches du profil radial de température moyenne. */
const PROFILE_BINS = 64;

/** Paramètres physiques (tous réglables dans le panneau). */
export interface PhysicsParams {
  gravity: number;
  coreMass: number;
  gasMass: number;
  coreRadius: number;
  heat: number;
  cool: number;
  diffusion: number;
  buoyancy: number;
  cellSpeed: number;
  cellScale: number;
  cellEvolve: number;
  turbulence: number;
  turbScale: number;
  radiativeZone: boolean;
  radiativeRadius: number;
  maxSpeed: number;
}

export const DEFAULT_PHYSICS: PhysicsParams = {
  gravity: 1.0,
  coreMass: 1.0,
  gasMass: 0.5,
  coreRadius: 0.15,
  heat: 2.0,
  cool: 2.5,
  diffusion: 0.12,
  buoyancy: 0.4,
  cellSpeed: 0.16,
  cellScale: 1.8,
  cellEvolve: 0.06,
  turbulence: 0.05,
  turbScale: 5.0,
  radiativeZone: true,
  radiativeRadius: 0.7,
  maxSpeed: 2.0,
};

/** Profil d'équilibre, identique à teq() de common.glsl (pour les mesures). */
export function teq(r: number): number {
  if (r < 0.7) {
    const x = Math.min(Math.max(r / 0.7, 0), 1);
    const s = x * x * (3 - 2 * x);
    return 1 + (0.75 - 1) * s;
  }
  return 0.75 * (1 - Math.pow(Math.min(Math.max((r - 0.7) / 0.3, 0), 1), 1.3));
}

export interface ConvectionStats {
  particles: number;
  hotCount: number;
  coldCount: number;
  meanVrHot: number;   // vitesse radiale moyenne des parcelles plus chaudes que l'équilibre
  meanVrCold: number;  // idem pour les plus froides
  meanRadius: number;
  fractionConvective: number;
  density: number[];
}

/**
 * Simulation du gaz entièrement sur GPU (GPGPU, textures en ping-pong).
 * Une parcelle de gaz = un texel ; size × size parcelles.
 */
export class GasSimulation {
  readonly size: number;
  readonly count: number;
  private gpu: GPUComputationRenderer;
  private posVar: Variable;
  private velVar: Variable;
  private readBuf = new Float32Array(4);

  constructor(
    private renderer: THREE.WebGLRenderer,
    size: number,
    private halfFloat: boolean,
    private params: PhysicsParams,
  ) {
    this.size = size;
    this.count = size * size;
    this.gpu = new GPUComputationRenderer(size, size, renderer);
    if (halfFloat) this.gpu.setDataType(THREE.HalfFloatType);

    const pos0 = this.gpu.createTexture();
    const vel0 = this.gpu.createTexture();
    // createTexture() alloue toujours un Float32Array (même en mode half-float).
    this.fillInitial(pos0.image.data as unknown as Float32Array, vel0.image.data as unknown as Float32Array);

    this.posVar = this.gpu.addVariable('texturePosition', commonGlsl + positionGlsl, pos0);
    this.velVar = this.gpu.addVariable('textureVelocity', commonGlsl + velocityGlsl, vel0);
    this.gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    this.gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);

    const f = (v: number) => ({ value: v });
    Object.assign(this.velVar.material.uniforms, {
      uDt: f(0), uTime: f(0), uGravity: f(1), uCoreMass: f(1), uGasMass: f(0.5),
      uBuoyancy: f(0), uCellSpeed: f(0), uCellScale: f(1), uCellEvolve: f(0),
      uTurbulence: f(0), uTurbScale: f(1), uRadR: f(0), uMaxSpeed: f(1), uCoreR: f(0.15),
    });
    Object.assign(this.posVar.material.uniforms, {
      uDt: f(0), uHeat: f(0), uCool: f(0), uDiffusion: f(0), uCoreR: f(0.15), uRadR: f(0),
    });

    const err = this.gpu.init();
    if (err !== null) throw new Error('GPGPU : ' + err);

    // --- Profil radial de température moyenne (référence de la poussée d'Archimède)
    // Chaque parcelle ajoute (T, 1) dans la case de son rayon (mélange additif) :
    // moyenne = somme / nombre. Une seule passe de points dans une texture 64 × 1.
    this.useProfile = !halfFloat && renderer.extensions.has('EXT_float_blend');
    this.profileRT = new THREE.WebGLRenderTarget(PROFILE_BINS, 1, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });
    const ref = new Float32Array(this.count * 2);
    for (let i = 0; i < this.count; i++) {
      ref[i * 2] = ((i % size) + 0.5) / size;
      ref[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size;
    }
    this.profileGeo = new THREE.BufferGeometry();
    this.profileGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.count * 3), 3));
    this.profileGeo.setAttribute('reference', new THREE.BufferAttribute(ref, 2));
    this.profileMat = new THREE.ShaderMaterial({
      uniforms: { tPos: { value: null } },
      vertexShader: /* glsl */ `
        uniform sampler2D tPos;
        attribute vec2 reference;
        varying float vT;
        void main() {
          vec4 P = texture2D(tPos, reference);
          float bin = min(floor(length(P.xyz) * ${PROFILE_BINS}.0), ${PROFILE_BINS - 1}.0);
          gl_Position = vec4((bin + 0.5) / ${PROFILE_BINS}.0 * 2.0 - 1.0, 0.0, 0.0, 1.0);
          gl_PointSize = 1.0;
          vT = P.w;
        }`,
      fragmentShader: /* glsl */ `
        varying float vT;
        void main() { gl_FragColor = vec4(vT, 1.0, 0.0, 1.0); }`,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
    });
    const pts = new THREE.Points(this.profileGeo, this.profileMat);
    pts.frustumCulled = false;
    this.profileScene.add(pts);
    Object.assign(this.velVar.material.uniforms, {
      uProfile: { value: this.profileRT.texture },
      uUseProfile: { value: this.useProfile ? 1 : 0 },
    });
  }

  private useProfile: boolean;
  private profileRT: THREE.WebGLRenderTarget;
  private profileGeo: THREE.BufferGeometry;
  private profileMat: THREE.ShaderMaterial;
  private profileScene = new THREE.Scene();
  private profileCam = new THREE.Camera();

  /** Recalcule le profil T moyen(r) à partir des positions actuelles. */
  private updateProfile() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    this.profileMat.uniforms.tPos.value = this.positionTexture;
    r.setRenderTarget(this.profileRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.render(this.profileScene, this.profileCam);
    r.setClearColor(0x000000, 1);
    r.setRenderTarget(prev);
  }

  /** Répartition uniforme dans la boule, température d'équilibre, vitesse nulle. */
  private fillInitial(pos: Float32Array, vel: Float32Array) {
    for (let i = 0; i < this.count; i++) {
      // Direction uniforme sur la sphère + rayon ∝ racine cubique (densité uniforme)
      const z = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      const r = Math.cbrt(Math.random()) * 0.99;
      pos[i * 4] = s * Math.cos(a) * r;
      pos[i * 4 + 1] = s * Math.sin(a) * r;
      pos[i * 4 + 2] = z * r;
      pos[i * 4 + 3] = teq(r);
      vel[i * 4] = 0;
      vel[i * 4 + 1] = 0;
      vel[i * 4 + 2] = 0;
      vel[i * 4 + 3] = Math.random(); // graine (taille, traceurs…)
    }
  }

  /** Un pas de simulation. */
  step(dt: number, time: number) {
    const p = this.params;
    const radR = p.radiativeZone ? p.radiativeRadius : 0;
    const vu = this.velVar.material.uniforms;
    vu.uDt.value = dt;
    vu.uTime.value = time;
    vu.uGravity.value = p.gravity;
    vu.uCoreMass.value = p.coreMass;
    vu.uGasMass.value = p.gasMass;
    vu.uBuoyancy.value = p.buoyancy;
    vu.uCellSpeed.value = p.cellSpeed;
    vu.uCellScale.value = p.cellScale;
    vu.uCellEvolve.value = p.cellEvolve;
    vu.uTurbulence.value = p.turbulence;
    vu.uTurbScale.value = p.turbScale;
    vu.uRadR.value = radR;
    vu.uMaxSpeed.value = p.maxSpeed;
    vu.uCoreR.value = p.coreRadius;
    const pu = this.posVar.material.uniforms;
    pu.uDt.value = dt;
    pu.uHeat.value = p.heat;
    pu.uCool.value = p.cool;
    pu.uDiffusion.value = p.diffusion;
    pu.uCoreR.value = p.coreRadius;
    pu.uRadR.value = radR;
    if (this.useProfile) this.updateProfile();
    this.gpu.compute();
  }

  get positionTexture(): THREE.Texture {
    return this.gpu.getCurrentRenderTarget(this.posVar).texture;
  }

  get velocityTexture(): THREE.Texture {
    return this.gpu.getCurrentRenderTarget(this.velVar).texture;
  }

  private asyncBuf = new Float32Array(4);
  private asyncPending = false;
  private asyncIndex = -1;
  private asyncHas = false;
  private asyncPos = new THREE.Vector3();

  /**
   * Position d'une parcelle pour le mode Suivi, SANS bloquer le GPU : lecture
   * asynchrone (résultat avec 1-2 images de retard, lissé par la caméra).
   * Une lecture synchrone par image coûtait ~7 ms sur un GPU intégré.
   */
  followParticle(index: number, out: THREE.Vector3): boolean {
    if (this.halfFloat) return false;
    if (index !== this.asyncIndex) {
      this.asyncIndex = index;
      this.asyncHas = this.readParticle(index, this.asyncPos); // première position : lecture directe
    }
    if (!this.asyncPending) {
      this.asyncPending = true;
      const idx = index;
      const rt = this.gpu.getCurrentRenderTarget(this.posVar) as THREE.WebGLRenderTarget;
      this.renderer
        .readRenderTargetPixelsAsync(rt, index % this.size, Math.floor(index / this.size), 1, 1, this.asyncBuf)
        .then(() => {
          if (idx === this.asyncIndex) {
            this.asyncPos.set(this.asyncBuf[0], this.asyncBuf[1], this.asyncBuf[2]);
            this.asyncHas = true;
          }
        })
        .catch(() => undefined)
        .finally(() => (this.asyncPending = false));
    }
    out.copy(this.asyncPos);
    return this.asyncHas;
  }

  /** Lit la position d'UNE parcelle, en bloquant (choix d'une parcelle). false en half-float. */
  readParticle(index: number, out: THREE.Vector3): boolean {
    if (this.halfFloat) return false;
    const x = index % this.size;
    const y = Math.floor(index / this.size);
    const rt = this.gpu.getCurrentRenderTarget(this.posVar) as THREE.WebGLRenderTarget;
    this.renderer.readRenderTargetPixels(rt, x, y, 1, 1, this.readBuf);
    out.set(this.readBuf[0], this.readBuf[1], this.readBuf[2]);
    return true;
  }

  /** Coordonnées de texture d'une parcelle (pour la mettre en évidence). */
  refOf(index: number): [number, number] {
    const x = index % this.size;
    const y = Math.floor(index / this.size);
    return [(x + 0.5) / this.size, (y + 0.5) / this.size];
  }

  /**
   * Mesure de contrôle (débogage, lente : relit tout le GPU).
   * Convection correcte ⇔ parcelles chaudes qui montent (vr > 0), froides qui descendent (vr < 0).
   */
  measure(): ConvectionStats | null {
    if (this.halfFloat) return null;
    const n = this.count;
    const pos = new Float32Array(n * 4);
    const vel = new Float32Array(n * 4);
    const rtP = this.gpu.getCurrentRenderTarget(this.posVar) as THREE.WebGLRenderTarget;
    const rtV = this.gpu.getCurrentRenderTarget(this.velVar) as THREE.WebGLRenderTarget;
    this.renderer.readRenderTargetPixels(rtP, 0, 0, this.size, this.size, pos);
    this.renderer.readRenderTargetPixels(rtV, 0, 0, this.size, this.size, vel);
    const r0 = this.params.radiativeZone ? this.params.radiativeRadius : 0;
    // Température moyenne par couche (même référence que la poussée d'Archimède)
    const sT = new Float64Array(PROFILE_BINS), sN = new Float64Array(PROFILE_BINS);
    const binOf = (r: number) => Math.min(PROFILE_BINS - 1, Math.floor(r * PROFILE_BINS));
    for (let i = 0; i < n; i++) {
      const b = binOf(Math.hypot(pos[i * 4], pos[i * 4 + 1], pos[i * 4 + 2]));
      sT[b] += pos[i * 4 + 3];
      sN[b]++;
    }
    const ref = (r: number) => (sN[binOf(r)] > 3 ? sT[binOf(r)] / sN[binOf(r)] : teq(r));
    let hot = 0, cold = 0, vrHot = 0, vrCold = 0, sumR = 0, conv = 0;
    const bins = new Array(10).fill(0);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 4], y = pos[i * 4 + 1], z = pos[i * 4 + 2], T = pos[i * 4 + 3];
      const r = Math.hypot(x, y, z);
      sumR += r;
      bins[Math.min(9, Math.floor(r * 10))]++;
      if (r < r0 + 0.03 || r > 0.97) continue;
      conv++;
      const vr = (vel[i * 4] * x + vel[i * 4 + 1] * y + vel[i * 4 + 2] * z) / r;
      const d = T - ref(r);
      if (d > 0.05) { hot++; vrHot += vr; } else if (d < -0.05) { cold++; vrCold += vr; }
    }
    return {
      particles: n,
      hotCount: hot,
      coldCount: cold,
      meanVrHot: hot ? vrHot / hot : 0,
      meanVrCold: cold ? vrCold / cold : 0,
      meanRadius: sumR / n,
      fractionConvective: conv / n,
      // Densité relative par couche de 0,1 (1 = densité uniforme attendue)
      density: bins.map((b, k) => +(b / n / (((k + 1) ** 3 - k ** 3) / 1000)).toFixed(2)),
    };
  }

  dispose() {
    this.gpu.dispose();
    this.profileRT.dispose();
    this.profileGeo.dispose();
    this.profileMat.dispose();
  }
}
