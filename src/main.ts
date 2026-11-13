import { onProgress } from './core/assets';
import { devState } from './devflags';
import { loadSettings, QUALITY_PRESETS, saveSettings, type QualityLevel } from './core/settings';
import { Game } from './game/game';
import { CAMPAIGN } from './game/campaign';
import type { MissionDef, MissionMode, SavedCheckpoint } from './game/mission';
import type { ModeId } from './game/modes';
import { WEAPONS } from './weapons/weapons';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const screens = ['loading', 'menu', 'pause', 'gameover', 'settings', 'controls', 'campaign', 'briefing', 'debrief'] as const;
type Screen = (typeof screens)[number];

let settings = loadSettings();
const game = new Game($('app'), settings);
let returnTo: Screen = 'menu';
let lastMode: ModeId = 'waves';
let mission: MissionDef | null = null;
let resetArmed = false;

// ---- Story progress: chapters unlock in order; a finished chapter can be replayed
const STORY_KEY = 'breachpoint.story.v2';
interface ChapterRecord {
  /** Best time, seconds. */
  time: number;
  kills: number;
  /** The choice made at the end of the last chapter. */
  ending?: string;
}
type Progress = Record<string, ChapterRecord>;

function loadProgress(): Progress {
  try {
    const cur = localStorage.getItem(STORY_KEY);
    if (cur) return JSON.parse(cur) as Progress;
    // Saves from before chapters were locked: a plain list of finished mission ids
    const old = JSON.parse(localStorage.getItem('breachpoint.story') ?? '[]') as string[];
    return Object.fromEntries(old.map((id) => [id, { time: 0, kills: 0 }]));
  } catch {
    return {};
  }
}

function saveProgress(p: Progress): void {
  localStorage.setItem(STORY_KEY, JSON.stringify(p));
}

/** How many chapters are open: every finished one, plus the first unfinished. */
function unlockedCount(p: Progress): number {
  if (devState.unlockAll || (import.meta.env.DEV && (window as unknown as { __unlock?: boolean }).__unlock)) return CAMPAIGN.length;
  let n = 0;
  while (n < CAMPAIGN.length && p[CAMPAIGN[n].id]) n++;
  return Math.min(CAMPAIGN.length, n + 1);
}

// ---- A chapter left part-way: its last checkpoint, so it can be resumed in a later session
const RESUME_KEY = 'breachpoint.resume.v1';

function loadResume(): SavedCheckpoint | null {
  try {
    const r = JSON.parse(localStorage.getItem(RESUME_KEY) ?? 'null') as SavedCheckpoint | null;
    return r && CAMPAIGN.some((m) => m.id === r.mission) ? r : null;
  } catch {
    return null;
  }
}

function saveResume(cp: SavedCheckpoint | null): void {
  try {
    if (cp) localStorage.setItem(RESUME_KEY, JSON.stringify(cp));
    else localStorage.removeItem(RESUME_KEY);
  } catch {
    /* storage full or blocked: resuming is a convenience */
  }
}

function resumeFor(def: MissionDef): SavedCheckpoint | null {
  const r = loadResume();
  return r && r.mission === def.id ? r : null;
}

/** Where "Continue" takes the player: the chapter they left, else the next one to play. */
function continueChapter(p: Progress): MissionDef | undefined {
  const r = loadResume();
  return (r && CAMPAIGN.find((m) => m.id === r.mission)) || nextChapter(p);
}

function nextChapter(p: Progress): MissionDef | undefined {
  return CAMPAIGN.find((m) => !p[m.id]);
}

