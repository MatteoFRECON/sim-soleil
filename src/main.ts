import * as THREE from 'three';
import './style.css';
import { GasSimulation, DEFAULT_PHYSICS, type PhysicsParams } from './sim/GasSimulation';
import { GasPoints } from './render/GasPoints';
import { Core, createStarfield } from './render/Core';
import { Layers } from './render/Layers';
import { PostFX } from './render/PostFX';
import { CameraRig } from './view/CameraRig';
import { modeById, VIEW_MODES, type ViewModeId } from './view/ViewModes';
import { AdaptiveQuality, TIERS } from './perf/AdaptiveQuality';
import { Panel, type ViewSettings, type PerfSettings } from './ui/Panel';
import { Hud } from './ui/Hud';

// ============================================================================
// Assemblage : moteur de rendu, simulation, scène, caméra, interface, boucle.
// ============================================================================

const container = document.getElementById('app')!;
const hud = new Hud((m) => applyMode(m.id));

// --- Moteur de rendu -----------------------------------------------------------
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  hud.showMessage('WebGL 2 indisponible sur ce navigateur : la simulation ne peut pas démarrer.');
  throw e;
}
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.localClippingEnabled = true;
renderer.setClearColor(0x000000, 1);
container.appendChild(renderer.domElement);

// Repli si les textures flottantes ne sont pas rendables (vieux GPU / mobile).
const floatOK = renderer.extensions.has('EXT_color_buffer_float');
const halfFloat = !floatOK;
// Téléphone / tablette (écran tactile principal) : on démarre bas. PC : palier 2 (524 k) ;
// un GPU intégré récent le tient (mesuré : 9 ms/image sur Iris Xe), sinon la qualité
// adaptative redescend en 2 s. (Sur un écran 60 Hz, elle ne peut pas savoir s'il reste
// de la marge, d'où un départ plutôt haut.)
const isSmall = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 700;
const maxTier = halfFloat ? 0 : TIERS.length - 1;
if (halfFloat) hud.showMessage('Textures flottantes indisponibles : mode réduit (65 k parcelles, demi-précision).', 8000);

// --- Réglages ---------------------------------------------------------------------
const phys: PhysicsParams = { ...DEFAULT_PHYSICS };
const view: ViewSettings = {
  mode: 'exterior',
  timeScale: 1,
  paused: false,
  cut: false,
  cutOffset: 0,
  layers: false,
  tracerFraction: 0.015,
  trailLength: 0.94,
  particleSize: 0.012,
  brightness: 1,
  bloom: 1,
  exposure: 1,
};
const perf: PerfSettings = { auto: true, tier: isSmall ? 0 : 2 };

// --- Scène -------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.add(createStarfield());
const core = new Core(phys.coreRadius);
scene.add(core.group);
const layers = new Layers();
scene.add(layers.group);

let sim = new GasSimulation(renderer, TIERS[perf.tier], halfFloat, phys);
const points = new GasPoints(TIERS[perf.tier]);
scene.add(points.points);

const rig = new CameraRig(renderer.domElement, window.innerWidth / window.innerHeight);
const fx = new PostFX(renderer, scene, rig.camera);

let simTime = 0;
/** Fait tourner la simulation un moment pour que la convection soit déjà installée. */
function warmUp(seconds: number) {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    simTime += dt;
    sim.step(dt, simTime);
  }
}
warmUp(4);

// --- Qualité adaptative ---------------------------------------------------------------
const quality = new AdaptiveQuality(perf.tier, maxTier, (tier) => {
  perf.tier = tier;
  rebuildSimulation();
  panel.refresh();
});

function rebuildSimulation() {
  const size = TIERS[perf.tier];
  sim.dispose();
  sim = new GasSimulation(renderer, size, halfFloat, phys);
  points.resize(size);
  warmUp(4);
  if (rig.following) pickParticle();
  resize();
}

// --- Suivi d'une parcelle ------------------------------------------------------------
let followIndex = -1;
const tmpV = new THREE.Vector3();

