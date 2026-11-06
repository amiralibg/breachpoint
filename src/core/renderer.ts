import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import type { QualityPreset } from './settings';

/**
 * Owns the WebGL renderer and the post-processing chain.
 * The world renders through the composer; the first-person weapon renders
 * afterwards in its own scene so it never clips into walls.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private preset: QualityPreset | null = null;

  constructor(
    container: HTMLElement,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private viewScene: THREE.Scene,
    private viewCamera: THREE.PerspectiveCamera,
  ) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.AgXToneMapping;
    this.gl.toneMappingExposure = 0.9;
    this.gl.shadowMap.enabled = true;
    container.appendChild(this.gl.domElement);
    window.addEventListener('resize', () => this.resize());
  }

  get domElement(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  apply(preset: QualityPreset): void {
    this.preset = preset;
    const pr = Math.min(window.devicePixelRatio * preset.pixelRatioScale, preset.maxPixelRatio);
    this.gl.setPixelRatio(pr);
    this.gl.shadowMap.enabled = preset.shadows;
    // PCFSoftShadowMap was removed from three; softness comes from shadow.radius instead.
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.shadowMap.needsUpdate = true;

    // Materials must recompile when the shadow setup changes.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });

    this.buildComposer();
    this.resize();
  }

  private buildComposer(): void {
    const p = this.preset!;
    this.composer?.dispose();
    const composer = new EffectComposer(this.gl);
    composer.addPass(new RenderPass(this.scene, this.camera));

    if (p.ambientOcclusion) {
      const size = this.gl.getDrawingBufferSize(new THREE.Vector2());
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, samples: 12 });
      // GTAO renders a normal/depth pre-pass with an override material, which turns
      // transparent sprites and decals into opaque squares. Hide them for that pass.
      const pass = ao as unknown as { _overrideVisibility(): void; _visibilityCache: THREE.Object3D[] };
      const original = pass._overrideVisibility.bind(pass);
      pass._overrideVisibility = () => {
        original();
        this.scene.traverse((o) => {
          if (o.visible && ((o as THREE.Sprite).isSprite || o.userData.noAO)) {
            o.visible = false;
            pass._visibilityCache.push(o);
          }
        });
      };
      composer.addPass(ao);
    }
    if (p.bloom) {
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.18, 0.4, 0.92));
    }
    composer.addPass(new OutputPass());
    if (p.antialias === 'smaa') composer.addPass(new SMAAPass());
    else if (p.antialias === 'fxaa') composer.addPass(new FXAAPass());

    this.composer = composer;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
    this.gl.setSize(w, h);
    this.composer?.setPixelRatio(this.gl.getPixelRatio());
    this.composer?.setSize(w, h);
  }

  render(dt: number): void {
    if (!this.composer) return;
    this.gl.autoClear = true;
    this.composer.render(dt);
    // Weapon on top, sharing tone mapping with the world.
    this.gl.autoClear = false;
    this.gl.clearDepth();
    this.gl.render(this.viewScene, this.viewCamera);
  }
}
