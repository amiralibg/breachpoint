import * as THREE from 'three';
import type { Audio } from '../core/audio';
import type { EventBus } from '../game/events';
import type { WeaponController } from '../weapons/controller';
import type { WeaponDef } from '../weapons/weapons';
import type { PhysicsWorld } from './physics3d';
import type { Enemy } from '../enemies/enemies';
import type { Hud } from '../ui/hud';

export interface LootDrop {
  id: number;
  type: 'weapon' | 'ammo';
  weaponDef: WeaponDef;
  ammo: number;
  obj: THREE.Object3D;
  position: THREE.Vector3;
  life: number;
  maxLife: number;
  pickedUp: boolean;
  marker?: THREE.Mesh;
}

export interface CasualtyLoot {
  id: number;
  enemy: Enemy;
  weaponDef: WeaponDef;
  ammo: number;
  position: THREE.Vector3;
  searched: boolean;
}

export interface InteractCandidate {
  kind: 'drop' | 'casualty';
  drop?: LootDrop;
  casualty?: CasualtyLoot;
  action: 'pickup_weapon' | 'loot_ammo' | 'search_casualty';
  promptKey: string;
  promptAction: string;
  promptDetail: string;
  weaponDef: WeaponDef;
  ammo: number;
  position: THREE.Vector3;
  distance: number;
}

let nextLootId = 1;

/**
 * Manages dropped weapons and ammo from fallen enemies and map spawns.
 * Provides tactical looting interaction, physical dropped weapons,
 * and high-polish presentation feedback.
 */
export class LootManager {
  readonly drops: LootDrop[] = [];
  readonly casualties: CasualtyLoot[] = [];
  private markerGeo: THREE.RingGeometry;
  private markerMat: THREE.MeshBasicMaterial;

