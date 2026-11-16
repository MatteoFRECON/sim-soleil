import * as THREE from 'three';

/**
 * Couches de l'étoile en fil de fer : noyau, haut de la zone radiative, surface.
 * Trois grands cercles par sphère (lisible, pas de « filet » qui masque le gaz).
 */
export class Layers {
  readonly group = new THREE.Group();
  readonly clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private core: THREE.Group;
  private radiative: THREE.Group;

  constructor() {
    this.core = this.rings(0xffe08a, 0.5);
    this.radiative = this.rings(0x6fa8ff, 0.45);
    const surface = this.rings(0xff8a3d, 0.35);
    this.group.add(this.core, this.radiative, surface);
    this.group.visible = false;
  }

  private rings(color: number, opacity: number): THREE.Group {
    const g = new THREE.Group();
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      clippingPlanes: [this.clipPlane],
    });
    const rot = [new THREE.Euler(0, 0, 0), new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Euler(0, Math.PI / 2, 0)];
    for (const e of rot) {
      const l = new THREE.Line(geo, mat);
      l.rotation.copy(e);
      g.add(l);
    }
    return g;
  }

  setRadii(core: number, radiative: number, radiativeOn: boolean) {
    this.core.scale.setScalar(core);
    this.radiative.scale.setScalar(radiative);
    this.radiative.visible = radiativeOn;
  }

  /** Même coupe que les particules : on garde dot(p, n) <= offset. */
  setCut(enabled: boolean, normal: THREE.Vector3, offset: number) {
    if (enabled) this.clipPlane.set(normal.clone().negate(), offset);
    else this.clipPlane.set(new THREE.Vector3(0, 0, 1), 1e6);
  }
}
