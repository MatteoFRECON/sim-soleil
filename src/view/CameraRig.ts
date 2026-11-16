import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const SUN_RADIUS = 1;
const FILL = 0.8; // la sphère occupe ~80 % de la plus petite dimension

interface Tween {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  duration: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Caméra : cadrage automatique, bornes de zoom, transitions animées, suivi d'une parcelle.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private tween: Tween | null = null;
  /** Vrai tant que l'utilisateur n'a pas bougé la caméra depuis le dernier cadrage. */
  private framed = true;
  private followFn: ((out: THREE.Vector3) => boolean) | null = null;
  private followTarget = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(dom: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.005, 300);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false; // jamais de déplacement hors du soleil
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.8;
    this.controls.addEventListener('start', () => {
      this.framed = false;
      this.tween = null;
      this.controls.enabled = true;
    });
    this.camera.position.set(0.9, 0.5, 1).normalize().multiplyScalar(this.fitDistance());
    this.updateBounds();
  }

  /** Distance telle que la sphère occupe FILL de la plus petite dimension de l'écran. */
  fitDistance(): number {
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const half = Math.min(vHalf, hHalf);
    return SUN_RADIUS / Math.sin(half * FILL);
  }

  private updateBounds() {
    const fit = this.fitDistance();
    this.controls.minDistance = this.followFn ? 0.08 : 0.4 * SUN_RADIUS;
    this.controls.maxDistance = fit * 3;
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updateBounds();
    if (this.framed && !this.tween && !this.followFn) this.reframe(false);
  }

  /** Recadre le soleil entier, centré, en gardant la direction de vue actuelle. */
  reframe(animated = true, distanceFactor = 1) {
    const dir = this.tmp.copy(this.camera.position).sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    // Partir du centre du soleil (et pas d'une parcelle suivie)
    const pos = dir.multiplyScalar(this.fitDistance() * distanceFactor);
    this.flyTo(pos, new THREE.Vector3(0, 0, 0), animated ? 0.8 : 0);
    this.framed = distanceFactor === 1;
  }

  flyTo(pos: THREE.Vector3, target: THREE.Vector3, duration: number) {
    if (duration <= 0) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.tween = null;
      this.controls.update();
      return;
    }
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos: pos.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      t: 0,
      duration,
    };
  }

  /** Active le suivi : getPos remplit la position de la parcelle (false = indisponible). */
  setFollow(getPos: ((out: THREE.Vector3) => boolean) | null) {
    this.followFn = getPos;
    this.updateBounds();
    if (getPos && getPos(this.followTarget)) {
      // Se placer à 0,45 de la parcelle, du côté de la caméra actuelle.
      const dir = this.tmp.copy(this.camera.position).sub(this.followTarget).normalize();
      this.flyTo(this.followTarget.clone().addScaledVector(dir, 0.45), this.followTarget.clone(), 0.9);
      this.framed = false;
    } else if (!getPos) {
      this.reframe(true);
    }
  }

  get following(): boolean {
    return this.followFn !== null;
  }

  update(dt: number) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(tw.t + dt / tw.duration, 1);
      const k = easeInOut(tw.t);
      // En suivi, la cible bouge pendant la transition : on vise sa position courante.
      if (this.followFn && this.followFn(this.followTarget)) {
        tw.toPos.add(this.tmp.copy(this.followTarget).sub(tw.toTarget));
        tw.toTarget.copy(this.followTarget);
      }
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      this.controls.enabled = false;
      if (tw.t >= 1) {
        this.tween = null;
        this.controls.enabled = true;
      }
      this.camera.lookAt(this.controls.target);
      return;
    }
    if (this.followFn && this.followFn(this.followTarget)) {
      // On déplace caméra + cible du même vecteur (lissé) : l'orbite reste libre.
      const delta = this.tmp.copy(this.followTarget).sub(this.controls.target).multiplyScalar(Math.min(1, dt * 8));
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
    this.controls.update();
  }
}
