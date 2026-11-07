# BREACHPOINT

Browser FPS (Three.js + TypeScript + Vite) with a **Wave Survival** mode and a **Practice Range**.

## Run

```bash
npm install
npm run assets   # downloads the free CC0 assets (~130 MB) into public/assets
npm run sounds   # (re)generates the sound effects into public/assets/audio
npm run dev      # http://localhost:5173
```

## Weapons

| Key | Weapon | Notes |
| --- | --- | --- |
| 1 | M4A1 carbine | Full auto, red-dot sight you look through, learnable spray climb |
| 2 | P-9 service pistol | Semi-auto, iron sights |
| 3 | M-91 sniper | Bolt action, magnified scope overlay, hold Shift to steady your breath |

Switch with `1` `2` `3`, `Q` or the mouse wheel. `R` reloads (a tactical reload keeps the mag;
an empty one drops it and racks the bolt/slide), `F` inspects, `F3` shows the AI debug overlay.
Firing an empty gun clicks and reloads; with no ammo left it switches to a gun that has some.

## Animation

- First-person arms: the soldier model's arms are solved with two-bone IK onto per-weapon hand
  anchors, with hand orientation and finger curl (`src/weapons/arms.ts`, `src/core/ik.ts`).
- Weapon actions are keyframed timelines (`src/weapons/timeline.ts`, data in `weapons.ts`): draw,
  holster, tactical/empty reloads, bolt cycling and inspect. They move the gun, its parts
  (magazine, charging handle, bolt, slide) and switch hand anchors; events play the recorded
  sounds. Empty magazines drop into the world as physics props; casings eject.
- Spring-based kick, mouse-lag sway, strafe tilt, walk bob, sprint and landing.

The M4 is "Classic M4" from Sketchfab, exported through Blender with its sight lenses removed so you can
look through the tube (the game adds its own glass and projected dot). If `public/assets/models/m4/m4.glb`
is missing, the procedural M4 in `src/weapons/m4.ts` is used instead.

## Bots

- Navigation: Recast/Detour navmesh baked from the map at load, Detour crowd for movement with
  local avoidance (`src/world/navmesh.ts`, `recast-navigation`).
- Perception: vision cone with an awareness meter (distance, stance, movement, how much of you is
  visible), hearing (gunshots, footsteps, reloads), memory with short-term prediction.
- Squad (`src/enemies/squad.ts`): radio-delayed shared intel, at most 3 bots shooting at once
  (attack tokens), flankers on opposite sides, camping detection, grenade timing.
- Tactics (`src/enemies/enemies.ts`): cover chosen by the least-exposed route, peek and lean,
  suppressing fire at your last position, flanking, pushing when you reload or are hurt,
  falling back when hurt, reloading behind cover, dodging when you aim at them, fleeing grenades,
  never shooting through squad mates. Bullets are traced for real, so cover stops them.
- Animation (`src/enemies/rig.ts`): strafing and backpedalling (lower body turns, walk clip runs in
  reverse), crouch-walk, lean, procedural reload with a dropped magazine, grenade throw,
  directional flinch and stagger, bone-capsule hitboxes (head, torso, arms, legs).
- Death: Rapier ragdoll with hinge-limited knees and elbows that inherits the body's motion and the
  bullet's push; the rifle drops as a physics prop (`src/enemies/ragdoll.ts`, `src/world/physics3d.ts`).

## Online

Not networked yet, but the simulation runs in fixed 60 Hz ticks from serializable
`PlayerCommand`s and reports through `GameEvent`s. See [docs/ONLINE.md](docs/ONLINE.md).

## Assets

- Models, textures and HDRI: [Poly Haven](https://polyhaven.com) (CC0)
- "Classic M4" by [jeandiz](https://sketchfab.com/jeandiz) — [Sketchfab](https://sketchfab.com/3d-models/a747ebdbb3d941ecb09b459c62865a75), CC BY 4.0 (sling removed, lens faces removed, textures resized to 2K)
- "American Soldier Rigged" by [matheofrelin3](https://sketchfab.com/matheofrelin3) — [Sketchfab](https://sketchfab.com/3d-models/5b1967e7f83547be8a1c3ae656ab1ad4), CC BY 4.0 (bones renamed to Mixamo names)
- Idle/Walk/Run clips: three.js examples `Soldier.glb` (Mixamo-derived), retargeted at load time by `src/enemies/retarget.ts`.
  This character is also the fallback if `us_soldier.glb` is missing.
