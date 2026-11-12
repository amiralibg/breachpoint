import { SIGNALHILL as P } from '../../world/maps/signalhill';
import type { MissionDef, MissionMode } from '../mission';

function hanaNear(m: MissionMode, r = 14): boolean {
  const h = m.friendly('Hana');
  return !!h && h.position.distanceTo(m.game.player.position) < r;
}

/** M5 Signal Hill: get the doctor into the fort, hold the relay while her model uploads, cover the gate, get out by sea. */
export const M5: MissionDef = {
  id: 'signalhill',
  index: 5,
  title: 'Signal Hill',
  subtitle: 'Fort Mardell & coast relay',
  clock: 'T−5 h · 04:40 · storm',
  map: 'signalhill',
  briefing: [
    'Fort Mardell is a nineteenth-century sea fort with a relay mast on its keep. From there Dr. Lisowska\'s model can go out citywide and to the coastguard. Aurel Dace and the last of his crew are inside.',
    'Cordon got to the hill first and are hunting them through the yard. The storm is the only cover there is: rain halves how far anyone hears, and nobody sees far between the lightning.',
    'MIRELA: Cliff stairs to the sally port is fast. The sea tunnel and the magazine stair is quiet. Round the hill to the broken wall is loud. Pick one. The boat waits at the jetty.',
  ],
  objectives: [
    'Get inside the walls with Dr. Lisowska',
    'Start the upload in the relay room and hold the keep',
    'Cover Dace at the main gate',
    'Get back down to the boat',
  ],
  loadout: ['m4', 'pistol', 'sniper'],
  groups: {
    patrol: {
      faction: 'cordon',
      units: [
        { at: [-10, 16.5, 10.5], leash: 6 }, { at: [16, 16.5, 10.5], leash: 6 }, { at: [-16, 12, -8], leash: 6 }, { at: [19, 12, -24], leash: 5 },
        { at: [22, 12, 1], leash: 4, role: 'flanker' }, { at: [-33, 12, 3], leash: 3 }, { at: [33, 16.5, -31], leash: 1, role: 'marksman' },
      ],
    },
    keep: { faction: 'cordon', units: [{ at: [-3, 12, -8], leash: 3 }, { at: [2, 16.5, -8], leash: 3, role: 'flanker' }] },
    east: { faction: 'cordon', units: [{ at: [34, 12, 3] }, { at: [36, 12, 6], role: 'rusher' }, { at: [38, 12, 1], role: 'flanker' }] },
    south: { faction: 'cordon', units: [{ at: [-20, 12, 16] }, { at: [-17, 12, 17], role: 'rusher' }, { at: [-23, 12, 15] }] },
    west: { faction: 'cordon', units: [{ at: [-34, 12, 3] }, { at: [-36, 12, 0], role: 'flanker' }, { at: [-37, 12, 5], heavy: true }] },
    gate: {
      faction: 'cordon',
      units: [
        { at: [-4, 12, -36] }, { at: [3, 12, -37], role: 'rusher' }, { at: [0, 12, -38] }, { at: [-8, 12, -34], role: 'flanker' },
        { at: [8, 12, -34] }, { at: [2, 12, -35], heavy: true },
      ],
    },
    chase: { faction: 'cordon', units: [{ at: [0, 12, -20] }, { at: [-6, 12, -22], role: 'rusher' }, { at: [6, 12, -22], role: 'flanker' }, { at: [33, 16.5, -31], leash: 1, role: 'marksman' }] },
  },
  stages: [
    {
      id: 'approach',
      tasks: [{ id: 'keep', text: 'Get to the keep with Dr. Lisowska', at: P.keepDoor, check: (m) => m.dist(P.keepDoor) < 5 && hanaNear(m) }],
      enter(m, restored) {
        m.escort('Hana', [1.2, 1.6, 34.5]).follow = true;
        m.spawn('patrol');
        m.spawn('keep');
        if (restored) return;
        m.say('Mirela', 'Cordon are already up there, patrolling in pairs. Dace is in the keep with what is left of his crew.');
        m.say('Hana', 'I can keep up. Just tell me when to get down.');
        m.say('Kestrel', 'Stay behind me and stay off the skyline.');
      },
    },
    {
      id: 'relay',
      tasks: [{ id: 'start', text: 'Start the upload at the relay desk, upstairs in the keep', at: P.console, interact: { label: 'Start upload', hold: 2 } }],
      enter(m, restored) {
        m.escort('Hana', [0, 12, 0]).follow = true;
        if (restored) return;
        m.say('Dace', 'So you are the sergeant. Aurel Dace. I ran that Wall for nineteen years. The desk is upstairs.');
      },
    },
    {
      id: 'upload',
      tasks: [{ id: 'hold', text: 'Hold the keep while the model uploads', at: P.relay, hold: { seconds: 130, label: 'Upload', radius: 13 } }],
      enter(m, restored) {
        m.escort('Hana', [-1, 16.5, -12]).follow = false;
        m.after(10, () => {
          m.spawn('east', { alert: true });
          m.say('Mirela', 'They know. First team is coming through the broken wall in the east.');
        });
        m.after(50, () => {
          m.spawn('south', { alert: true });
          m.say('Mirela', 'Sally port, south wall. Three more.');
        });
        m.after(88, () => {
          m.spawn('west', { alert: true });
          m.say('Mirela', 'Postern, west side. One of them is carrying a lot of armour.');
        });
        if (restored) return;
        m.say('Hana', 'It is going out. Coastguard band and the city mesh. Three minutes, if nothing jams it.');
      },
    },
    {
      id: 'gate',
      tasks: [{ id: 'cover', text: 'Cover Dace at the main gate from the north wall', at: P.overwatch, clear: 'gate' }],
      enter(m, restored) {
        m.escort('Hana', [-1, 16.5, -12]).follow = false;
        m.escort('Dace', P.dace).follow = false;
        m.spawn('gate', { alert: true });
        if (restored) return;
        m.say('Hana', 'The Trust is jamming the relay. Part of it got through. Not all.');
        m.say('Dace', 'Trucks at the main gate. I will hold it. Get on the wall above me, Sergeant, and take the long gun.');
      },
    },
    {
      id: 'extract',
      tasks: [{ id: 'boat', text: 'Get Dr. Lisowska down the cliff stairs to the boat', at: P.boat, check: (m) => m.dist(P.boat) < 5 && hanaNear(m, 12) }],
      enter(m, restored) {
        m.escort('Hana', [-1, 12, -2]).follow = true;
        m.fall('Dace', [33, 18, -31]);
        m.spawn('chase', { alert: true });
        if (restored) return;
        m.say('Mirela', 'Sniper on the north-east bastion. Dace is down. Dace is down.');
        m.say('Dace', 'Take it. The override key. Gates four to seven. Shut them and keep them shut until the water drops.');
        m.say('Kestrel', 'I have it. Doctor, we are leaving. Sally port, then the cliff stairs.');
      },
    },
    {
      id: 'away',
      tasks: [{ id: 'cast', text: 'Cast off', hold: { seconds: 5, label: 'Casting off' } }],
      enter(m, restored) {
        if (restored) return;
        m.say('Lantern', 'It won\'t work, Ilse. They own the frequencies. They own the gates.');
        m.say('Kestrel', 'They don\'t own the key.');
      },
    },
  ],
  debrief() {
    return [
      'Part of Dr. Lisowska\'s model reached the coastguard before the Trust jammed the relay. Part of it is enough to make someone come and look.',
      'Aurel Dace held the main gate of Fort Mardell until a Cordon sniper on the north-east bastion killed him. He put the Wall\'s manual override key in Kestrel\'s hand first.',
      'On the boat Lantern broke into Low Water\'s channel and, for the first time, used her first name.',
      'Two hours to the peak. Mirela turns the boat toward the Wall.',
    ];
  },
};
