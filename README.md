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

Switch with `1` `2` `3`, `Q` or the mouse wheel. `R` reloads (from empty the reload also
sends the bolt or slide home), `F` inspects, `F3` shows the AI debug overlay.
Firing an empty gun clicks and reloads; with no ammo left it switches to a gun that has some.

`E` picks up what you are looking at: a fallen enemy's gun (you reach for it and bring it up in
place of the one you hold, or strip its magazine if you already carry that gun) or the body itself,
searched once for spare ammo (`src/world/loot.ts`).

## Animation

- First-person arms: a purpose-built arms model (`fp_arms.glb`), sized by its hand so any rig holds
  the guns at the same scale, solved with two-bone IK onto hand anchors on the
  weapon (`src/weapons/arms.ts`, `src/core/ik.ts`). The elbow swings to keep the wrist straight,
  the forearm shares the wrist's roll, and the shoulders give way so an arm is never folded up
  into view.
- Grips are solved against the gun's real mesh, not proxy shapes (`src/weapons/grip.ts`,
  `src/weapons/surface.ts`): each anchor says roughly where a hand goes, then the palm is seated
  on the surface and every finger closes until its skin touches. Finger thickness and flexion
  axes are measured from the hand model, so another rig with Mixamo bone names drops in. Grips
  are solved once at load (about 30 ms for all three guns) and blended at runtime. A hand moving
  between grips lifts off, opens, and is pushed clear of the gun on the way.
- Weapon actions are keyframed timelines (`src/weapons/timeline.ts`, data in `weapons.ts`): draw,
  holster, tactical/empty reloads, bolt cycling, inspect and reaching for loot. They move the gun,
  its parts (magazine, bolt, slide) and send each hand to a named grip; events play the recorded
  sounds. The pistol's old magazine drops into the world as a physics prop; casings eject.
- Against a wall the gun comes back into a high ready instead of poking through it.
- Spring-based kick, mouse-lag sway, strafe tilt, walk bob, sprint and landing.

Adding a gun: give it rough hand anchors in `weapons.ts`, then in the dev console run
`__game.weapons.fitGrip('guard', 'l')` for each one. It tries nearby placements, keeps the one
that puts most of the hand on the model, applies it live and returns the numbers to paste back.
`__game.weapons.debugHands = { l: 'mag' }` holds a hand on an anchor so you can look at it.

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
- Roles and weapons: riflemen (M4) work cover to cover, flankers (pistol) close the distance before
  they fight, rushers run you down, and marksmen (bolt-action) hang back, kneel and line up a shot.
  A marksman's scope glints and grows while he settles: stand still and you get hit, move and he
  mostly misses. Bots in cover lay down covering fire while a squad mate crosses open ground.
- Models: three soldier models share one set of animations (`SOLDIER_MODELS` in `enemies.ts`); each
  spawn picks one and gets a slightly different height. Any Mixamo-rigged character exported in
  T-pose can be added to that list.
- Animation (`src/enemies/rig.ts`): strafing and backpedalling (lower body turns, walk clip runs in
  reverse), crouch-walk, lean, procedural reload with a dropped magazine, grenade throw,
  directional flinch and stagger, bone-capsule hitboxes (head, torso, arms, legs).
  Per-weapon holds (rifle in the shoulder, pistol pushed out two-handed, long rifle), a head that
  tracks what the bot is looking at, a body that leans into runs, turns and stops, and a gun that
  rides the stride and the breath and swings onto its target instead of snapping.
- Death: Rapier ragdoll with hinge-limited knees and elbows that inherits the body's motion and the
  bullet's push; the rifle drops as a physics prop (`src/enemies/ragdoll.ts`, `src/world/physics3d.ts`).

## Online

Not networked yet, but the simulation runs in fixed 60 Hz ticks from serializable
`PlayerCommand`s and reports through `GameEvent`s. See [docs/ONLINE.md](docs/ONLINE.md).

## Assets

- Models, textures and HDRI: [Poly Haven](https://polyhaven.com) (CC0)
- "Classic M4" by [jeandiz](https://sketchfab.com/jeandiz) — [Sketchfab](https://sketchfab.com/3d-models/a747ebdbb3d941ecb09b459c62865a75), CC BY 4.0 (sling removed, lens faces removed, textures resized to 2K)
- "First Person arms" by [bumstrum](https://sketchfab.com/bumstrum) — [Sketchfab](https://sketchfab.com/3d-models/e3c42c05b22944e5839deb8e003f0987), CC BY 4.0 (bones renamed to Mixamo names, two forearm twist bones added per arm, textures as JPEG). `public/assets/characters/fp_arms.glb`; the soldier's own arms are used if it is missing.
- "German KSK operator - rigged" and "German Bundeswehr soldier - rigged" by [42manako](https://sketchfab.com/42manako) — Sketchfab ([KSK](https://sketchfab.com/3d-models/110daf3d1884412989e41dc95866c579), [Bundeswehr](https://sketchfab.com/3d-models/3d7944fea17b494abf220cc11ddabfd1)), CC BY 4.0 (re-posed to a T-pose, bones renamed to Mixamo names, textures as JPEG)
- "American Soldier Rigged" by [matheofrelin3](https://sketchfab.com/matheofrelin3) — [Sketchfab](https://sketchfab.com/3d-models/5b1967e7f83547be8a1c3ae656ab1ad4), CC BY 4.0 (bones renamed to Mixamo names)
- Idle/Walk/Run clips: three.js examples `Soldier.glb` (Mixamo-derived), retargeted at load time by `src/enemies/retarget.ts`.
  This character is also the fallback if `us_soldier.glb` is missing.
