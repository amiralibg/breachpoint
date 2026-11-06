import { onProgress } from './core/assets';
import { loadSettings, QUALITY_PRESETS, saveSettings, type QualityLevel } from './core/settings';
import { Game } from './game/game';
import type { ModeId } from './game/modes';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const screens = ['loading', 'menu', 'pause', 'gameover', 'settings', 'controls'] as const;
type Screen = (typeof screens)[number];

let settings = loadSettings();
const game = new Game($('app'), settings);
let returnTo: Screen = 'menu';
let lastMode: ModeId = 'waves';

function show(s: Screen | null): void {
  for (const id of screens) $(id).classList.toggle('hidden', id !== s);
}

// ---- Loading
onProgress((loaded, total) => {
  $('loadbar-fill').style.width = `${(loaded / total) * 100}%`;
  $('loading-text').textContent = `Loading assets… ${loaded}/${total}`;
});

game.load().then(() => {
  game.hud.setFpsVisible(settings.showFps);
  show('menu');
}).catch((err: unknown) => {
  console.error(err);
  $('loading-text').textContent = 'Failed to load assets. Did you run "npm run assets"? See console.';
});

// ---- State changes from the game
game.onStateChange = (s) => {
  if (s === 'paused') show('pause');
  else if (s === 'playing') show(null);
  else if (s === 'menu') show('menu');
};
game.onGameOver = () => {
  const m = game.mode!;
  const best = Math.max(Number(localStorage.getItem('breachpoint.best') ?? 0), m.score);
  localStorage.setItem('breachpoint.best', String(best));
  $('go-wave').textContent = String(m.wave);
  $('go-kills').textContent = String(m.kills);
  $('go-score').textContent = String(m.score);
  $('go-best').textContent = String(best);
  show('gameover');
};

// ---- Buttons
document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
  const from = screens.find((s) => !$(s).classList.contains('hidden')) ?? 'menu';
  switch (a) {
    case 'play-waves':
    case 'play-practice':
      lastMode = a === 'play-waves' ? 'waves' : 'practice';
      show(null);
      game.start(lastMode);
      break;
    case 'play-again':
      show(null);
      game.start(lastMode);
      break;
    case 'resume':
      show(null);
      game.resume();
      break;
    case 'quit':
      game.quitToMenu();
      break;
    case 'settings':
      returnTo = from;
      openSettings();
      break;
    case 'controls':
      returnTo = from;
      show('controls');
      break;
    case 'back':
      if (from === 'settings') void applySettings();
      show(returnTo);
      break;
  }
});

// ---- Settings panel
const qualityHints: Record<QualityLevel, string> = {
  low: 'No shadows or post-processing, reduced resolution. For integrated GPUs.',
  medium: 'Shadows, FXAA, 1K textures.',
  high: 'Soft shadows, ambient occlusion, bloom, SMAA, 2K textures.',
  ultra: '4K shadow maps, full-resolution rendering on high-DPI displays, max anisotropy.',
};

function openSettings(): void {
  syncSettingsUi();
  show('settings');
}

function syncSettingsUi(): void {
  document.querySelectorAll<HTMLButtonElement>('#quality button').forEach((b) =>
    b.classList.toggle('active', b.dataset.q === settings.quality));
  $('quality-hint').textContent = `${QUALITY_PRESETS[settings.quality].label}: ${qualityHints[settings.quality]}`;
  $<HTMLInputElement>('sens').value = String(settings.sensitivity);
  $('sens-out').textContent = settings.sensitivity.toFixed(2);
  $<HTMLInputElement>('fov').value = String(settings.fov);
  $('fov-out').textContent = `${settings.fov}°`;
  $<HTMLInputElement>('vol').value = String(settings.volume);
  $('vol-out').textContent = `${Math.round(settings.volume * 100)}%`;
  $<HTMLInputElement>('showfps').checked = settings.showFps;
}

document.querySelectorAll<HTMLButtonElement>('#quality button').forEach((b) =>
  b.addEventListener('click', () => {
    settings = { ...settings, quality: b.dataset.q as QualityLevel };
    syncSettingsUi();
  }));
$('sens').addEventListener('input', (e) => {
  settings = { ...settings, sensitivity: Number((e.target as HTMLInputElement).value) };
  syncSettingsUi();
});
$('fov').addEventListener('input', (e) => {
  settings = { ...settings, fov: Number((e.target as HTMLInputElement).value) };
  syncSettingsUi();
});
$('vol').addEventListener('input', (e) => {
  settings = { ...settings, volume: Number((e.target as HTMLInputElement).value) };
  syncSettingsUi();
});
$('showfps').addEventListener('change', (e) => {
  settings = { ...settings, showFps: (e.target as HTMLInputElement).checked };
});

async function applySettings(): Promise<void> {
  saveSettings(settings);
  await game.applySettings(settings);
}

// Debug handle for development (inspect state from the console).
if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
