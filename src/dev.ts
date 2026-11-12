import * as THREE from 'three';
import type { Game } from './game/game';

/**
 * Console helpers for development and automated checks (only loaded by the dev server).
 * They drive the game without a pointer lock: teleport, hold keys, kill groups, check paths.
 */
export function installDevTools(game: Game): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = game as any;
  const w = window as unknown as Record<string, unknown>;
  const P = (a: number[]): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);
  w.__game = game;
  w.__view = (x: number, y: number, z: number, lx: number, ly: number, lz: number): void => {
    g.state = 'view';
    document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
    game.camera.position.set(x, y, z);
    game.camera.lookAt(lx, ly, lz);
  };
  w.__start = async (id: string): Promise<string> => {
    game.fixedDt = 1 / 60;
    w.__unlock = true; // checks may start any chapter; the player's own save is untouched
    document.querySelector<HTMLElement>('[data-action=campaign]')!.click();
    document.querySelector<HTMLElement>(`[data-mission=${id}]`)!.click();
    const btn = document.getElementById('deploy-btn') as HTMLButtonElement;
    for (let i = 0; i < 150 && btn.disabled; i++) await new Promise((r) => setTimeout(r, 200));
    btn.click();
    g.input.locked = true;
    return game.map.id;
  };
  /** Advance the game by `seconds` of fixed ticks right now (works while the tab is in the background). */
  w.__run = (seconds: number): void => {
    game.fixedDt = 1 / 60;
    // Whole frames, not bare ticks: bots aim from their rendered rig, so they need the render step
    for (let i = 0; i < seconds * 60; i++) {
      if (game.state !== 'playing' && game.state !== 'dead') break;
      g.frame();
    }
    g.frame();
  };
  w.__paths = (pts: Record<string, number[]>, pairs: [string, string][]): Record<string, number | null> => {
    const res: Record<string, number | null> = {};
    for (const [a, b] of pairs) {
      const path: THREE.Vector3[] = g.nav.findPath(P(pts[a]), P(pts[b]));
      let len = 0;
      let prev = P(pts[a]);
      for (const q of path) {
        len += prev.distanceTo(q);
        prev = q;
      }
      res[`${a}>${b}`] = path.length ? Math.round(len) : null;
    }
    return res;
  };
  w.__tp = (x: number, y: number, z: number, yaw = 0, pitch = 0): void => {
    game.player.position.set(x, y, z);
    game.player.velocity.set(0, 0, 0);
    game.player.yaw = yaw;
    game.player.pitch = pitch;
  };
  w.__lookAt = (t: number[]): void => {
    const e = game.player.eye;
    const dx = t[0] - e.x, dy = t[1] - e.y, dz = t[2] - e.z;
    game.player.yaw = Math.atan2(-dx, -dz);
    game.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  w.__key = (code: string, down = true): void => {
    g.input.locked = true;
    if (down) g.input.keys.add(code);
    else g.input.keys.delete(code);
  };
  w.__kill = (group?: string): number => {
    let n = 0;
    for (const e of game.enemies.enemies) {
      if (e.dead || e.friendly || (group && e.group !== group)) continue;
      e.damage(99999, new THREE.Vector3(0, 0, 1), game.player.position, 'torso', e.chest, { squad: game.enemies.squad, events: game.events });
      game.enemies.onDeath(e, { cover: g.cover });
      game.mode?.onKill(game, false);
      n++;
    }
    return n;
  };
  /**
   * Frame cost where the player stands, looking four ways: ms per whole frame (sim + render,
   * waited on the GPU), draw calls and triangles. Optionally starts a mission first.
   */
  w.__perf = async (id?: string, frames = 20): Promise<unknown> => {
    if (id) await (w.__start as (m: string) => Promise<string>)(id);
    const gl = game.renderer.gl;
    gl.setAnimationLoop(null);
    const ctx = gl.getContext();
    const px = new Uint8Array(4);
    const sync = (): void => ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    let meshes = 0, tris = 0, lights = 0;
    game.scene.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight) lights++;
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      meshes++;
      const n = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      tris += n * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
    });
    const views: unknown[] = [];
    let total = 0;
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      game.player.yaw = yaw;
      for (let i = 0; i < 3; i++) g.frame();
      sync();
      gl.info.autoReset = false;
      gl.info.reset();
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) g.frame();
      sync();
      const ms = (performance.now() - t0) / frames;
      total += ms;
      views.push({ yaw: +yaw.toFixed(2), ms: +ms.toFixed(2), calls: Math.round(gl.info.render.calls / frames), tris: Math.round(gl.info.render.triangles / frames) });
      gl.info.autoReset = true;
    }
    gl.setAnimationLoop(() => g.frame());
    return { map: game.map.id, avgMs: +(total / 4).toFixed(2), meshes, sceneTris: Math.round(tris), lights, views };
  };
  w.__st = (): unknown => ({
    stage: g.mode?.stage?.id, state: game.state,
    pos: game.player.position.toArray().map((v) => +v.toFixed(2)), hp: Math.round(game.player.health),
    alive: game.enemies.alive,
    groups: [...new Set(game.enemies.enemies.filter((e) => !e.dead).map((e) => e.group))],
    sub: document.querySelector('#hud-subtitle span')?.textContent?.slice(0, 70),
    obj: [...document.querySelectorAll('#hud-objectives .obj')].map((o) => (o.classList.contains('done') ? '[x] ' : '[ ] ') + o.textContent),
    fps: document.getElementById('fps')?.textContent,
  });
}
