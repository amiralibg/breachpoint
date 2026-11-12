import * as THREE from 'three';

/**
 * Late-afternoon sky and haze, art-directed rather than simulated: a slate zenith, a horizon that
 * runs from cool grey to peach toward the sun, heavy cloud with lit edges, and fog that picks up
 * the sun's colour when you look toward it.
 */

const SKY_FRAG = /* glsl */ `
  uniform vec3 uSun;
  uniform float uTime;
  uniform float uDisc;
  uniform vec3 uZenith, uHorizon, uHorizonSun, uGlow, uCloudLit, uCloudSun, uCloudDark;
  uniform vec2 uCover;
  uniform float uCloudAmount, uFlash, uStars;
  varying vec3 vDir;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) {
      s += a * noise(p);
      p = p * 2.03 + vec2(17.3, 9.1);
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float sd = max(dot(d, uSun), 0.0);
    vec2 flatD = normalize(d.xz + vec2(1e-5));
    // Clamped: rounding can push these a hair outside [0, 1], and pow() of a negative is NaN,
    // which the reflection map's blur then spreads over everything
    float az = clamp(0.5 + 0.5 * dot(flatD, normalize(uSun.xz + vec2(1e-5))), 0.0, 1.0);

    vec3 zenith = uZenith;
    vec3 horizon = mix(uHorizon, uHorizonSun, pow(az, 2.6));
    float band = pow(clamp(1.0 - d.y, 0.0, 1.0), 4.5);
    vec3 col = mix(zenith, horizon, band);
    col += uGlow * 0.68 * pow(sd, 5.0) * 0.32;
    col += uGlow * pow(sd, 48.0) * 0.7;
    if (uStars > 0.0 && d.y > 0.0) {
      vec2 sp = d.xz / (d.y + 0.3) * 90.0;
      float st = hash(floor(sp));
      col += vec3(0.8, 0.85, 1.0) * step(0.993, st) * uStars * smoothstep(0.0, 0.3, d.y) * (0.5 + 0.5 * hash(floor(sp) + 7.0));
    }

    if (d.y > 0.0) {
      vec2 uv = d.xz / (d.y + 0.14) * 0.9 + uTime * vec2(0.0035, 0.0012);
      float n = fbm(uv) * 0.75 + fbm(uv * 2.7 + 4.0) * 0.25;
      float cover = smoothstep(uCover.x, uCover.y, n);
      float core = smoothstep(0.5, 0.8, n);
      vec3 lit = mix(uCloudLit, uCloudSun, pow(sd, 2.2));
      vec3 cloud = mix(lit, uCloudDark, core);
      // Lightning lights the cloud base from inside
      cloud += vec3(0.75, 0.82, 1.0) * uFlash * (0.35 + 0.65 * n);
      col = mix(col, cloud, cover * smoothstep(0.0, 0.16, d.y) * uCloudAmount);
    }

    float disc = smoothstep(0.99962, 0.99988, dot(d, uSun));
    col += vec3(1.0, 0.86, 0.62) * disc * 3.2 * uDisc;
    col = mix(col, horizon * 0.55, smoothstep(0.0, -0.12, d.y));
    col += vec3(0.2, 0.23, 0.3) * uFlash;
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }
`;

/** Sky palette (linear RGB triples). The defaults are the compound's late afternoon. */
export interface SkySpec {
  zenith: [number, number, number];
  horizon: [number, number, number];
  /** Horizon colour under the sun. */
  horizonSun: [number, number, number];
  /** Glow around the sun (or moon). */
  glow: [number, number, number];
  cloudLit: [number, number, number];
  cloudSun: [number, number, number];
  cloudDark: [number, number, number];
  /** Noise range that turns into cloud: lower values = more of the sky covered. */
  cover: [number, number];
  cloudAmount: number;
  /** Brightness of the sun disc (0 hides it). */
  disc: number;
  stars: number;
}

export const DEFAULT_SKY: SkySpec = {
  zenith: [0.075, 0.125, 0.23],
  horizon: [0.30, 0.36, 0.44],
  horizonSun: [1.05, 0.62, 0.33],
  glow: [1.25, 0.78, 0.42],
  cloudLit: [0.42, 0.42, 0.46],
  cloudSun: [1.5, 0.82, 0.44],
  cloudDark: [0.11, 0.12, 0.16],
  cover: [0.42, 0.66],
  cloudAmount: 0.92,
  disc: 1,
  stars: 0,
};

export function makeSky(sunDir: THREE.Vector3, disc = true, spec: Partial<SkySpec> = {}): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const k = { ...DEFAULT_SKY, ...spec };
  const c3 = (v: [number, number, number]): { value: THREE.Vector3 } => ({ value: new THREE.Vector3(v[0], v[1], v[2]) });
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunDir.clone() }, uTime: { value: 0 }, uDisc: { value: disc ? k.disc : 0 },
      uZenith: c3(k.zenith), uHorizon: c3(k.horizon), uHorizonSun: c3(k.horizonSun), uGlow: c3(k.glow),
      uCloudLit: c3(k.cloudLit), uCloudSun: c3(k.cloudSun), uCloudDark: c3(k.cloudDark),
      uCover: { value: new THREE.Vector2(k.cover[0], k.cover[1]) }, uCloudAmount: { value: k.cloudAmount },
      uFlash: { value: 0 }, uStars: { value: k.stars },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  sky.scale.setScalar(400);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.userData.noAO = true;
  return sky;
}

/** Base haze colour (away from the sun). */
export const FOG_COLOR = 0x59626d;

/** Shared by every fogged material: direction to the sun (xyz), then the haze colour toward it (rgb). */
const fogSun = new Float32Array([0, 1, 0, 1, 0.6, 0.32]);
let fogInstalled = false;

/**
 * Makes every fogged material scatter the sun: haze turns warm and thick looking toward it.
 * Patches three's fog chunks once (before the first render); the sun direction and tint are
 * uniforms shared by all materials, so each map can set its own.
 */
export function installSunFog(sunDir: THREE.Vector3, warm: THREE.Color): void {
  fogSun.set([sunDir.x, sunDir.y, sunDir.z, warm.r, warm.g, warm.b]);
  if (fogInstalled) return;
  fogInstalled = true;
  const c = THREE.ShaderChunk;
  c.fog_pars_vertex = c.fog_pars_vertex.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogView;');
  c.fog_vertex = c.fog_vertex.replace('vFogDepth = - mvPosition.z;', 'vFogDepth = - mvPosition.z;\n\tvFogView = mvPosition.xyz;');
  c.fog_pars_fragment = c.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogView;\n\tuniform vec3 fogSun[ 2 ];');
  c.fog_fragment = c.fog_fragment.replace(
    'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
    `vec3 fogSunV = ( viewMatrix * vec4( fogSun[ 0 ], 0.0 ) ).xyz;
	float fogSunK = pow( max( dot( normalize( vFogView ), fogSunV ), 0.0 ), 5.0 );
	vec3 fogTint = mix( fogColor, fogSun[ 1 ], fogSunK );
	fogFactor = min( 1.0, fogFactor * ( 1.0 + fogSunK * 1.6 ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );`,
  );
  // Materials clone their shader's uniforms, but a typed array is passed by reference: every
  // material ends up reading these same six numbers.
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (lib.uniforms.fogColor) lib.uniforms.fogSun = { value: fogSun };
  }
}