function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The story entry on the main menu says where the player is in it. */
function syncStoryButton(): void {
  const p = loadProgress();
  const next = continueChapter(p);
  const r = loadResume();
  const started = Object.keys(p).length > 0 || !!r;
  $('story-title').textContent = !started ? 'Story: Low Water' : next ? 'Continue: Low Water' : 'Story: Low Water';
  $('story-sub').textContent = !started
    ? 'Six chapters in a flood city, 40 hours before the surge'
    : next
      ? `Chapter ${next.index} of ${CAMPAIGN.length} · ${next.title}${r?.mission === next.id ? ` · objective ${r.stage + 1} of ${r.stages}` : ''}`
      : 'Story complete · replay any chapter';
  $('chapters-btn').classList.toggle('hidden', !started);
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

/** Paragraphs; a line written as "NAME: text" is set as a radio line. */
function prose(lines: string[]): string {
  return lines.map((l) => {
    const m = /^([A-Z][A-Z ]{2,14}): (.*)$/.exec(l);
    return m ? `<p class="radio"><b>${esc(m[1])}</b>${esc(m[2])}</p>` : `<p>${esc(l)}</p>`;
  }).join('');
}

function openCampaign(): void {
  const p = loadProgress();
  const next = nextChapter(p);
  const open = unlockedCount(p);
  const finished = CAMPAIGN.filter((m) => p[m.id]).length;
  $('campaign-progress').textContent = finished === CAMPAIGN.length
    ? `Story complete · ${p[CAMPAIGN[CAMPAIGN.length - 1].id]?.ending === 'arrest' ? 'Reyhan testified' : 'Reyhan disappeared'}`
    : `Chapter ${finished + 1} of ${CAMPAIGN.length}`;
  $('campaign-bar').style.width = `${(finished / CAMPAIGN.length) * 100}%`;
  $('mission-list').innerHTML = CAMPAIGN.map((m, i) => {
    const rec = p[m.id];
    const locked = i >= open;
    const cls = [rec ? 'done' : '', m === next ? 'next primary' : '', locked ? 'locked' : ''].join(' ');
    const sub = locked
      ? `Finish chapter ${i} to unlock`
      : `${esc(m.subtitle)} · ${esc(m.clock)}`;
    const res = resumeFor(m);
    const tag = locked ? 'Locked' : res ? `Resume · ${res.stage + 1}/${res.stages}` : rec ? (rec.time ? `Complete · ${clock(rec.time)}` : 'Complete') : 'Play';
    return `
    <button data-mission="${m.id}" class="${cls}" ${locked ? 'disabled' : ''}>
      <span class="num">${m.index}</span>
      <span class="body"><b>${locked ? 'Chapter ' + m.index : esc(m.title)}</b><small>${sub}</small></span>
      <span class="tag">${tag}</span>
    </button>`;
  }).join('');
  $('story-reset').classList.toggle('hidden', finished === 0);
  $('story-reset').querySelector('b')!.textContent = 'Start a new story';
  resetArmed = false;
  show('campaign');
}

function openBriefing(def: MissionDef): void {
  mission = def;
  $('brief-clock').textContent = `Chapter ${def.index} of ${CAMPAIGN.length} · ${def.clock}`;
  $('brief-title').textContent = def.title.toUpperCase();
  $('brief-sub').textContent = def.subtitle;
  $('brief-body').innerHTML = prose(def.briefing);
  $('brief-objectives').innerHTML = def.objectives.map((o) => `<li>${esc(o)}</li>`).join('');
  $('brief-loadout').textContent = `Loadout: ${def.loadout.map((w) => WEAPONS.find((d) => d.id === w)?.name ?? w).join(' · ')}`;
  const res = resumeFor(def);
  $('brief-resume').classList.toggle('hidden', !res);
  if (res) {
    $('brief-resume').innerHTML = `<span>Checkpoint</span><b>Objective ${res.stage + 1} of ${res.stages}${res.task ? ' · ' + esc(res.task) : ''}</b><small>${clock(res.elapsed)} in · ${res.kills} hostiles down</small>`;
  }
  const btn = $<HTMLButtonElement>('deploy-btn');
  const fresh = $<HTMLButtonElement>('deploy-fresh');
  btn.disabled = fresh.disabled = true;
  fresh.classList.toggle('hidden', !res);
  btn.querySelector('b')!.textContent = 'Preparing the area…';
  show('briefing');
  // Always a fresh copy of the map: doors, water and power are as the mission expects
  game.loadWorld(def.map, true).then(() => {
    if (mission !== def) return;
    btn.disabled = fresh.disabled = false;
    btn.querySelector('b')!.textContent = res ? 'Resume checkpoint' : 'Deploy';
  }).catch((err: unknown) => {
    console.error(err);
    btn.querySelector('b')!.textContent = 'Failed to load (see console)';
  });
}

async function startArcade(mode: ModeId): Promise<void> {
  lastMode = mode;
  mission = null;
  $('loading-text').textContent = 'Loading the compound…';
  show('loading');
  await game.loadWorld('compound');
  show(null);
  game.start(mode);
}

function show(s: Screen | null): void {
  for (const id of screens) $(id).classList.toggle('hidden', id !== s);
}

// ---- Loading
onProgress((loaded, total) => {
  $('loadbar-fill').style.width = `${(loaded / total) * 100}%`;
  $('loading-text').textContent = `Loading assets… ${loaded}/${total}`;
});

// Phones and tablets: the controls screen shows the touch layout
if (document.body.classList.contains('touch')) $('controls-hint').textContent = 'Touch controls';

game.load().then(() => {
  game.hud.setFpsVisible(settings.showFps);
  syncStoryButton();
  show('menu');
}).catch((err: unknown) => {
  console.error(err);
  $('loading-text').textContent = 'Failed to load assets. Did you run "npm run assets"? See console.';
});

// ---- State changes from the game
game.onStateChange = (s) => {
  $('pause-checkpoint').classList.toggle('hidden', !mission);
  if (s === 'paused') show('pause');
  else if (s === 'playing') show(null);
  else if (s === 'menu') {
    syncStoryButton();
    show('menu');
  }
};
game.onCheckpoint = (cp) => {
  // The opening checkpoint is the chapter's start: nothing to resume yet
  saveResume(cp.stage > 0 ? cp : null);
};
game.onMissionComplete = (m: MissionMode) => {
  if (loadResume()?.mission === m.def.id) saveResume(null);
  const p = loadProgress();
  const prev = p[m.def.id];
  p[m.def.id] = {
    time: prev?.time ? Math.min(prev.time, m.elapsed) : m.elapsed,
    kills: Math.max(prev?.kills ?? 0, m.kills),
    ending: typeof m.flags.ending === 'string' ? m.flags.ending : prev?.ending,
  };
  saveProgress(p);
  const next = CAMPAIGN[m.def.index];
  const last = !next;
  $('debrief-kicker').textContent = last ? 'LOW WATER · THE END' : `CHAPTER ${m.def.index} COMPLETE`;
  $('debrief-title').textContent = m.def.title.toUpperCase();
  $('debrief-body').innerHTML = prose(m.def.debrief(m));
  $('debrief-time').textContent = clock(m.elapsed);
  $('debrief-kills').textContent = String(m.kills);
  $('debrief-next').innerHTML = next
    ? `<span>Next</span><b>Chapter ${next.index} · ${esc(next.title)}</b><small>${esc(next.subtitle)} · ${esc(next.clock)}</small>`
    : '<span>Story complete</span><b>All six chapters finished</b><small>Every chapter can be replayed from the story screen.</small>';
  $('next-btn').querySelector('b')!.textContent = next ? 'Continue' : 'Story';
  show('debrief');
};
game.onGameOver = () => {
  const m = game.mode!;
  const story = !!mission;
  $('go-title').textContent = story && game.failReason ? 'MISSION FAILED' : 'K.I.A.';
  $('go-reason').textContent = game.failReason ?? '';
  $('go-reason').classList.toggle('hidden', !game.failReason);
  $('go-stats').classList.toggle('hidden', story);
  $('go-again').textContent = story ? 'Restart from checkpoint' : 'Deploy again';
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
  const pick = (e.target as HTMLElement).closest<HTMLElement>('[data-mission]');
  if (pick) {
    const def = CAMPAIGN.find((m) => m.id === pick.dataset.mission);
    if (def && CAMPAIGN.indexOf(def) < unlockedCount(loadProgress())) openBriefing(def);
    return;
  }
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
  const from = screens.find((s) => !$(s).classList.contains('hidden')) ?? 'menu';
  switch (a) {
    case 'play-waves':
    case 'play-practice':
      void startArcade(a === 'play-waves' ? 'waves' : 'practice');
      break;
    case 'play-again':
      show(null);
      if (mission) game.restartCheckpoint();
      else game.start(lastMode);
      break;
    case 'restart-checkpoint':
      show(null);
      game.restartCheckpoint();
      break;
    case 'story': {
      // Straight into the chapter the player is on; the chapter list once the story is done
      const next = continueChapter(loadProgress());
      returnTo = 'menu';
      if (next) openBriefing(next);
      else openCampaign();
      break;
    }
    case 'campaign':
      if (from !== 'briefing') returnTo = 'menu';
      mission = null;
      openCampaign();
      break;
    case 'story-reset':
      // Two presses: the first asks, the second wipes the save
      if (!resetArmed) {
        resetArmed = true;
        btn.querySelector('b')!.textContent = 'Erase progress? Press again';
        break;
      }
      localStorage.removeItem(STORY_KEY);
      localStorage.removeItem('breachpoint.story');
      saveResume(null);
      openCampaign();
      break;
    case 'deploy':
      if (!mission) break;
      show(null);
      game.start('story', mission, resumeFor(mission));
      break;
    case 'deploy-fresh':
      if (!mission) break;
      if (resumeFor(mission)) saveResume(null);
      show(null);
      game.start('story', mission);
      break;
    case 'next-mission': {
      const next = mission ? CAMPAIGN[mission.index] : undefined;
      game.quitToMenu();
      if (next) openBriefing(next);
      else openCampaign();
      break;
    }
    case 'resume':
      show(null);
      game.resume();
      break;
    case 'quit':
      mission = null;
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
      if (returnTo === 'menu') syncStoryButton();
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
  // The slider tracks fill up to the thumb
  document.querySelectorAll<HTMLInputElement>('#settings input[type=range]').forEach((r) => {
    const min = Number(r.min), max = Number(r.max);
    r.style.setProperty('--p', `${((Number(r.value) - min) / (max - min)) * 100}%`);
  });
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

// Developer options (F2): only in the local dev server. The check is the bare build constant so
// the bundler drops the panel from production builds entirely.
if (import.meta.env.DEV) {
  void import('./ui/devpanel').then((m) => m.installDevPanel(game, {
    async startMission(id) {
      const def = CAMPAIGN.find((c) => c.id === id);
      if (!def) return;
      devState.unlockAll = true;
      if (game.state === 'playing' || game.state === 'paused' || game.state === 'dead') game.quitToMenu();
      openBriefing(def);
      // The map loads behind the briefing; deploy as soon as it is ready (fresh, not a resume)
      const go = $<HTMLButtonElement>('deploy-btn');
      for (let i = 0; i < 300 && go.disabled; i++) await new Promise((r) => setTimeout(r, 100));
      show(null);
      game.start('story', def);
    },
    async setQuality(q) {
      settings = { ...settings, quality: q };
      await applySettings();
    },
  }));
}

// Debug handle for development (inspect state from the console).
if (import.meta.env.DEV) void import('./dev').then((m) => m.installDevTools(game));
