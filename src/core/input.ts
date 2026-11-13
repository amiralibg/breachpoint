/**
 * Keyboard + mouse state with pointer lock. On touch devices there is no pointer lock: `touchMode`
 * makes lock/unlock plain flags (plus fullscreen), and the touch controls (src/ui/touch.ts) write
 * into the same state as the keyboard and mouse: virtual keys, look deltas, an analog stick.
 */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  /** Analog movement from the touch stick, -1..1 (right, forward). Added to WASD. */
  stickX = 0;
  stickY = 0;
  touchMode = false;
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  fire = false;
  firePressed = false;
  aim = false;
  locked = false;
  onUnlock: (() => void) | null = null;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab', 'F3', 'KeyF', 'KeyE'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.fire = true;
        this.firePressed = true;
      }
      if (e.button === 2) this.aim = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.aim = false;
    });
    window.addEventListener('wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (this.touchMode) return;
      if (!this.locked) {
        this.releaseAll();
        this.onUnlock?.();
      }
    });
  }

  lock(): void {
    if (this.touchMode) {
      this.locked = true;
      // Best effort: phones refuse without a fresh tap, iPhones have no element fullscreen at all
      const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
      if (!document.fullscreenElement) {
        try {
          const r = el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.();
          (r as Promise<void> | undefined)?.then(() => {
            const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
            return o.lock?.('landscape');
          }).catch(() => {});
        } catch { /* not supported */ }
      }
      return;
    }
    // Rejects if the browser refuses (e.g. no user gesture); the pause menu handles that state.
    const r = this.el.requestPointerLock() as Promise<void> | undefined;
    r?.catch(() => {});
  }

  unlock(): void {
    if (this.touchMode) {
      if (!this.locked) return;
      this.locked = false;
      this.releaseAll();
      this.onUnlock?.();
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Virtual key from the touch controls (same codes as the keyboard). */
  press(code: string): void {
    if (!this.locked) return;
    if (!this.keys.has(code)) this.pressed.add(code);
    this.keys.add(code);
  }

  release(code: string): void {
    this.keys.delete(code);
  }

  /** A single tap of a key: down this frame, up before the next. */
  tap(code: string): void {
    if (!this.locked) return;
    this.pressed.add(code);
  }

  look(dx: number, dy: number): void {
    if (!this.locked) return;
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  private releaseAll(): void {
    this.keys.clear();
    this.fire = this.aim = false;
    this.stickX = this.stickY = 0;
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** True only on the frame the key went down. */
  hit(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.wheel = 0;
    this.firePressed = false;
  }
}
