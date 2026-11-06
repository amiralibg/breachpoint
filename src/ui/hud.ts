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
    health: number; armor: number; mag: number; reserve: number | string; weapon: string;
    title: string; detail: string; score: number; alive: number; spread: number; aiming: boolean; reloading: boolean;
  }): void {
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
}
