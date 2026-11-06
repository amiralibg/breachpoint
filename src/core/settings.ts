export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  label: string;
  /** Multiplier on devicePixelRatio, then clamped by maxPixelRatio. */
  pixelRatioScale: number;
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  softShadows: boolean;
  textureRes: '1k' | '2k';
  hdriRes: '1k' | '2k';
  anisotropy: number;
  ambientOcclusion: boolean;
  bloom: boolean;
  antialias: 'none' | 'fxaa' | 'smaa';
  /** Max bullet decals kept in the world. */
  decals: number;
  /** Enemy draw distance in meters. */
  fogFar: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'Low',
    pixelRatioScale: 0.75,
    maxPixelRatio: 1,
    shadows: false,
    shadowMapSize: 512,
    softShadows: false,
    textureRes: '1k',
    hdriRes: '1k',
    anisotropy: 1,
    ambientOcclusion: false,
    bloom: false,
    antialias: 'none',
    decals: 24,
    fogFar: 140,
  },
  medium: {
    label: 'Medium',
    pixelRatioScale: 1,
    maxPixelRatio: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    softShadows: false,
    textureRes: '1k',
    hdriRes: '1k',
    anisotropy: 4,
    ambientOcclusion: false,
    bloom: false,
    antialias: 'fxaa',
    decals: 48,
    fogFar: 180,
  },
  high: {
    label: 'High',
    pixelRatioScale: 1,
    maxPixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    softShadows: true,
    textureRes: '2k',
    hdriRes: '2k',
    anisotropy: 8,
    ambientOcclusion: true,
    bloom: true,
    antialias: 'smaa',
    decals: 96,
    fogFar: 240,
  },
  ultra: {
    label: 'Ultra',
    pixelRatioScale: 1,
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 4096,
    softShadows: true,
    textureRes: '2k',
    hdriRes: '2k',
    anisotropy: 16,
    ambientOcclusion: true,
    bloom: true,
    antialias: 'smaa',
    decals: 160,
    fogFar: 320,
  },
};

export interface Settings {
  quality: QualityLevel;
  sensitivity: number; // degrees per 100px of mouse movement, roughly
  fov: number;
  volume: number; // 0..1
  showFps: boolean;
}

const KEY = 'breachpoint.settings.v1';

const DEFAULTS: Settings = {
  quality: 'high',
  sensitivity: 1,
  fov: 80,
  volume: 0.7,
  showFps: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