/** Choisit une parcelle dans la zone convective (là où il se passe quelque chose). */
function pickParticle(): boolean {
  if (halfFloat) return false;
  const rMin = phys.radiativeZone ? phys.radiativeRadius + 0.03 : 0.2;
  for (let i = 0; i < 40; i++) {
    const idx = Math.floor(Math.random() * sim.count);
    sim.readParticle(idx, tmpV);
    const r = tmpV.length();
    if (r > rMin && r < 0.95) {
      followIndex = idx;
      break;
    }
    followIndex = idx;
  }
  const [u, v] = sim.refOf(followIndex);
  points.material.uniforms.uFollowRef.value.set(u, v);
  return true;
}

const followFn = (out: THREE.Vector3) => followIndex >= 0 && sim.followParticle(followIndex, out);

// --- Modes de vue ---------------------------------------------------------------------------
// Valeurs « cibles » vers lesquelles on glisse en douceur (transitions sans saut).
const target = { surfaceEmphasis: 1, coreIntensity: 0, corona: 1 };
const current = { ...target };

function applyMode(id: ViewModeId) {
  const m = modeById(id);
  view.mode = id;
  view.cut = m.cut;
  view.layers = m.layers;
  view.bloom = m.bloom;
  target.surfaceEmphasis = m.surfaceEmphasis;
  target.coreIntensity = m.coreIntensity;
  target.corona = m.corona;
  const u = points.material.uniforms;
  u.uMode.value = m.colorMode;
  u.uTracers.value = m.tracers ? 1 : 0;
  fx.trails.enabled = m.tracers;

  if (id === 'follow') {
    if (pickParticle()) {
      u.uFollow.value = 1;
      rig.setFollow(followFn);
    } else {
      hud.showMessage('Suivi indisponible en mode réduit (demi-précision).', 4000);
    }
  } else {
    u.uFollow.value = 0;
    followIndex = -1;
    if (rig.following) rig.setFollow(null);
    else rig.reframe(true);
  }
  hud.setMode(m);
  panel.refresh();
}

// --- Interface --------------------------------------------------------------------------
const panel = new Panel(view, phys, perf, maxTier, {
  onMode: (id) => applyMode(id),
  onTier: (t) => quality.setManual(t),
  onReset: () => rebuildSimulation(),
  onReframe: () => (rig.following ? applyMode('exterior') : rig.reframe(true)),
  onNextParticle: () => nextParticle(),
  onPhysicsDefaults: () => {
    Object.assign(phys, DEFAULT_PHYSICS);
    panel.refresh();
  },
});

function nextParticle() {
  if (view.mode !== 'follow') applyMode('follow');
  else if (pickParticle()) rig.setFollow(followFn);
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const m = VIEW_MODES.find((v) => v.key === e.key);
  if (m) return applyMode(m.id);
  switch (e.key.toLowerCase()) {
    case 'r':
      if (rig.following) applyMode('exterior');
      else rig.reframe(true);
      break;
    case ' ':
      view.paused = !view.paused;
      panel.refresh();
      e.preventDefault();
      break;
    case 'f':
      nextParticle();
      break;
    case 'h':
      hud.toggleVisible();
      break;
  }
});

// --- Taille de la fenêtre ----------------------------------------------------------------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // pixelRatio plafonné (1,5) : au-delà, le coût explose pour un gain invisible sur des points flous.
  const pr = Math.min(window.devicePixelRatio, perf.tier === 0 ? 1 : 1.5);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
  fx.setSize(w, h, pr);
  rig.resize(w, h);
  const fovRad = THREE.MathUtils.degToRad(rig.camera.fov);
  points.material.uniforms.uViewScale.value = (h * pr) / (2 * Math.tan(fovRad / 2));
}
window.addEventListener('resize', resize);
resize();

// --- Boucle ---------------------------------------------------------------------------------
let last = performance.now();
let rafId = 0;
const cutNormal = new THREE.Vector3();
const approach = (a: number, b: number, k: number) => a + (b - a) * k;

