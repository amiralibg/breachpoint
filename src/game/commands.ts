import type { Input } from '../core/input';
import { Btn, type PlayerCommand } from '../net/protocol';

/**
 * Turns raw keyboard/mouse state into PlayerCommands. Edge-triggered buttons (jump, reload...)
 * pressed during a frame are latched until the next tick consumes them, so a key tapped between
 * ticks is never lost, and never applied twice when a frame runs several ticks.
 */
export class CommandBuilder {
  private latched = 0;
  private weapon = -1;
  private wheel = 0;

  /** Call once per rendered frame, before ticking. */
  sample(input: Input): void {
    const k = (code: string): boolean => input.hit(code);
    if (input.firePressed) this.latched |= Btn.Fire;
    if (k('KeyR')) this.latched |= Btn.Reload;
    if (k('Space')) this.latched |= Btn.Jump;
    if (k('KeyF')) this.latched |= Btn.Inspect;
    if (k('KeyE')) this.latched |= Btn.Interact;
    if (k('KeyQ')) this.latched |= Btn.NextWeapon;
    if (k('Digit1')) this.weapon = 0;
    if (k('Digit2')) this.weapon = 1;
    if (k('Digit3')) this.weapon = 2;
    this.wheel += input.wheel;
  }

  build(input: Input, tick: number, yaw: number, pitch: number): PlayerCommand {
    let buttons = 0;
    if (input.fire) buttons |= Btn.Fire;
    if (input.aim) buttons |= Btn.Aim;
    if (input.down('ShiftLeft')) buttons |= Btn.Sprint;
    if (input.down('ControlLeft') || input.down('KeyC')) buttons |= Btn.Crouch;
    let pressed = this.latched;
    if (this.wheel > 0) pressed |= Btn.NextWeapon;
    if (this.wheel < 0) pressed |= Btn.PrevWeapon;
    const cmd: PlayerCommand = {
      tick,
      buttons,
      pressed,
      moveX: (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0),
      moveZ: (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0),
      yaw,
      pitch,
      weapon: this.weapon,
    };
    this.latched = 0;
    this.weapon = -1;
    this.wheel = 0;
    return cmd;
  }
}
