import type * as THREE from 'three';
import type { QualityPreset } from '../core/settings';
import { buildMap, type WorldId, type WorldMap } from './map';
import { buildGlasshouse } from './maps/glasshouse';
import { buildLine9 } from './maps/line9';
import { buildSaltmarket } from './maps/saltmarket';
import { buildSignalHill } from './maps/signalhill';
import { buildSpillway } from './maps/spillway';
import { buildWall } from './maps/wall';

type Builder = (scene: THREE.Scene, q: QualityPreset, gl: THREE.WebGLRenderer) => Promise<WorldMap>;

/** Every map the game can load: the compound (waves, practice) and the six story maps. */
const BUILDERS: Record<WorldId, Builder> = {
  compound: buildMap,
  spillway: buildSpillway,
  saltmarket: buildSaltmarket,
  glasshouse: buildGlasshouse,
  line9: buildLine9,
  signalhill: buildSignalHill,
  wall: buildWall,
};

export function buildWorld(id: WorldId, scene: THREE.Scene, q: QualityPreset, gl: THREE.WebGLRenderer): Promise<WorldMap> {
  return BUILDERS[id](scene, q, gl);
}
