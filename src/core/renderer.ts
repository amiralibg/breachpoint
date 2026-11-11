import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { ExposurePass, VolumetricPass } from './atmosphere';
import type { QualityPreset } from './settings';

/**
 * Owns the WebGL renderer and the post-processing chain:
 *
 *   world (HDR, with a depth texture) -> ambient occlusion -> lit haze (or screen-space sun shafts)
 *   -> first-person weapon -> auto exposure -> bloom -> tone mapping -> anti-aliasing -> grade (split tone, vignette, grain)
 *
 * The weapon is drawn inside the chain, over a cleared depth buffer, so it never clips into walls
 * and still blooms, tone-maps and grades with the world instead of sitting on top of it.
 */

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** World render into its own target, so later passes can read scene depth whatever the composer has swapped. */
class ScenePass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  // The copy also caps the sun disc, which is thousands of times brighter than anything else
  private copy = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() { gl_FragColor = vec4(min(texture2D(tDiffuse, vUv).rgb, vec3(3.0)), 1.0); }
    `,
    depthTest: false,
    depthWrite: false,
  }));

  constructor(private scene: THREE.Scene, private camera: THREE.Camera) {
    super();
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(4, 4),
    });
  }

  override setSize(w: number, h: number): void {
    this.target.setSize(w, h);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    (this.copy.material as THREE.ShaderMaterial).uniforms.tDiffuse.value = this.target.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.copy.render(renderer);
  }

  override dispose(): void {
    this.target.dispose();
    this.copy.dispose();
  }
}

/** The first-person scene, over whatever is in the buffer, with depth cleared first. */
class ViewPass extends Pass {
  constructor(private scene: THREE.Scene, private camera: THREE.Camera) {
    super();
    this.needsSwap = false;
  }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }
}

/**
 * Light shafts: for every pixel, walk toward the sun's place on screen and count how much of the
 * glow around the sun is open sky along the way. Runs at a third of the resolution; the result is
 * added over the frame in HDR, so bloom picks it up.
 */
class SunShaftsPass extends Pass {
  readonly sunUv = new THREE.Vector2(0.5, 0.5);
  readonly color = new THREE.Color(1, 0.72, 0.42);
  amount = 0;
  private rays = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  private march: FullScreenQuad;
  private add: FullScreenQuad;

  constructor(depth: THREE.DepthTexture) {
    super();
    this.march = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: depth }, uSun: { value: this.sunUv }, uAspect: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDepth;
        uniform vec2 uSun;
        uniform float uAspect;
        varying vec2 vUv;
        const int STEPS = 40;
        float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        void main() {
          vec2 toSun = uSun - vUv;
          float jitter = ign(gl_FragCoord.xy);
          float acc = 0.0, wsum = 0.0, w = 1.0;
          for (int i = 0; i < STEPS; i++) {
            float t = (float(i) + jitter) / float(STEPS);
            vec2 uv = vUv + toSun * t;
            vec2 d = (uv - uSun) * vec2(uAspect, 1.0);
            float glow = exp(-dot(d, d) * 48.0);
            float sky = step(0.99999, texture2D(tDepth, clamp(uv, 0.001, 0.999)).x);
            acc += sky * glow * w;
            wsum += w;
            w *= 0.965;
          }
          vec2 pd = toSun * vec2(uAspect, 1.0);
          float r = acc / wsum * exp(-dot(pd, pd) * 0.8);
          gl_FragColor = vec4(vec3(r), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    }));
    this.add = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tRays: { value: this.rays.texture }, uColor: { value: this.color }, uAmount: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tRays;
        uniform vec3 uColor;
        uniform float uAmount;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          float r = texture2D(tRays, vUv).r;
          gl_FragColor = vec4(c.rgb + uColor * (r * uAmount), c.a);
        }
      `,
      depthTest: false,
      depthWrite: false,
    }));
  }

  override setSize(w: number, h: number): void {
    this.rays.setSize(Math.max(2, Math.round(w / 3)), Math.max(2, Math.round(h / 3)));
    (this.march.material as THREE.ShaderMaterial).uniforms.uAspect.value = w / h;
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    if (this.amount > 0.001) {
      renderer.setRenderTarget(this.rays);
      this.march.render(renderer);
    }
    const u = (this.add.material as THREE.ShaderMaterial).uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.uAmount.value = this.amount;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.add.render(renderer);
  }

  override dispose(): void {
    this.rays.dispose();
    this.march.dispose();
    this.add.dispose();
  }
}

