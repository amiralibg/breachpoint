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
    float az = 0.5 + 0.5 * dot(flatD, normalize(uSun.xz));

    vec3 zenith = vec3(0.075, 0.125, 0.23);
    vec3 horizon = mix(vec3(0.30, 0.36, 0.44), vec3(1.05, 0.62, 0.33), pow(az, 2.6));
    float band = pow(1.0 - max(d.y, 0.0), 4.5);
    vec3 col = mix(zenith, horizon, band);
    col += vec3(0.85, 0.42, 0.18) * pow(sd, 5.0) * 0.32;
    col += vec3(1.25, 0.78, 0.42) * pow(sd, 48.0) * 0.7;

    if (d.y > 0.0) {
      vec2 uv = d.xz / (d.y + 0.14) * 0.9 + uTime * vec2(0.0035, 0.0012);
      float n = fbm(uv) * 0.75 + fbm(uv * 2.7 + 4.0) * 0.25;
      float cover = smoothstep(0.42, 0.66, n);
      float core = smoothstep(0.5, 0.8, n);
      vec3 lit = mix(vec3(0.42, 0.42, 0.46), vec3(1.5, 0.82, 0.44), pow(sd, 2.2));
      vec3 cloud = mix(lit, vec3(0.11, 0.12, 0.16), core);
      col = mix(col, cloud, cover * smoothstep(0.0, 0.16, d.y) * 0.92);
    }

    float disc = smoothstep(0.99962, 0.99988, dot(d, uSun));
    col += vec3(1.0, 0.86, 0.62) * disc * 3.2 * uDisc;
    col = mix(col, horizon * 0.55, smoothstep(0.0, -0.12, d.y));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function makeSky(sunDir: THREE.Vector3, disc = true): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir.clone() }, uTime: { value: 0 }, uDisc: { value: disc ? 1 : 0 } },
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

let fogChunks: { v: string; pv: string; f: string; pf: string } | null = null;

/**
 * Makes every fogged material scatter the sun: haze turns warm and thick looking toward it.
 * Patches three's fog chunks, so call before the first render.
 */
export function installSunFog(sunDir: THREE.Vector3, warm: THREE.Color): void {
  const c = THREE.ShaderChunk;
  fogChunks ??= { v: c.fog_vertex, pv: c.fog_pars_vertex, f: c.fog_fragment, pf: c.fog_pars_fragment };
  const v3 = (v: { x: number; y: number; z: number }): string => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
  c.fog_pars_vertex = fogChunks.pv.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogView;');
  c.fog_vertex = fogChunks.v.replace('vFogDepth = - mvPosition.z;', 'vFogDepth = - mvPosition.z;\n\tvFogView = mvPosition.xyz;');
  c.fog_pars_fragment = fogChunks.pf.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogView;');
  c.fog_fragment = fogChunks.f.replace(
    'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
    `vec3 fogSunV = ( viewMatrix * vec4( ${v3(sunDir)}, 0.0 ) ).xyz;
	float fogSun = pow( max( dot( normalize( vFogView ), fogSunV ), 0.0 ), 5.0 );
	vec3 fogTint = mix( fogColor, ${v3({ x: warm.r, y: warm.g, z: warm.b })}, fogSun );
	fogFactor = min( 1.0, fogFactor * ( 1.0 + fogSun * 1.6 ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );`,
  );
}
