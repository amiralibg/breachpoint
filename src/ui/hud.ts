const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** DOM heads-up display. */
export class Hud {
  private root = $('hud');
  private health = $('hud-health');
  private healthBar = $('hud-health-bar');
  private armor = $('hud-armor');
  private ammo = $('hud-ammo');
  private reserve = $('hud-reserve');
  private weaponName = $('hud-weapon');
  private title = $('hud-title');
  private detail = $('hud-detail');
  private score = $('hud-score');
  private alive = $('hud-alive');
  private crosshair = $('crosshair');
  private hitmarker = $('hitmarker');
  private damage = $('damage-vignette');
  private bannerEl = $('banner');
  private feed = $('killfeed');
  private fps = $('fps');
  private reloadEl = $('hud-reload');
  private dirIndicator = $('damage-dir');
  private scope = $('scope');
  private breathBar = $('breath-bar');
  private slots = Array.from(document.querySelectorAll<HTMLElement>('#hud-slots i'));
  private magbar = $('hud-magbar');
  private br = document.querySelector<HTMLElement>('.hud-br')!;
  private prompt = $('ammo-prompt');
  private interactEl = $('hud-interact');
  private toastsEl = $('hud-toasts');
  private suppressEl = $('suppress-vignette');
  private grenadeEl = $('grenade-warn');
  private objectivesEl = $('hud-objectives');
  private markersEl = $('hud-markers');
  private subtitleEl = $('hud-subtitle');
  private progressEl = $('hud-progress');
  private clockEl = $('hud-clock');
  private objectivesKey = '';
  private suppressT = 0;
  private scoped = false;
  private hitT = 0;
  private damageT = 0;
  private bannerT = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  setFpsVisible(on: boolean): void {
    this.fps.classList.toggle('hidden', !on);
  }

