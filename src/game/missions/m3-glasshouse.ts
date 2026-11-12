import { GLASSHOUSE as P } from '../../world/maps/glasshouse';
import type { GroupDef, MissionDef, MissionMode, SpawnDef } from '../mission';

type Entry = 'cafe' | 'staff' | 'dock';
const ENTRY_NAME: Record<Entry, string> = { cafe: 'café door', staff: 'staff door', dock: 'dock stairs' };

const squad = (at: readonly (readonly number[])[], roles: (SpawnDef['role'])[] = []): GroupDef => ({
  faction: 'lowwater',
  units: at.map((p, i) => ({ at: [p[0], p[1], p[2]], role: roles[i] })),
});

/** Close two of the three shutters; the raid uses the one left open. */
function lockdown(m: MissionMode, open: Entry): void {
  m.flags.open = open;
  for (const e of ['cafe', 'staff', 'dock'] as Entry[]) m.door(e, e === open);
  m.game.audio?.machine();
}

/** M3 Glasshouse: hold the Trust tower's data vault against a Low Water raid. */
export const M3: MissionDef = {
  id: 'glasshouse',
  index: 3,
  title: 'Glasshouse',
  subtitle: 'Aldane Trust tower, lower floors',
  clock: 'T−20 h · 11:30 · overcast',
  map: 'glasshouse',
  briefing: [
    'Low Water are coming for the Archive, the Trust\'s engineering record for the Wall. Kestrel is attached to Trust security for the morning. While the Archive copies itself to an off-site server, the vault has to hold.',
    'Besides the lobby front there are three ways in: the café door, the staff door and the dock stairs down to the parking. The security office can close two of them. The one you leave open is where they will come.',
    'LANTERN: Choose your door, then get down to the vault. Whatever they want in there, it stays in there.',
  ],
  objectives: [
    'Lock down the building from the security office: choose which entry stays open',
    'Hold the data vault in the parking level during the transfer',
    'Clear the boardroom on the office floor',
    'Hold the lobby while the staff evacuate',
  ],
  loadout: ['m4', 'pistol'],
  groups: {
    van: squad(P.entries.lobby, [undefined, 'rusher', undefined, 'flanker']),
    lobby2: squad(P.entries.lobby, ['rusher', undefined, 'flanker', undefined, 'marksman']),
    cafe: squad(P.entries.cafe, [undefined, 'flanker']),
    staff: squad(P.entries.staff, [undefined, 'flanker']),
    dock: squad(P.entries.dock, [undefined, 'rusher']),
    rope: { faction: 'lowwater', units: [{ at: [-6, 15, -19], leash: 3 }, { at: [6, 15, -19], leash: 3 }, { at: [0, 15, -12.5], leash: 2 }, { at: [8, 15, -13], leash: 3, role: 'flanker' }] },
    gallery: { faction: 'lowwater', units: [{ at: [-14, 10, 12], role: 'marksman', leash: 3 }, { at: [14, 10, 12], leash: 3 }] },
  },
  stages: [
    {
      id: 'lockdown',
      any: true,
      tasks: (['dock', 'staff', 'cafe'] as Entry[]).map((open) => ({
        id: `open-${open}`,
        text: `Security office: seal the building, leave the ${ENTRY_NAME[open]} open`,
        at: P.panel[open],
        interact: { label: `Leave ${ENTRY_NAME[open]} open` },
        onDone: (m: MissionMode) => lockdown(m, open),
      })),
      enter(m, restored) {
        if (restored) return;
        m.say('Lantern', 'Security office is in the east wing, past the planters. Three panels, one for each door you can leave open.');
        m.say('Lantern', 'You have a couple of minutes before they are on the plaza.');
      },
    },
    {
      id: 'vault',
      tasks: [{ id: 'hold', text: 'Hold the data vault during the transfer', at: P.vaultHold, hold: { seconds: 140, label: 'Archive transfer', radius: 16 } }],
      enter(m, restored) {
        const open = m.flags.open as Entry;
        m.after(8, () => {
          m.spawn('van', { alert: true });
          m.say('Lantern', 'Van through the lobby glass. First wave is inside. Vault is on the parking level, north-west corner.');
        });
        m.after(45, () => {
          m.spawn(open, { alert: true });
          m.say('Lantern', `More of them at the ${ENTRY_NAME[open]}. They are trying the shutters as well, which buys you time.`);
        });
        m.after(85, () => {
          m.spawn('lobby2', { alert: true });
          m.say('Lantern', 'Second team through the front. Transfer is past halfway.');
        });
        m.after(112, () => m.spawn(open, { alert: true }));
        if (restored) return;
        m.say('Lantern', `Shutters are down. The ${ENTRY_NAME[open]} is your open flank. The transfer only runs while you are at the vault.`);
      },
    },
    {
      id: 'boardroom',
      tasks: [{ id: 'rope', text: 'Clear the boardroom on the office floor', at: P.boardroom, clear: 'rope' }],
      enter(m, restored) {
        m.spawn('rope');
        m.spawn('gallery');
        if (restored) return;
        m.say('Lantern', 'Archive is off site. Good. Now the bad news: a rope team came in through the boardroom windows while you were downstairs.');
        m.say('Lantern', 'Office floor, north side. The stair cores are at the east and west ends, and watch the gallery over the lobby.');
      },
    },
    {
      id: 'lobby',
      tasks: [{ id: 'evac', text: 'Hold the lobby while the staff evacuate', at: P.lobby, hold: { seconds: 60, label: 'Evacuation', radius: 18 } }],
      enter(m, restored) {
        m.after(6, () => m.spawn('van', { alert: true }));
        m.after(32, () => m.spawn((m.flags.open as Entry) ?? 'cafe', { alert: true }));
        if (restored) return;
        m.say('Mirela', 'Read it before you shoot me. It is on the wall behind you.');
        m.say('Kestrel', 'Sund. Managed Relief. Sector four to seven pre-opening. Lower Wards.');
        m.say('Lantern', 'That is not your clearance, Kestrel. Kill the screen.');
        m.say('Kestrel', 'She has gone out of the window on her rope.');
        m.say('Lantern', 'Then let her go. Staff are coming down the cores. Hold the lobby until they are out.');
      },
    },
  ],
  debrief() {
    return [
      'The Archive reached the off-site server and the vault held. In the boardroom a Low Water medic, Mirela Sand, was copying one file and did not shoot. Then she left through the window.',
      'The wall screen read: SUND / MANAGED RELIEF / SECTOR 4–7 PRE-OPENING / LOWER WARDS. Lantern ordered it switched off.',
      'On the lobby screens, the Trust\'s chief executive Corinne Vahl thanked the city\'s brave responders.',
      'The Trust reports that Low Water have kidnapped its chief hydrologist, Dr. Hana Lisowska, and are holding her in the closed Line 9 interchange.',
      'LANTERN: Whatever that was, it isn\'t ours to read. Get the doctor back.',
    ];
  },
};