  constructor(
    private scene: THREE.Scene,
    private phys: PhysicsWorld | null,
  ) {
    this.markerGeo = new THREE.RingGeometry(0.18, 0.22, 16);
    this.markerMat = new THREE.MeshBasicMaterial({
      color: 0x9eff4a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
  }

  setPhysics(phys: PhysicsWorld): void {
    this.phys = phys;
  }

  /**
   * Spawn a dropped weapon into the world with physics tumbling and tactical interactability.
   */
  spawnWeaponDrop(
    def: WeaponDef,
    obj: THREE.Object3D,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    ammo: number,
    opts: { size?: THREE.Vector3; center?: THREE.Vector3; life?: number } = {},
  ): LootDrop {
    const id = nextLootId++;
    obj.position.copy(pos);
    if (!obj.parent) this.scene.add(obj);

    const life = opts.life ?? 45;
    const size = opts.size ?? new THREE.Vector3(0.18, 0.22, 0.85);
    const center = opts.center ?? new THREE.Vector3(0, 0, 0);

    if (this.phys) {
      this.phys.spawnProp(obj, {
        size,
        center,
        vel,
        spin: new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 5),
        density: 450,
        restitution: 0.2,
        life,
      });
    }

    // Subtle tactical ground marker ring
    const marker = new THREE.Mesh(this.markerGeo, this.markerMat.clone());
    marker.rotation.x = -Math.PI / 2;
    marker.position.copy(pos).setY(0.04);
    marker.visible = false;
    this.scene.add(marker);

    const drop: LootDrop = {
      id,
      type: 'weapon',
      weaponDef: def,
      ammo,
      obj,
      position: pos.clone(),
      life,
      maxLife: life,
      pickedUp: false,
      marker,
    };

    this.drops.push(drop);
    return drop;
  }

  /**
   * Register a fallen casualty as searchable for ammo/gear.
   */
  registerCasualty(enemy: Enemy, weaponDef: WeaponDef, ammo: number): void {
    this.casualties.push({
      id: enemy.id,
      enemy,
      weaponDef,
      ammo,
      position: enemy.position.clone(),
      searched: false,
    });
  }

  /**
   * Check what the player is looking at within interaction distance (~2.8m).
   */
  queryInteract(
    cameraPos: THREE.Vector3,
    cameraDir: THREE.Vector3,
    weapons: WeaponController,
    maxDist = 2.8,
  ): InteractCandidate | null {
    let bestCandidate: InteractCandidate | null = null;
    let bestScore = -Infinity;

    // Check dropped weapons & ammo props
    for (const drop of this.drops) {
      if (drop.pickedUp || drop.life <= 0) continue;
      const worldPos = new THREE.Vector3();
      drop.obj.getWorldPosition(worldPos);
      drop.position.copy(worldPos);

      const toItem = worldPos.clone().sub(cameraPos);
      const dist = toItem.length();
      if (dist > maxDist || dist < 0.2) continue;

      const dir = toItem.clone().normalize();
      const dot = dir.dot(cameraDir);
      // Generous cone when close, tighter when further
      const minDot = dist < 1.5 ? 0.6 : 0.85;
      if (dot < minDot) continue;

      const score = dot * 2 - dist * 0.5;
      if (score > bestScore) {
        bestScore = score;
        // A dropped enemy weapon remains a real pickup even when the player already unlocked
        // that weapon type (as in survival mode). Taking it switches to that weapon and adds
        // its ammunition; only the currently held duplicate becomes an ammo-only pickup.
        const takeWeapon = !weapons.hasWeapon(drop.weaponDef.id) || !weapons.isCurrentWeapon(drop.weaponDef.id);
        const action: 'pickup_weapon' | 'loot_ammo' = takeWeapon ? 'pickup_weapon' : 'loot_ammo';
        const promptAction = takeWeapon ? `TAKE ${drop.weaponDef.name.toUpperCase()}` : `LOOT ${drop.weaponDef.name.toUpperCase()}`;
        const promptDetail = takeWeapon ? `SWAP · +${drop.ammo} ROUNDS` : `+${drop.ammo} AMMO`;

        bestCandidate = {
          kind: 'drop',
          drop,
          action,
          promptKey: 'E',
          promptAction,
          promptDetail,
          weaponDef: drop.weaponDef,
          ammo: drop.ammo,
          position: worldPos,
          distance: dist,
        };
      }
    }

    // If no dropped weapon directly targeted, check casualties
    if (!bestCandidate) {
      for (const cas of this.casualties) {
        if (cas.searched || !cas.enemy.dead) continue;
        const pos = cas.enemy.chest.clone();
        const toCas = pos.clone().sub(cameraPos);
        const dist = toCas.length();
        if (dist > maxDist || dist < 0.3) continue;

        const dir = toCas.clone().normalize();
        const dot = dir.dot(cameraDir);
        const minDot = dist < 1.5 ? 0.55 : 0.8;
        if (dot < minDot) continue;

        const score = dot * 2 - dist * 0.5;
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = {
            kind: 'casualty',
            casualty: cas,
            action: 'search_casualty',
            promptKey: 'E',
            promptAction: 'SEARCH CASUALTY',
            promptDetail: `+${cas.ammo} ${cas.weaponDef.name.toUpperCase()} AMMO`,
            weaponDef: cas.weaponDef,
            ammo: cas.ammo,
            position: pos,
            distance: dist,
          };
        }
      }
    }

    return bestCandidate;
  }

