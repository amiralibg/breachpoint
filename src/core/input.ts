/** Keyboard + mouse state with pointer lock. */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
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
      if (['Space', 'Tab', 'F3', 'KeyF'].includes(e.code)) e.preventDefault();
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
      if (!this.locked) {
        this.keys.clear();
        this.fire = this.aim = false;
        this.onUnlock?.();
      }
    });
  }

  lock(): void {
    // Rejects if the browser refuses (e.g. no user gesture); the pause menu handles that state.
    const r = this.el.requestPointerLock() as Promise<void> | undefined;
    r?.catch(() => {});
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
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