  update(dt: number, s: {
    health: number; armor: number; mag: number; magSize: number; reserve: number | string; weapon: string; slot: number;
    title: string; detail: string; score: number; alive: number; spread: number; aiming: boolean; reloading: boolean;
    outOfAmmo: boolean;
  }): void {
    this.slots.forEach((el, i) => el.classList.toggle('on', i === s.slot));
    this.magbar.style.setProperty('--fill', `${(s.mag / s.magSize) * 100}%`);
    const reserveLeft = typeof s.reserve === 'string' || s.reserve > 0;
    const low = s.mag > 0 && s.mag <= Math.ceil(s.magSize * 0.25);
    const dry = s.mag === 0;
    this.br.classList.toggle('low', low && !s.reloading);
    this.br.classList.toggle('dry', dry && !s.reloading);
    let msg = '';
    if (!s.reloading) {
      if (s.outOfAmmo || (dry && !reserveLeft)) msg = 'NO AMMO · SWITCH WEAPON';
      else if (dry) msg = 'RELOAD [R]';
      else if (low && reserveLeft) msg = 'LOW AMMO';
    }
    this.prompt.textContent = msg;
    this.prompt.classList.toggle('hidden', !msg);
    this.prompt.classList.toggle('dry', dry);
    this.suppressT = Math.max(0, this.suppressT - dt * 0.8);
    this.suppressEl.style.opacity = String(Math.min(1, this.suppressT));
    this.health.textContent = String(Math.ceil(s.health));
    this.healthBar.style.width = `${s.health}%`;
    this.healthBar.classList.toggle('low', s.health < 30);
    this.armor.textContent = String(Math.ceil(s.armor));
    this.ammo.textContent = String(s.mag);
    this.ammo.classList.toggle('empty', s.mag === 0);
    this.reserve.textContent = String(s.reserve);
    this.weaponName.textContent = s.weapon;
    this.title.textContent = s.title;
    this.detail.textContent = s.detail;
    this.score.textContent = String(s.score);
    this.alive.textContent = String(s.alive);
    this.reloadEl.classList.toggle('hidden', !s.reloading);

    // Dynamic crosshair: gap grows with spread (radians -> px at ~1000px focal)
    const gap = 4 + Math.min(60, s.spread * 900);
    this.crosshair.style.setProperty('--gap', `${gap}px`);
    this.crosshair.classList.toggle('hidden', s.aiming);

    this.hitT -= dt;
    this.hitmarker.style.opacity = this.hitT > 0 ? String(Math.min(1, this.hitT * 6)) : '0';
    this.damageT = Math.max(0, this.damageT - dt * 1.5);
    this.damage.style.opacity = String(this.damageT);
    this.dirIndicator.style.opacity = String(Math.min(1, this.damageT * 1.5));
    this.bannerT -= dt;
    this.bannerEl.classList.toggle('visible', this.bannerT > 0);

    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps.textContent = `${Math.round(this.fpsFrames / this.fpsAcc)} FPS`;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  setScope(on: boolean, breath: number): void {
    if (on !== this.scoped) {
      this.scoped = on;
      this.scope.classList.toggle('hidden', !on);
    }
    if (on) this.breathBar.style.width = `${Math.round(breath * 100)}%`;
  }

  /** A bullet snapped past: darken the edges briefly. */
  suppress(amount: number): void {
    this.suppressT = Math.min(1.2, this.suppressT + amount);
  }

  /** Grenade indicators: on screen where visible, otherwise pinned to the edge toward them. */
  grenades(list: { x: number; y: number; z: number }[], camera: { position: { distanceTo(v: unknown): number } } & import('three').Camera, playerPos: import('three').Vector3): void {
    const near = list.filter((g) => playerPos.distanceTo(g as import('three').Vector3) < 10);
    while (this.grenadeEl.children.length < near.length) {
      const d = document.createElement('div');
      d.className = 'gw';
      d.textContent = '!';
      this.grenadeEl.appendChild(d);
    }
    while (this.grenadeEl.children.length > near.length) this.grenadeEl.lastChild!.remove();
    const w = window.innerWidth, h = window.innerHeight;
    near.forEach((g, i) => {
      const v = (g as import('three').Vector3).clone().project(camera);
      let x = v.x, y = v.y;
      if (v.z > 1) {
        x = -x;
        y = -y;
      }
      const m = Math.max(Math.abs(x), Math.abs(y));
      if (m > 0.9 || v.z > 1) {
        x = (x / m) * 0.9;
        y = (y / m) * 0.9;
      }
      const el = this.grenadeEl.children[i] as HTMLElement;
      el.style.left = `${((x + 1) / 2) * w}px`;
      el.style.top = `${((1 - y) / 2) * h}px`;
    });
  }

  hit(headshot: boolean, kill: boolean): void {
    this.hitT = 0.25;
    this.hitmarker.classList.toggle('head', headshot);
    this.hitmarker.classList.toggle('kill', kill);
  }

  /** `angle` is the direction of the attacker relative to view, radians (0 = in front). */
  hurt(amount: number, angle: number): void {
    this.damageT = Math.min(1, this.damageT + amount / 40);
    this.dirIndicator.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
  }

  banner(title: string, sub: string, seconds = 3.5): void {
    this.bannerEl.querySelector('h2')!.textContent = title;
    this.bannerEl.querySelector('p')!.textContent = sub;
    this.bannerT = seconds;
  }

  killFeed(text: string, headshot: boolean): void {
    const el = document.createElement('div');
    el.className = 'feed-item';
    el.innerHTML = `<span>YOU</span> <i>${headshot ? '⌖ HEADSHOT' : '▸'}</i> <span class="enemy">${text}</span>`;
    this.feed.prepend(el);
    setTimeout(() => el.classList.add('fade'), 3500);
    setTimeout(() => el.remove(), 4200);
    while (this.feed.children.length > 5) this.feed.lastChild?.remove();
  }

  clearFeed(): void {
    this.setScope(false, 1);
    this.feed.innerHTML = '';
    this.bannerT = 0;
    this.damageT = 0;
  }

  /** Story missions hide the score and show objectives instead. */
  setStory(on: boolean): void {
    this.root.classList.toggle('story', on);
    if (!on) {
      this.objectives([]);
      this.markers([], null, null);
      this.subtitle(null);
      this.progress(null);
      this.clock(null, false);
    }
  }

  objectives(list: { text: string; done: boolean; optional: boolean }[]): void {
    const key = list.map((o) => `${o.done ? 1 : 0}${o.optional ? 1 : 0}${o.text}`).join('|');
    if (key === this.objectivesKey) return;
    this.objectivesKey = key;
    this.objectivesEl.replaceChildren(...list.map((o) => {
      const el = document.createElement('div');
      el.className = `obj${o.done ? ' done' : ''}${o.optional ? ' optional' : ''}`;
      el.textContent = o.text;
      return el;
    }));
  }

  /** Objective markers: a diamond with the distance, pinned to the screen edge when out of view. */
  markers(list: { pos: import('three').Vector3; label: string }[], camera: import('three').Camera | null, playerPos: import('three').Vector3 | null): void {
    while (this.markersEl.children.length < list.length) {
      const d = document.createElement('div');
      d.className = 'marker';
      d.innerHTML = '<i></i><span></span>';
      this.markersEl.appendChild(d);
    }
    while (this.markersEl.children.length > list.length) this.markersEl.lastChild!.remove();
    if (!camera || !playerPos) return;
    const w = window.innerWidth, h = window.innerHeight;
    list.forEach((m, i) => {
      const v = m.pos.clone().project(camera);
      let x = v.x, y = v.y;
      const behind = v.z > 1;
      if (behind) {
        x = -x;
        y = -y;
      }
      const k = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86);
      const off = behind || k > 1;
      if (off) {
        const s = k > 1e-4 ? 1 / k : 1;
        x *= behind && k < 1 ? 1 / Math.max(k, 0.2) * 0.9 : s;
        y *= behind && k < 1 ? 1 / Math.max(k, 0.2) * 0.9 : s;
        x = Math.max(-0.92, Math.min(0.92, x));
        y = Math.max(-0.86, Math.min(0.86, y));
      }
      const el = this.markersEl.children[i] as HTMLElement;
      el.classList.toggle('off', off);
      el.style.left = `${((x + 1) / 2) * w}px`;
      el.style.top = `${((1 - y) / 2) * h}px`;
      el.lastElementChild!.textContent = `${Math.round(playerPos.distanceTo(m.pos))} m`;
    });
  }