  /**
   * Execute loot interaction.
   */
  loot(
    cand: InteractCandidate,
    weapons: WeaponController,
    audio: Audio | null,
    events: EventBus,
    hud: Hud,
  ): boolean {
    if (cand.kind === 'drop' && cand.drop) {
      const drop = cand.drop;
      if (drop.pickedUp) return false;

      if (cand.action === 'pickup_weapon') {
        // Unlock and switch to weapon
        weapons.takeWeapon(drop.weaponDef.id, drop.ammo, cand.position);
        drop.pickedUp = true;
        this.consumeDrop(drop);
        audio?.play('pickup_weapon') || audio?.play('holster', { gain: 0.65 });
        hud.lootNotification(`ACQUIRED ${drop.weaponDef.name.toUpperCase()}`, `+${drop.ammo} AMMO`);
        events.emit({
          type: 'lootPickup',
          kind: 'weapon',
          weapon: drop.weaponDef.name,
          amount: drop.ammo,
          at: [drop.position.x, drop.position.y, drop.position.z],
        });
        return true;
      } else {
        // Loot ammo into reserve
        const res = weapons.addAmmo(drop.weaponDef.id, drop.ammo);
        if (res.full) {
          hud.banner('AMMO FULL', `${drop.weaponDef.name} reserves full`, 1.5);
          return false;
        }
        drop.pickedUp = true;
        this.consumeDrop(drop);
        audio?.play('pickup_ammo') || audio?.play('mag_in', { gain: 0.75 });
        weapons.playLoot(cand.position);
        hud.lootNotification(`+${res.added} ${drop.weaponDef.name.toUpperCase()} AMMO`);
        events.emit({
          type: 'lootPickup',
          kind: 'ammo',
          weapon: drop.weaponDef.name,
          amount: res.added,
          at: [drop.position.x, drop.position.y, drop.position.z],
        });
        return true;
      }
    } else if (cand.kind === 'casualty' && cand.casualty) {
      const cas = cand.casualty;
      if (cas.searched) return false;

      const res = weapons.addAmmo(cas.weaponDef.id, cas.ammo);
      if (res.full) {
        hud.banner('AMMO FULL', `${cas.weaponDef.name} reserves full`, 1.5);
        return false;
      }
      cas.searched = true;
      audio?.play('pickup_ammo') || audio?.play('mag_in', { gain: 0.75 });
      weapons.playLoot(cand.position);
      hud.lootNotification(`SCAVENGED +${res.added} ${cas.weaponDef.name.toUpperCase()} AMMO`);
      events.emit({
        type: 'lootPickup',
        kind: 'ammo',
        weapon: cas.weaponDef.name,
        amount: res.added,
        at: [cas.position.x, cas.position.y, cas.position.z],
      });
      return true;
    }

    return false;
  }

  private consumeDrop(drop: LootDrop): void {
    if (this.phys) {
      this.phys.removeProp(drop.obj);
    }
    drop.obj.removeFromParent();
    if (drop.marker) {
      drop.marker.removeFromParent();
    }
  }

  tick(dt: number, playerPos: THREE.Vector3): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      drop.life -= dt;

      // Update position from physics obj
      const p = drop.obj.getWorldPosition(new THREE.Vector3());
      drop.position.copy(p);

      // Subtle ground marker visibility and pulse near player
      if (drop.marker) {
        const d = p.distanceTo(playerPos);
        if (d < 12 && drop.life > 0 && !drop.pickedUp) {
          drop.marker.visible = true;
          drop.marker.position.set(p.x, Math.max(0.03, p.y - 0.05), p.z);
          const pulse = 0.5 + Math.sin(performance.now() * 0.005) * 0.35;
          (drop.marker.material as THREE.MeshBasicMaterial).opacity = pulse * Math.min(1, (12 - d) / 3);
        } else {
          drop.marker.visible = false;
        }
      }

      if (drop.life <= 0 || drop.pickedUp) {
        this.consumeDrop(drop);
        this.drops.splice(i, 1);
      }
    }

    // Clean up old casualties (past 45s)
    for (let i = this.casualties.length - 1; i >= 0; i--) {
      const c = this.casualties[i];
      if (c.searched || (c.enemy.dead && c.enemy.deadTime > 45)) {
        this.casualties.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const drop of this.drops) {
      this.consumeDrop(drop);
    }
    this.drops.length = 0;
    this.casualties.length = 0;
  }
}
