import { SALTMARKET as P } from '../../world/maps/saltmarket';
import type { MissionDef } from '../mission';

/** M2 Saltmarket: follow the courier's trail across the canal, breach the safehouse, take the papers. */
export const M2: MissionDef = {
  id: 'saltmarket',
  index: 2,
  title: 'Saltmarket',
  subtitle: 'Lower Wards market district',
  clock: 'T−28 h · 18:10 · dusk',
  map: 'saltmarket',
  briefing: [
    'Kestrel grew up in Saltmarket and left at eighteen. She goes back in plain clothes over armour, with a pistol and nothing longer.',
    'The courier is Teo Marr, seventeen, carrying Aurel Dace\'s orders on paper through the evening market. Lantern wants Dace\'s location, not a dead kid.',
    'LANTERN: Pick him up at the market hall and let him walk you to his drop. Low Water have lookouts on the roofs. If they make you, it gets loud.',
  ],
  objectives: [
    'Pick up the courier\'s trail at the market hall',
    'Follow it across the canal to the safehouse',
    'Breach the top floor: street door, the plank from the roof opposite, or the fire escape',
    'Secure the documents',
  ],
  loadout: ['pistol'],
  groups: {
    west: {
      faction: 'lowwater',
      units: [
        { at: [-27, 2.5, -1], leash: 5 }, { at: [-17, 2.5, 4], leash: 4, role: 'flanker' }, { at: [-8, 2.5, -15], leash: 5 },
        { at: [-14, 11.5, -8], leash: 2, role: 'marksman' },
      ],
    },
    bridges: {
      faction: 'lowwater',
      units: [{ at: [8, 2.5, -20] }, { at: [8, 2.5, 1], role: 'flanker' }, { at: [10, 2.5, 20] }, { at: [14, 2.5, -10], role: 'rusher' }],
    },
    east: {
      faction: 'lowwater',
      units: [
        { at: [36, 2.5, -1], leash: 4 }, { at: [26, 2.5, -2.5], leash: 4 }, { at: [16, 2.5, -25], leash: 3, role: 'flanker' },
        { at: [26, 11.5, 10], leash: 3 }, { at: [15, 11.5, 6], leash: 1 },
      ],
    },
    safehouse: {
      faction: 'lowwater',
      units: [
        { at: [27, 2.5, -15], leash: 3 }, { at: [28, 7, -13], leash: 3, role: 'flanker' },
        { at: [27, 11.5, -10], leash: 3 }, { at: [30, 11.5, -18], leash: 2 }, { at: [19.5, 11.5, -15], leash: 2 },
      ],
    },
    exfil: { faction: 'lowwater', units: [{ at: [10, 2.5, 12] }, { at: [12, 2.5, -8], role: 'flanker' }, { at: [36, 2.5, -4], role: 'rusher' }] },
  },
  stages: [
    {
      id: 'market',
      tasks: [{ id: 'trail', text: 'Pick up the courier\'s trail at the market hall', at: P.market, reach: 7 }],
      enter(m, restored) {
        m.spawn('west');
        if (restored) return;
        m.say('Lantern', 'Teo Marr. Grey jacket, satchel. He works the stalls every evening, then walks.');
        m.say('Kestrel', 'I know the hall. I used to steal oranges from it.');
        m.say('Lantern', 'Then don\'t get caught this time.');
      },
    },
    {
      id: 'cross',
      tasks: [{ id: 'canal', text: 'Follow the courier across the canal', at: P.canalSide, reach: 9 }],
      enter(m, restored) {
        m.setPower(false);
        m.daylight(0.42);
        m.spawn('bridges', { alert: true });
        m.spawn('east');
        if (restored) return;
        m.say('Lantern', 'He has made you. He is running east, over the canal.');
        m.say('Lantern', 'And there goes the power. They have cut the whole district.');
        m.say('Kestrel', 'Three footbridges, no cover on any of them. Or the roof bridge off the market.');
      },
    },
    {
      id: 'breach',
      tasks: [{ id: 'clear', text: 'Breach the safehouse and clear the top floor', at: P.safehouse, clear: 'safehouse' }],
      enter(m, restored) {
        m.setPower(false);
        m.daylight(0.42);
        m.spawn('safehouse');
        if (restored) return;
        m.say('Lantern', 'His radio went quiet in the tenement ahead of you. Top floor.');
        m.say('Lantern', 'Street door and the stairs. A plank into the south window from the roof opposite. Or the fire escape to the roof hatch.');
      },
    },
    {
      id: 'papers',
      tasks: [{ id: 'docs', text: 'Secure the documents on the desk', at: P.documents, interact: { label: 'Take documents', hold: 2 } }],
      enter(m, restored) {
        m.setPower(false);
        m.daylight(0.42);
        if (restored) return;
        m.say('Kestrel', 'No explosives. No weapons store. It is an office.');
      },
    },
    {
      id: 'exfil',
      tasks: [{ id: 'out', text: 'Get back to the south footbridge', at: P.exfil, reach: 5 }],
      enter(m, restored) {
        m.setPower(false);
        m.daylight(0.42);
        m.spawn('exfil', { alert: true });
        if (restored) return;
        m.say('Kestrel', 'Evacuation lists. Forty thousand names, by street. Bus rotas. A tide table with one hour circled.');
        m.say('Kestrel', 'There is a note in the margin. "Four to seven. They will open these."');
        m.say('Lantern', 'Staging for human shields. Bag it all and get out.');
        m.say('Kestrel', 'These are bus timetables, Lantern.');
        m.say('Lantern', 'Then they\'re well organised. Bag it.');
      },
    },
  ],
  debrief() {
    return [
      'The safehouse was a relief office: evacuation lists for forty thousand Lower Wards residents, bus rotas, and a tide table with the surge peak circled. In the margin someone had written "4–7. They will open these."',
      'Cordon picked up the courier, Teo Marr, on the street outside. Lantern filed the lists as staging for human shields.',
      'A Low Water radio intercept mentions "the Archive" at the Aldane Trust tower, and a raid tomorrow.',
      'LANTERN: You are attached to Trust security in the morning. Wear something clean.',
    ];
  },
};
