import * as THREE from 'three';
import type { QualityLevel } from '../core/settings';
import { CAMPAIGN } from '../game/campaign';
import type { Game } from '../game/game';
import type { MissionMode } from '../game/mission';

/**
 * Developer options: F2 (or the DEV button on touch screens) opens a panel to jump around the
 * game and check things without playing through: any chapter, skip or reach the objective, god
 * mode, ammo, slow motion, frozen bots, a free-fly camera, hidden HUD, live render stats and a
 * screenshot. Only installed when developer mode is on (see devflags.ts).
 */

export interface DevApi {
  startMission(id: string): Promise<void>;
  setQuality(q: QualityLevel): Promise<void>;
}

type Mission = MissionMode & {
  devSkipStage(): void;
  devObjective(): THREE.Vector3 | null;
  devStatus(): { stage: number; stages: number; id: string };
  restore(): void;
};

export function installDevPanel(game: Game, api: DevApi): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = game as any;
  const root = document.createElement('div');
  root.id = 'devpanel';
  root.className = 'hidden';
  root.innerHTML = `
    <header><b>DEVELOPER</b><span>F2</span><button data-dev="close" aria-label="Close">×</button></header>
    <section>
      <h4>Chapter</h4>
      <div class="dev-row"><select data-dev="mission">${CAMPAIGN.map((m) => `<option value="${m.id}">${m.index}. ${m.title}</option>`).join('')}</select>
        <button data-dev="start">Start</button></div>
      <div class="dev-row"><button data-dev="skip">Skip objective</button><button data-dev="goto">Go to objective</button></div>
      <div class="dev-row"><button data-dev="checkpoint">Restart checkpoint</button><button data-dev="killall">Kill all bots</button></div>
      <p class="dev-note" data-dev="stage">Not in a chapter</p>
    </section>
    <section>
      <h4>Player and world</h4>
      <label><input type="checkbox" data-dev="god"> God mode</label>
      <label><input type="checkbox" data-dev="ammo"> Infinite ammo</label>
      <label><input type="checkbox" data-dev="freeze"> Freeze bots</label>
      <label class="dev-range">Time <input type="range" min="0.1" max="2" step="0.05" value="1" data-dev="time"><output data-dev="timeOut">1.00×</output></label>
    </section>
    <section>
      <h4>View</h4>
      <div class="dev-row"><button data-dev="fly">Free camera</button><button data-dev="shot">Screenshot</button></div>
      <label><input type="checkbox" data-dev="hud"> Hide HUD</label>
      <label><input type="checkbox" data-dev="ai"> AI debug overlay</label>
      <div class="dev-row dev-quality">${(['low', 'medium', 'high', 'ultra'] as const).map((q) => `<button data-q="${q}">${q}</button>`).join('')}</div>
      <p class="dev-note">Free camera: mouse to look, WASD to fly, Space / C up and down, Shift fast, Esc to stop.</p>
    </section>
    <section>
      <h4>Stats</h4>
      <pre data-dev="stats"></pre>
    </section>
  `;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement>(k: string): T => root.querySelector(`[data-dev="${k}"]`) as T;

  // Touch screens have no F2: a small button opens the panel
  const opener = document.createElement('button');
  opener.id = 'devpanel-open';
  opener.textContent = 'DEV';
  document.body.appendChild(opener);
  opener.addEventListener('click', () => toggle(true));

  const mission = (): Mission | null => {
    const m = g.mode as Mission | null;
    return m && typeof m.devSkipStage === 'function' ? m : null;
  };

  let open = false;
  function toggle(on = !open): void {
    open = on;
    root.classList.toggle('hidden', !open);
    // The panel needs the mouse: let go of the pointer (the game pauses behind it)
    if (open) game.input.unlock();
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F2') {
      e.preventDefault();
      if (flying) stopFly();
      toggle();
    }
  });
  $('close').addEventListener('click', () => toggle(false));

  // --- Chapter
  $('start').addEventListener('click', () => {
    toggle(false);
    void api.startMission($<HTMLSelectElement>('mission').value);
  });
  $('skip').addEventListener('click', () => mission()?.devSkipStage());
  $('goto').addEventListener('click', () => {
    const p = mission()?.devObjective();
    if (!p) return;
    // A step short of the marker, on its floor: markers often sit on a console or a door
    const to = new THREE.Vector3().subVectors(game.player.position, p).setY(0);
    if (to.lengthSq() > 1e-6) to.setLength(2);
    game.player.position.copy(p).add(to);
    game.player.position.y = p.y + 0.05;
    game.player.velocity.set(0, 0, 0);
    game.player.yaw = Math.atan2(to.x, to.z);
  });
  $('checkpoint').addEventListener('click', () => mission()?.restore());
  $('killall').addEventListener('click', () => {
    for (const e of game.enemies.enemies) {
      if (e.dead || e.friendly) continue;
      e.damage(9999, new THREE.Vector3(0, 0, 1), game.player.position.clone(), 'torso', e.position.clone(), { squad: game.enemies.squad, events: game.events });
    }
  });

  // --- Player and world
  const check = (k: string, f: (on: boolean) => void): void => {
    const el = $<HTMLInputElement>(k);
    el.addEventListener('change', () => f(el.checked));
  };
  check('god', (on) => { game.dev.god = on; });
  check('ammo', (on) => {
    game.dev.ammo = on;
    game.weapons.infiniteAmmo = on || !!g.mode?.infiniteAmmo;
  });
  check('freeze', (on) => { game.enemies.frozen = on; });
  const time = $<HTMLInputElement>('time');
  time.addEventListener('input', () => {
    game.dev.timeScale = Number(time.value);
    $('timeOut').textContent = `${game.dev.timeScale.toFixed(2)}×`;
  });

  // --- View
  check('hud', (on) => { document.getElementById('hud')!.style.visibility = on ? 'hidden' : ''; });
  check('ai', () => game.toggleDebug());
  root.querySelectorAll<HTMLButtonElement>('.dev-quality button').forEach((b) =>
    b.addEventListener('click', () => void api.setQuality(b.dataset.q as QualityLevel)));
  $('shot').addEventListener('click', () => {
    root.classList.add('hidden');
    const canvas = game.renderer.gl.domElement;
    // Read the canvas in the same task as a render (the drawing buffer is not preserved)
    game.renderer.render(0);
    canvas.toBlob((blob) => {
      root.classList.toggle('hidden', !open);
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `breachpoint-${g.map?.id ?? 'shot'}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  });

  // --- Free camera: the game stops driving the camera ('view' state) and this flies it
  let flying = false;
  let before = 'paused';
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const move = new THREE.Vector3();
  function startFly(): void {
    if (!g.mode) return;
    toggle(false);
    flying = true;
    before = g.state === 'menu' ? 'menu' : 'paused';
    euler.setFromQuaternion(game.camera.quaternion);
    g.state = 'view';
    document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
    game.weapons.setVisible(false);
    game.input.lock();
  }
  function stopFly(): void {
    if (!flying) return;
    flying = false;
    game.weapons.setVisible(true);
    if (before === 'paused') g.setState('paused');
    else g.state = before;
  }
  $('fly').addEventListener('click', startFly);
  document.addEventListener('pointerlockchange', () => {
    if (flying && !document.pointerLockElement) stopFly();
  });

  // --- Every frame: fly, and keep the stats fresh
  let statT = 0;
  let fps = 60;
  const fpsEma = (dt: number): void => {
    if (dt > 0) fps += (1 / dt - fps) * 0.1;
  };
  let last = performance.now();
  // Count a whole frame (scene, weapon, every post pass), not just the last render call
  let calls = 0;
  let tris = 0;
  game.dev.onFrame = () => {
    const info = game.renderer.gl.info;
    calls = info.render.calls;
    tris = info.render.triangles;
    info.autoReset = false;
    info.reset();
    const now = performance.now();
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    fpsEma(real);
    if (flying) {
      const inp = game.input;
      euler.y -= inp.mouseDX * 0.0022;
      euler.x = THREE.MathUtils.clamp(euler.x - inp.mouseDY * 0.0022, -1.55, 1.55);
      game.camera.quaternion.setFromEuler(euler);
      move.set((inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0), 0, (inp.down('KeyS') ? 1 : 0) - (inp.down('KeyW') ? 1 : 0));
      move.applyQuaternion(game.camera.quaternion);
      move.y += (inp.down('Space') ? 1 : 0) - (inp.down('KeyC') || inp.down('ControlLeft') ? 1 : 0);
      const speed = inp.down('ShiftLeft') ? 22 : 6;
      if (move.lengthSq() > 0) game.camera.position.addScaledVector(move.normalize(), speed * real);
      game.camera.updateMatrixWorld();
    }
    statT -= real;
    if (statT > 0 || !open) return;
    statT = 0.25;
    const m = mission();
    const st = m?.devStatus();
    $('stage').textContent = st ? `Objective ${st.stage + 1} of ${st.stages} (${st.id})` : 'Not in a chapter';
    const p = game.player.position;
    const alive = game.enemies.enemies.filter((e) => !e.dead && !e.friendly).length;
    $('stats').textContent = [
      `fps        ${fps.toFixed(0)}  (${(1000 / Math.max(1, fps)).toFixed(1)} ms)`,
      `draw calls ${calls}`,
      `triangles  ${(tris / 1000).toFixed(0)}k`,
      `bots alive ${alive}`,
      `map        ${g.map?.id ?? '-'}`,
      `player     ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`,
      `camera     ${game.camera.position.toArray().map((v) => v.toFixed(1)).join(', ')}`,
    ].join('\n');
  };
}
