import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Post-traitement : rendu -> traînées (mode Traceurs) -> bloom -> tone mapping.
 */
export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly trails: AfterimagePass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.trails = new AfterimagePass(0.94);
    this.trails.enabled = false;
    this.composer.addPass(this.trails);
    this.bloom = new UnrealBloomPass(size, 0.9, 0.55, 0.55);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render() {
    this.composer.render();
  }
}
