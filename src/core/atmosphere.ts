import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Air and eye: the two things that make a lit scene read as a place.
 *
 * VolumetricPass marches each pixel's view ray through a layer of ground haze and asks the sun's
 * shadow map whether each step is lit, so buildings cut dark wedges out of the glowing air and
 * gaps between them throw shafts. ExposurePass measures how bright the frame is and eases the
 * exposure toward it, the way an eye opens up in shade and stops down facing the sun.
 */

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class VolumetricPass extends Pass {
  /** Overall strength of the lit haze (0 = off). */
  amount = 1;
  readonly color = new THREE.Color(1, 0.7, 0.42);
  private light: THREE.DirectionalLight | null = null;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private rays = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  private march: FullScreenQuad;
  private add: FullScreenQuad;

  constructor(depth: THREE.DepthTexture, private camera: THREE.PerspectiveCamera, steps: number) {
    super();
    this.march = new FullScreenQuad(new THREE.ShaderMaterial({
      defines: { STEPS: Math.max(4, Math.round(steps)) },
      uniforms: {
        tDepth: { value: depth },
        tShadow: { value: null },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uSunDir: { value: this.sunDir },
        /** Haze per metre at ground level, and the height over which it thins to a third. */
        uDensity: { value: 0.014 },
        uHeight: { value: 7 },
        uMaxDist: { value: 85 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        precision highp sampler2DShadow;
        uniform sampler2D tDepth;
        uniform sampler2DShadow tShadow;
        uniform mat4 uInvProj, uCamWorld, uShadowMatrix;
        uniform vec3 uCamPos, uSunDir;
        uniform float uDensity, uHeight, uMaxDist;
        varying vec2 vUv;
        float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        void main() {
          float d = texture2D(tDepth, vUv).x;
          vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          vec3 wp = (uCamWorld * vec4(vp.xyz / vp.w, 1.0)).xyz;
          vec3 ray = wp - uCamPos;
          float dist = length(ray);
          vec3 dir = ray / max(dist, 1e-4);
          dist = min(dist, uMaxDist);
          // Haze scatters mostly forward: it glows looking toward the sun, barely at all away from it
          float c = dot(dir, uSunDir);
          float g = 0.62;
          float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
          float phase = mix(1.0, hg, 0.8) * 0.0796;
          float ds = dist / float(STEPS);
          float t = ds * ign(gl_FragCoord.xy);
          float acc = 0.0, trans = 1.0;
          for (int i = 0; i < STEPS; i++) {
            vec3 p = uCamPos + dir * t;
            float dens = uDensity * exp(-max(p.y, 0.0) / uHeight);
            vec4 sc = uShadowMatrix * vec4(p, 1.0);
            sc.xyz /= sc.w;
            float lit = 1.0;
            if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
              lit = texture(tShadow, vec3(sc.xy, sc.z - 0.0015));
            }
            acc += lit * dens * trans * ds;
            trans *= exp(-dens * ds);
            t += ds;
          }
          gl_FragColor = vec4(acc * phase, 0.0, 0.0, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    }));
    this.add = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tRays: { value: this.rays.texture },
        uColor: { value: this.color },
        uAmount: { value: 0 },
        uTexel: { value: new THREE.Vector2() },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tRays;
        uniform vec3 uColor;
        uniform float uAmount;
        uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          // The march is jittered per pixel; a small tent filter turns the grain into smooth air
          float r = texture2D(tRays, vUv).r * 0.28;
          r += (texture2D(tRays, vUv + uTexel * vec2(1.5, 0.5)).r + texture2D(tRays, vUv + uTexel * vec2(-0.5, 1.5)).r
            + texture2D(tRays, vUv + uTexel * vec2(-1.5, -0.5)).r + texture2D(tRays, vUv + uTexel * vec2(0.5, -1.5)).r) * 0.18;
          gl_FragColor = vec4(c.rgb + uColor * (r * uAmount), c.a);
        }
      `,
      depthTest: false,
      depthWrite: false,
    }));
  }

  setSun(light: THREE.DirectionalLight | null, dir: THREE.Vector3, color: THREE.Color): void {
    this.light = light;
    this.sunDir.copy(dir).normalize();
    this.color.copy(color);
  }

  override setSize(w: number, h: number): void {
    const rw = Math.max(2, Math.round(w / 2)), rh = Math.max(2, Math.round(h / 2));
    this.rays.setSize(rw, rh);
    (this.add.material as THREE.ShaderMaterial).uniforms.uTexel.value.set(1 / rw, 1 / rh);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const shadow = this.light?.shadow;
    const depthTex = shadow?.map?.depthTexture ?? null;
    const on = this.amount > 0.001 && !!depthTex;
    if (on && shadow) {
      const u = (this.march.material as THREE.ShaderMaterial).uniforms;
      u.tShadow.value = depthTex;
      u.uShadowMatrix.value.copy(shadow.matrix);
      u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
      u.uCamWorld.value.copy(this.camera.matrixWorld);
      u.uCamPos.value.setFromMatrixPosition(this.camera.matrixWorld);
      renderer.setRenderTarget(this.rays);
      this.march.render(renderer);
    }
    const a = (this.add.material as THREE.ShaderMaterial).uniforms;
    a.tDiffuse.value = readBuffer.texture;
    a.uAmount.value = on ? this.amount : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.add.render(renderer);
  }

  override dispose(): void {
    this.rays.dispose();
    this.march.dispose();
    this.add.dispose();
  }
}

export class ExposurePass extends Pass {
  /** Scene brightness the exposure aims the frame at (log-average luminance, linear). */
  key = 0.11;
  /** How far the exposure follows the scene: 0 = fixed, 1 = every view ends up equally bright. */
  strength = 0.55;
  min = 0.7;
  max = 1.7;
  /** Seconds to close most of the gap. Eyes stop down faster than they open up. */
  tauDown = 0.5;
  tauUp = 1.6;
  private lum = new THREE.WebGLRenderTarget(32, 32, { type: THREE.HalfFloatType, depthBuffer: false });
  private a = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private b = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private first = true;
  private measure: FullScreenQuad;
  private adapt: FullScreenQuad;
  private apply: FullScreenQuad;

  constructor() {
    super();
    const mat = (uniforms: Record<string, THREE.IUniform>, fragmentShader: string): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader, depthTest: false, depthWrite: false });
    this.measure = new FullScreenQuad(mat({ tDiffuse: { value: null } }, /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        float s = 0.0;
        for (int i = 0; i < 4; i++) {
          vec2 o = (vec2(float(i / 2), float(i - (i / 2) * 2)) - 0.5) / 64.0;
          vec3 c = texture2D(tDiffuse, vUv + o).rgb;
          s += log(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.002));
        }
        gl_FragColor = vec4(s * 0.25, 0.0, 0.0, 1.0);
      }
    `));
    this.adapt = new FullScreenQuad(mat({
      tLum: { value: this.lum.texture }, tPrev: { value: null }, uUp: { value: 1 }, uDown: { value: 1 }, uInit: { value: 1 },
    }, /* glsl */ `
      uniform sampler2D tLum, tPrev;
      uniform float uUp, uDown, uInit;
      void main() {
        float s = 0.0, ws = 0.0;
        for (int y = 0; y < 8; y++) {
          for (int x = 0; x < 8; x++) {
            vec2 uv = (vec2(float(x), float(y)) + 0.5) / 8.0;
            // What is in the middle of the view matters more than its corners
            float w = 1.0 - 0.7 * smoothstep(0.15, 0.7, length(uv - 0.5));
            s += texture2D(tLum, uv).r * w;
            ws += w;
          }
        }
        float cur = exp(s / ws);
        float prev = texture2D(tPrev, vec2(0.5)).r;
        float k = cur > prev ? uDown : uUp;
        gl_FragColor = vec4(mix(prev, cur, max(k, uInit)), 0.0, 0.0, 1.0);
      }
    `));
    this.apply = new FullScreenQuad(mat({
      tDiffuse: { value: null }, tAvg: { value: null }, uKey: { value: 0.2 }, uStrength: { value: 0.5 }, uRange: { value: new THREE.Vector2(0.7, 1.7) },
    }, /* glsl */ `
      uniform sampler2D tDiffuse, tAvg;
      uniform float uKey, uStrength;
      uniform vec2 uRange;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float avg = max(texture2D(tAvg, vec2(0.5)).r, 0.002);
        float e = clamp(pow(uKey / avg, uStrength), uRange.x, uRange.y);
        gl_FragColor = vec4(c.rgb * e, c.a);
      }
    `));
  }

  /** The adapted scene luminance (reads back one pixel: for tuning, not for every frame). */
  debugLuminance(renderer: THREE.WebGLRenderer): number {
    const px = new Uint16Array(4);
    renderer.readRenderTargetPixels(this.a, 0, 0, 1, 1, px);
    return THREE.DataUtils.fromHalfFloat(px[0]);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number): void {
    const dt = Math.min(0.1, Math.max(0, deltaTime || 0.016));
    (this.measure.material as THREE.ShaderMaterial).uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.lum);
    this.measure.render(renderer);

    const ad = (this.adapt.material as THREE.ShaderMaterial).uniforms;
    ad.tPrev.value = this.a.texture;
    ad.uUp.value = 1 - Math.exp(-dt / this.tauUp);
    ad.uDown.value = 1 - Math.exp(-dt / this.tauDown);
    ad.uInit.value = this.first ? 1 : 0;
    this.first = false;
    renderer.setRenderTarget(this.b);
    this.adapt.render(renderer);
    [this.a, this.b] = [this.b, this.a];

    const ap = (this.apply.material as THREE.ShaderMaterial).uniforms;
    ap.tDiffuse.value = readBuffer.texture;
    ap.tAvg.value = this.a.texture;
    ap.uKey.value = this.key;
    ap.uStrength.value = this.strength;
    ap.uRange.value.set(this.min, this.max);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.apply.render(renderer);
  }

  override dispose(): void {
    this.lum.dispose();
    this.a.dispose();
    this.b.dispose();
    this.measure.dispose();
    this.adapt.dispose();
    this.apply.dispose();
  }
}