function frame(now: number) {
  rafId = requestAnimationFrame(frame);
  const realDt = Math.min((now - last) / 1000, 0.25);
  last = now;
  quality.auto = perf.auto;
  quality.update(realDt);

  // Simulation : pas plafonné (stabilité), sous-pas quand le temps est accéléré.
  if (!view.paused) {
    const dt = Math.min(realDt, 1 / 30) * view.timeScale;
    const sub = Math.max(1, Math.ceil(view.timeScale));
    for (let i = 0; i < sub; i++) {
      simTime += dt / sub;
      sim.step(dt / sub, simTime);
    }
  }

  // Transitions douces des réglages de mode
  const k = 1 - Math.exp(-realDt * 5);
  current.surfaceEmphasis = approach(current.surfaceEmphasis, target.surfaceEmphasis, k);
  current.coreIntensity = approach(current.coreIntensity, target.coreIntensity, k);
  current.corona = approach(current.corona, target.corona, k);
  fx.bloom.strength = approach(fx.bloom.strength, view.bloom, k);
  core.setIntensity(current.coreIntensity);
  core.setCorona(current.corona);
  core.setRadius(phys.coreRadius);
  core.update(now / 1000);
  renderer.toneMappingExposure = view.exposure;
  (fx.trails.uniforms as { damp: { value: number } }).damp.value = view.trailLength;

  rig.update(realDt);

  // Coupe : la moitié tournée vers la caméra est retirée, elle suit la caméra.
  // Le plan passe par le point visé (le centre, ou la parcelle suivie).
  const aim = rig.controls.target;
  cutNormal.copy(rig.camera.position).sub(aim).normalize();
  const cutOffset = view.cutOffset + aim.dot(cutNormal) + (rig.following ? 0.03 : 0);
  const u = points.material.uniforms;
  u.uCut.value = view.cut ? 1 : 0;
  u.uCutNormal.value.copy(cutNormal);
  u.uCutOffset.value = cutOffset;
  u.uSurfaceEmphasis.value = current.surfaceEmphasis;
  u.uTracerFraction.value = view.tracerFraction;
  // Taille et luminosité normalisées : même rendu global quel que soit le nombre de parcelles.
  const kN = Math.cbrt(262144 / sim.count);
  u.uSize.value = view.particleSize * kN;
  u.uAlpha.value = 0.3 * view.brightness * kN;
  points.setTextures(sim.positionTexture, sim.velocityTexture);

  layers.group.visible = view.layers;
  layers.setRadii(phys.coreRadius, phys.radiativeRadius, phys.radiativeZone);
  layers.setCut(view.cut, cutNormal, cutOffset);

  fx.render();
  hud.updateStats(now, quality.fps, quality.frameMs, sim.count, perf.auto, view.paused, view.timeScale);
}

// Pause complète quand l'onglet est caché (batterie, et pas de gros dt au retour).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
  } else {
    last = performance.now();
    rafId = requestAnimationFrame(frame);
  }
});

applyMode('exterior');
rig.reframe(false);
rafId = requestAnimationFrame(frame);

// Accès de débogage (console) : mesures de convection, palier, mode.
(window as unknown as Record<string, unknown>).__sim = {
  measure: () => sim.measure(),
  setTier: (t: number) => quality.setManual(t),
  setMode: (id: ViewModeId) => applyMode(id),
  get tier() { return perf.tier; },
  get fps() { return quality.fps; },
  get frameMs() { return quality.frameMs; },
  get count() { return sim.count; },
  /** Rend une image tout de suite et renvoie sa luminosité (vérification sans affichage). */
  snapshot: (steps = 0) => {
    for (let i = 0; i < steps; i++) frame(last + 1000 / 60);
    if (steps === 0) frame(performance.now());
    cancelAnimationFrame(rafId);
    if (!document.hidden) rafId = requestAnimationFrame(frame);
    renderer.setRenderTarget(null);
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, lit = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
      sum += l;
      if (l > 20) lit++;
    }
    const c = (x: number, y: number) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
    return { w, h, mean: sum / (w * h), litFraction: lit / (w * h), center: c(w >> 1, h >> 1), edge: c(w >> 1, Math.floor(h * 0.8)) };
  },
  /** Dev : avance de `steps` images puis enregistre une capture dans .shots/<name>.jpg. */
  shot: async (name = 'shot', steps = 30) => {
    for (let i = 0; i < steps; i++) frame(last + 1000 / 60);
    cancelAnimationFrame(rafId);
    if (!document.hidden) rafId = requestAnimationFrame(frame);
    const url = renderer.domElement.toDataURL('image/jpeg', 0.85);
    if (import.meta.env.DEV) await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
    return url.length;
  },
  view,
  phys,
};