  /** Radio line at the bottom of the screen. */
  subtitle(who: string | null, text = ''): void {
    if (!who) {
      this.subtitleEl.classList.remove('visible');
      return;
    }
    this.subtitleEl.dataset.who = who.toLowerCase();
    this.subtitleEl.querySelector('b')!.textContent = who;
    this.subtitleEl.querySelector('span')!.textContent = text;
    this.subtitleEl.classList.add('visible');
  }

  progress(bar: { label: string; frac: number } | null): void {
    this.progressEl.classList.toggle('hidden', !bar);
    if (!bar) return;
    this.progressEl.querySelector('span')!.textContent = bar.label.toUpperCase();
    (this.progressEl.querySelector('i') as HTMLElement).style.width = `${Math.min(100, bar.frac * 100)}%`;
  }

  clock(text: string | null, urgent: boolean): void {
    this.clockEl.classList.toggle('hidden', !text);
    if (text) this.clockEl.textContent = text;
    this.clockEl.classList.toggle('urgent', urgent);
  }

  setInteractPrompt(prompt: { key: string; action: string; detail: string } | null): void {
    if (!this.interactEl) return;
    if (!prompt) {
      this.interactEl.classList.add('hidden');
      return;
    }
    this.interactEl.classList.remove('hidden');
    const keyEl = this.interactEl.querySelector('.interact-key');
    const actionEl = this.interactEl.querySelector('.interact-action');
    const detailEl = this.interactEl.querySelector('.interact-detail');
    if (keyEl) keyEl.textContent = prompt.key;
    if (actionEl) actionEl.textContent = prompt.action;
    if (detailEl) detailEl.textContent = prompt.detail;
  }

  lootNotification(title: string, sub?: string): void {
    if (!this.toastsEl) return;
    const toast = document.createElement('div');
    toast.className = 'loot-toast';
    toast.innerHTML = `<span class="loot-icon">◈</span> <span class="loot-title">${title}</span>${sub ? ` <span class="loot-sub">${sub}</span>` : ''}`;
    this.toastsEl.appendChild(toast);
    setTimeout(() => toast.classList.add('fade-out'), 2000);
    setTimeout(() => toast.remove(), 2450);
  }
}