/** Display-space finish: gentle contrast, cool shadows against warm highlights, vignette, grain. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.34 },
    uGrain: { value: 0.028 },
    uAspect: { value: 1 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAspect;
    varying vec2 vUv;
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float sh = (1.0 - l) * (1.0 - l);
      c += sh * vec3(-0.010, 0.002, 0.020);
      c *= mix(vec3(1.0), vec3(1.045, 1.0, 0.93), smoothstep(0.35, 1.0, l));
      c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 0.95);
      vec2 q = (vUv - 0.5) * vec2(mix(1.0, uAspect, 0.35), 1.0);
      float v = smoothstep(0.92, 0.28, length(q));
      c *= mix(1.0 - uVignette, 1.0, v);
      float g = hash(gl_FragCoord.xy + fract(uTime) * 311.7) - 0.5;
      c += g * uGrain * (1.0 - 0.6 * l);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

/** Brightness of the shadowed haze: sun intensity times how much of it the air sends to the eye. */
const HAZE_AMOUNT = 3.5;

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private preset: QualityPreset | null = null;
  private shafts: SunShaftsPass | null = null;
  private haze: VolumetricPass | null = null;
  private exposure: ExposurePass | null = null;
  private sunLight: THREE.DirectionalLight | null = null;
  private grade: ShaderPass | null = null;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private sunColor = new THREE.Color(1, 0.72, 0.42);
  private sunStrength = 0;
  private time = 0;

  constructor(
    container: HTMLElement,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private viewScene: THREE.Scene,
    private viewCamera: THREE.PerspectiveCamera,
  ) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 0.72;
    this.gl.shadowMap.enabled = true;
    container.appendChild(this.gl.domElement);
    window.addEventListener('resize', () => this.resize());
  }

  get domElement(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  /** Where the sun is (unit vector toward it), its colour, and how strong its shafts are (0 = off). */
  setSun(dir: THREE.Vector3, color: THREE.Color, shafts: number, light: THREE.DirectionalLight | null = null): void {
    this.sunDir.copy(dir).normalize();
    this.sunColor.copy(color);
    this.sunStrength = shafts;
    this.sunLight = light;
    this.haze?.setSun(light, this.sunDir, this.sunColor);
  }

  /** Adapted scene luminance, for tuning the exposure key from the console. */
  debugLuminance(): number {
    return this.exposure ? this.exposure.debugLuminance(this.gl) : -1;
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
    if (this.composer) {
      for (const pass of this.composer.passes) pass.dispose();
      this.composer.dispose();
    }
    const composer = new EffectComposer(this.gl);
    const scenePass = new ScenePass(this.scene, this.camera);
    composer.addPass(scenePass);
    const depth = scenePass.target.depthTexture!;

    if (p.ambientOcclusion) {
      const size = this.gl.getDrawingBufferSize(new THREE.Vector2());
      // Reads the world pass's depth and rebuilds normals from it: no second render of the scene
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y, { depthTexture: depth });
      ao.blendIntensity = 0.9;
      ao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.5, thickness: 1.5, samples: 12 });
      composer.addPass(ao);
    }
    // Air goes in before the weapon: haze belongs to the world behind the gun, not in front of it
    this.haze = null;
    this.shafts = null;
    if (p.volumetrics > 0 && p.shadows) {
      this.haze = new VolumetricPass(depth, this.camera, p.volumetrics);
      this.haze.amount = HAZE_AMOUNT;
      this.haze.setSun(this.sunLight, this.sunDir, this.sunColor);
      composer.addPass(this.haze);
    } else if (p.sunShafts) {
      this.shafts = new SunShaftsPass(depth);
      composer.addPass(this.shafts);
    }
    composer.addPass(new ViewPass(this.viewScene, this.viewCamera));
    this.exposure = null;
    if (p.autoExposure) {
      this.exposure = new ExposurePass();
      composer.addPass(this.exposure);
    }
    if (p.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.5, 1.1));
    composer.addPass(new OutputPass());
    if (p.antialias === 'smaa') composer.addPass(new SMAAPass());
    else if (p.antialias === 'fxaa') composer.addPass(new FXAAPass());
    if (p.grade) {
      this.grade = new ShaderPass(GradeShader);
      composer.addPass(this.grade);
    } else {
      this.grade = null;
    }

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
    if (this.grade) this.grade.uniforms.uAspect.value = w / h;
  }

  private _p = new THREE.Vector3();
  private _f = new THREE.Vector3();

  render(dt: number): void {
    if (!this.composer) return;
    this.time += dt;
    if (this.shafts) {
      // Sun on screen; shafts fade as it leaves the view and vanish when it is behind the camera
      const facing = this.camera.getWorldDirection(this._f).dot(this.sunDir);
      let amount = 0;
      if (facing > 0.05 && this.sunStrength > 0) {
        const p = this._p.copy(this.sunDir).multiplyScalar(500).add(this.camera.position).project(this.camera);
        this.shafts.sunUv.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
        const off = Math.max(Math.abs(p.x), Math.abs(p.y));
        amount = this.sunStrength * THREE.MathUtils.smoothstep(facing, 0.05, 0.4) * (1 - THREE.MathUtils.smoothstep(off, 1.0, 1.9));
      }
      this.shafts.amount = amount;
      this.shafts.color.copy(this.sunColor);
    }
    if (this.grade) this.grade.uniforms.uTime.value = this.time;
    this.gl.autoClear = true;
    this.composer.render(dt);
  }
}
