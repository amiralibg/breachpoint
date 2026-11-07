# Online play: how the code is set up for it

Nothing is networked yet. The single-player game is built so that adding a server later means
moving code, not rewriting it.

## What is already in place

| Piece | Where | Why it matters online |
| --- | --- | --- |
| Fixed 60 Hz simulation tick | `Game.frame` / `Game.simulate` (`src/game/game.ts`), `TICK_RATE` in `src/net/protocol.ts` | Client and server step the same way. Rendering interpolates between ticks (`Player.render`, `Enemy.render`). |
| `PlayerCommand` per tick | `src/net/protocol.ts`, built by `src/game/commands.ts` | The only thing a client sends: buttons, move axes, view angles, weapon slot. Edge buttons are latched, so none are lost or doubled. |
| Movement driven by commands | `Player.simulate(cmd, dt, colliders)` | Deterministic given the command and the map, so the server can run it and the client can predict and replay it. |
| Weapon logic driven by commands | `WeaponController.tick(cmd, dt, player)` | Ammo, fire timing, reloads and switching are simulation; `WeaponController.render` is presentation only. |
| Simulation -> presentation events | `EventBus` (`src/game/events.ts`), `GameEvent` union in `protocol.ts` | Audio, HUD and effects react to events (`fire`, `hit`, `impact`, `explosion`, `enemyFire`...). Online, the same events arrive from the server. `EventBus.recording` + `drain()` give a per-tick outbox. |
| Entity ids, snapshot types | `Enemy.id`, `Player.id`, `EntitySnapshot` / `WorldSnapshot` | What the server broadcasts so clients can render remote players and bots. |
| Server-capable libraries | Recast navigation (WASM), Rapier physics (WASM), bot AI | All run in Node with no DOM. The AI only needs `EnemyCtx`, which holds no rendering objects except optional effects/audio hooks. |

## Recommended architecture

- **Authoritative server** in Node (TypeScript, sharing `src/net`, `src/player/player.ts`,
  `src/weapons/*` logic, `src/enemies/*` AI and `src/world/{map colliders, navmesh, physics3d}`).
  A room framework such as Colyseus, or plain `ws`, handles rooms and matchmaking.
  WebSocket is enough for a start; WebTransport/WebRTC (unreliable datagrams) is better for
  snapshots once it matters.
- **Client prediction + reconciliation** for the local player: apply commands immediately,
  keep the unacknowledged ones, and when a snapshot arrives with `ackTick`, reset to the server
  state and replay the rest.
- **Interpolation** for everything else: render remote entities ~100 ms in the past between
  two snapshots (the render path already lerps between two states).
- **Lag-compensated hits**: the server keeps ~250 ms of hitbox history (bone capsules from
  `SoldierRig.raycast`) and rewinds to the shooter's view time before tracing.
- **Co-op Wave Survival first**: bots stay server-side and the `Squad` naturally spreads
  attack tokens across several players. PvP needs the same pieces plus player-vs-player hitboxes.

## Work still needed

1. Split `Game` into `Simulation` (no three.js renderer/DOM) and `ClientView`.
   The rig still uses three.js scene objects for bone hitboxes; on the server, run the rig
   headless (no renderer is needed, `SoldierRig.update` only does math on bones).
2. Make enemy spawning/random choices seedable (`Math.random` -> a seeded PRNG per room).
3. Serialize `WorldSnapshot` compactly (quantized positions, delta against the last ack).
4. Move `onPlayerHit` and score into per-player state.
