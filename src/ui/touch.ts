import type { Input } from '../core/input';

/**
 * On-screen controls for phones and tablets. Everything here writes into `Input` exactly as the
 * keyboard and mouse would (virtual key codes, look deltas, an analog stick), so the command
 * builder, the simulation and any future netcode see no difference.
 *
 *  - left side: a movement stick resting in the corner; it jumps to wherever the thumb lands and
 *    goes back to the corner on release; push past the ring to sprint
 *  - right half: drag to look
 *  - fire also steers while held (aim and shoot with one thumb)
 *  - aim and crouch toggle; reload, jump, weapon swap tap
 *  - "use" and "steady" (hold breath on the scope) only show when they do something
 */

/** True when the primary pointer is a finger. `?touch=1` / `?touch=0` overrides it. */
export function wantsTouchControls(): boolean {
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  return matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
}

/** How far a finger has to move (CSS px) for the same turn as one mouse pixel. */
const LOOK_SCALE = 1.5;
const STICK_R = 56;

interface StickState {
  id: number;
  ox: number;
  oy: number;
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private stick: StickState | null = null;
  private looks = new Map<number, { x: number; y: number }>();
  private aimBtn!: HTMLButtonElement;
  private crouchBtn!: HTMLButtonElement;
  private useBtn!: HTMLButtonElement;
  private steadyBtn!: HTMLButtonElement;
  private aimOn = false;
  private crouchOn = false;
  private sprinting = false;
  private ctx = { interact: false, scoped: false };

  constructor(private input: Input, private onPause: () => void) {
    const root = document.createElement('div');
    root.id = 'touch';
    root.className = 'hidden';
    root.innerHTML = `
      <div class="t-zone t-move"></div>
      <div class="t-zone t-look"></div>
      <div class="t-stick rest"><i></i><span>MOVE</span></div>
      <button class="t-btn t-pause" aria-label="Pause"><span></span><span></span></button>
      <button class="t-btn t-fire" aria-label="Fire"></button>
      <button class="t-btn t-aim" aria-label="Aim">AIM</button>
      <button class="t-btn t-reload" aria-label="Reload">R</button>
      <button class="t-btn t-jump" aria-label="Jump">⤒</button>
      <button class="t-btn t-crouch" aria-label="Crouch">⤓</button>
      <button class="t-btn t-swap" aria-label="Switch weapon">⇄</button>
      <button class="t-btn t-use hidden" aria-label="Use">USE</button>
      <button class="t-btn t-steady hidden" aria-label="Hold breath">HOLD</button>
    `;
    document.body.appendChild(root);
    this.root = root;
    const $ = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
    this.stickBase = $('.t-stick');
    this.stickKnob = $('.t-stick i');
    this.stickHome();

    this.moveZone($('.t-move'));
    this.lookSurface($('.t-look'));

    const fire = $<HTMLButtonElement>('.t-fire');
    this.lookSurface(fire, () => {
      this.input.fire = true;
      this.input.firePressed = true;
    }, () => {
      this.input.fire = false;
    });

    this.aimBtn = $('.t-aim');
    this.button(this.aimBtn, () => this.setAim(!this.aimOn));
    this.crouchBtn = $('.t-crouch');
    this.button(this.crouchBtn, () => this.setCrouch(!this.crouchOn));
    this.button($('.t-reload'), () => this.input.tap('KeyR'));
    this.button($('.t-jump'), () => {
      if (this.crouchOn) this.setCrouch(false);
      this.input.tap('Space');
    });
    this.button($('.t-swap'), () => this.input.tap('KeyQ'));
    this.useBtn = $('.t-use');
    // Held: some interactions (search a body, plant) are a hold on E
    this.button(this.useBtn, () => this.input.press('KeyE'), () => this.input.release('KeyE'));
    this.steadyBtn = $('.t-steady');
    this.button(this.steadyBtn, () => this.input.press('ShiftLeft'), () => {
      if (!this.sprinting) this.input.release('ShiftLeft');
    });
    this.button($('.t-pause'), () => this.onPause());

    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (!on) this.reset();
  }

  /** What the touch layout should offer right now. Call once per frame while playing. */
  setContext(c: { interact: boolean; scoped: boolean }): void {
    if (c.interact !== this.ctx.interact) this.useBtn.classList.toggle('hidden', !c.interact);
    if (c.scoped !== this.ctx.scoped) this.steadyBtn.classList.toggle('hidden', !c.scoped);
    this.ctx = c;
  }

