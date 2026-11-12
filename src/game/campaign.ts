import type { MissionDef } from './mission';
import { M1 } from './missions/m1-spillway';
import { M2 } from './missions/m2-saltmarket';
import { M3 } from './missions/m3-glasshouse';
import { M4 } from './missions/m4-line9';
import { M5 } from './missions/m5-signalhill';
import { M6 } from './missions/m6-wall';

/** Low Water, in order. */
export const CAMPAIGN: MissionDef[] = [M1, M2, M3, M4, M5, M6];
