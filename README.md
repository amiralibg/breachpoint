# BREACHPOINT

Browser FPS (Three.js + TypeScript + Vite) with a **Wave Survival** mode and a **Practice Range**.

## Run

```bash
npm install
npm run assets   # downloads the free CC0 assets (~130 MB) into public/assets
npm run dev      # http://localhost:5173
```

## Weapons

| Key | Weapon | Notes |
| --- | --- | --- |
| 1 | M4A1 carbine | Full auto, red-dot sight you look through, learnable spray climb |
| 2 | P-9 service pistol | Semi-auto, iron sights |
| 3 | M-91 sniper | Bolt action, magnified scope overlay, hold Shift to steady your breath |

The M4 is "Classic M4" from Sketchfab, exported through Blender with its sight lenses removed so you can
look through the tube (the game adds its own glass and projected dot). If `public/assets/models/m4/m4.glb`
is missing, the procedural M4 in `src/weapons/m4.ts` is used instead.

## Bots

- Hold their rifles with two-bone IK (low ready while moving, shouldered when engaging).
- Crouch, flinch when hit, kick on each shot, collapse and drop their weapon on death (`src/enemies/rig.ts`).
- AI (`src/enemies/enemies.ts`): cover finding and peeking, burst fire with aim settling, reloading in cover,
  retreating when hurt, flanker and rusher roles, shared squad intel, hearing gunshots, suppression.

## Assets

- Models, textures and HDRI: [Poly Haven](https://polyhaven.com) (CC0)
- "Classic M4" by [jeandiz](https://sketchfab.com/jeandiz) — [Sketchfab](https://sketchfab.com/3d-models/a747ebdbb3d941ecb09b459c62865a75), CC BY 4.0 (sling removed, lens faces removed, textures resized to 2K)
- "American Soldier Rigged" by [matheofrelin3](https://sketchfab.com/matheofrelin3) — [Sketchfab](https://sketchfab.com/3d-models/5b1967e7f83547be8a1c3ae656ab1ad4), CC BY 4.0 (bones renamed to Mixamo names)
- Idle/Walk/Run clips: three.js examples `Soldier.glb` (Mixamo-derived), retargeted at load time by `src/enemies/retarget.ts`.
  This character is also the fallback if `us_soldier.glb` is missing.