  /** The stick back in its corner, faded, waiting for the left thumb. */
  private stickHome(): void {
    this.stickBase.style.left = this.stickBase.style.top = '';
    this.stickKnob.style.transform = 'translate(-50%, -50%)';
    this.stickBase.classList.add('rest');
    this.stickBase.classList.remove('sprint');
  }

  private reset(): void {
    this.stick = null;
    this.stickHome();
    this.looks.clear();
    this.input.stickX = this.input.stickY = 0;
    this.input.fire = false;
    this.setAim(false);
    this.setCrouch(false);
    this.setSprint(false);
    this.input.release('KeyE');
    this.input.release('ShiftLeft');
  }

  private setAim(on: boolean): void {
    this.aimOn = on;
    this.input.aim = on;
    this.aimBtn?.classList.toggle('on', on);
    if (on) this.setSprint(false);
  }

  private setCrouch(on: boolean): void {
    this.crouchOn = on;
    if (on) this.input.press('KeyC');
    else this.input.release('KeyC');
    this.crouchBtn?.classList.toggle('on', on);
  }

  private setSprint(on: boolean): void {
    if (on === this.sprinting) return;
    this.sprinting = on;
    if (on) this.input.press('ShiftLeft');
    else this.input.release('ShiftLeft');
    this.stickBase.classList.toggle('sprint', on);
  }

  /** A tap target. `down` fires on touch, `up` on release (or cancel). */
  private button(el: HTMLElement, down: () => void, up?: () => void): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      el.classList.add('down');
      navigator.vibrate?.(8);
      down();
    });
    const end = (e: PointerEvent): void => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      el.releasePointerCapture(e.pointerId);
      el.classList.remove('down');
      up?.();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** Dragging on this element turns the view (and optionally holds something while touched). */
  private lookSurface(el: HTMLElement, down?: () => void, up?: () => void): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.classList.add('down');
      down?.();
    });
    el.addEventListener('pointermove', (e) => {
      const l = this.looks.get(e.pointerId);
      if (!l) return;
      // Coalesced events keep fast flicks smooth on high-rate touch screens
      const evs = e.getCoalescedEvents?.() ?? [];
      const list = evs.length ? evs : [e];
      for (const ev of list) {
        this.input.look((ev.clientX - l.x) * LOOK_SCALE, (ev.clientY - l.y) * LOOK_SCALE);
        l.x = ev.clientX;
        l.y = ev.clientY;
      }
    });
    const end = (e: PointerEvent): void => {
      if (!this.looks.delete(e.pointerId)) return;
      el.classList.remove('down');
      up?.();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  private moveZone(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.stick) return;
      el.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
      this.stickBase.classList.remove('rest');
    });
    el.addEventListener('pointermove', (e) => {
      const s = this.stick;
      if (!s || s.id !== e.pointerId) return;
      let dx = e.clientX - s.ox;
      let dy = e.clientY - s.oy;
      const d = Math.hypot(dx, dy);
      // Sprint: thumb pushed well past the ring, roughly forward
      const forward = dy < 0 && Math.abs(dx) < -dy * 0.75;
      this.setSprint(!this.aimOn && forward && d > STICK_R * 1.45);
      // The base follows a thumb that drifts far away, so the stick never runs out
      if (d > STICK_R * 2) {
        const k = (d - STICK_R * 2) / d;
        s.ox += dx * k;
        s.oy += dy * k;
        dx = e.clientX - s.ox;
        dy = e.clientY - s.oy;
        this.stickBase.style.left = `${s.ox}px`;
        this.stickBase.style.top = `${s.oy}px`;
      }
      const len = Math.hypot(dx, dy);
      const k = len > STICK_R ? STICK_R / len : 1;
      this.stickKnob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
      // Small dead zone, then a soft curve: fine adjustments near the centre, full speed at the ring
      const m = Math.min(1, len / STICK_R);
      const g = m < 0.12 ? 0 : Math.pow((m - 0.12) / 0.88, 1.3);
      this.input.stickX = len > 0 ? (dx / len) * g : 0;
      this.input.stickY = len > 0 ? (-dy / len) * g : 0;
    });
    const end = (e: PointerEvent): void => {
      if (!this.stick || this.stick.id !== e.pointerId) return;
      this.stick = null;
      this.input.stickX = this.input.stickY = 0;
      this.setSprint(false);
      this.stickHome();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}
