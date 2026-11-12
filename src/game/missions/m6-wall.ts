import { PIERS, WALL as P } from '../../world/maps/wall';
import type { GroupDef, MissionDef, MissionMode, Task } from '../mission';

const pier = (c: number): GroupDef => ({
  faction: 'cordon',
  units: [{ at: [c - 2, 14, -5], leash: 3 }, { at: [c + 2, 14, -7], leash: 2, role: 'flanker' }, { at: [c + 8, 8, 2], leash: 3 }],
});

function pierDone(m: MissionMode, n: number): void {
  m.game.audio?.machine();
  const done = [4, 5, 6].filter((k) => m.isDone(`pier${k}`)).length;
  if (done === 1) m.say('Mirela', `Pier ${n} is on manual hold. Two to go. The gallery under you is taking water, so do not plan on coming back that way.`);
  if (done === 2) {
    m.say('Mirela', `Pier ${n} holding. One more. They are sending a team out of the tower.`);
    if (!m.wasSpawned('reinforce')) m.spawn('reinforce', { alert: true });
  }
  if (done === 3) m.say('Mirela', 'All three piers are holding by hand. The tower can still override them. Go.');
  m.water(0, 6.5, 0.02);
}

/** M6 The Wall: stop gates 4 to 7 opening, take the control tower, lock them and hold through the surge peak. */
export const M6: MissionDef = {
  id: 'wall',
  index: 6,
  title: 'The Wall',
  subtitle: 'Veyle Storm Barrier, piers 4–6',
  clock: 'T−1.5 h · 08:10 · surge peak',
  map: 'wall',
  briefing: [
    'Cordon hold the Veyle Storm Barrier. On schedule, gates four to seven begin to lift. Each pier\'s machinery house drives the gates either side of it. The control tower on the east abutment can override all of them.',
    'Mirela lands Kestrel on the west abutment with Dace\'s override key. Set the three piers to manual hold, in any order, by the deck, the gate-frame catwalk or the gallery inside the sill. Then take the tower and lock the gates.',
    'MIRELA: Nine minutes before they are too far open to stop. After that it is the Lower Wards. Don\'t be slow.',
  ],
  objectives: [
    'Set the machinery at piers 4, 5 and 6 to manual hold',
    'Breach the control tower: deck door, catwalk door, or the gallery stair',
    'Lock the gates with Dace\'s key',
    'Hold the tower until the surge passes',
  ],
  loadout: ['m4', 'pistol', 'sniper'],
  groups: {
    p4: pier(PIERS[0]),
    p5: pier(PIERS[1]),
    p6: pier(PIERS[2]),
    deck: { faction: 'cordon', units: [{ at: [-34, 8, 1], leash: 4 }, { at: [-10, 8, 3], leash: 5, role: 'flanker' }, { at: [16, 8, 0], leash: 5 }, { at: [35, 14, -8.4], leash: 2, role: 'marksman' }] },
    gallery: { faction: 'cordon', units: [{ at: [-22, 0, 0], leash: 4 }, { at: [0, 0, 1], leash: 4 }, { at: [28, 0, -1], leash: 4, role: 'flanker' }] },
    reinforce: { faction: 'cordon', units: [{ at: [38, 8, 0] }, { at: [36, 8, 3], role: 'rusher' }, { at: [37, 8, -3], heavy: true }] },
    tower: {
      faction: 'cordon',
      units: [
        { at: [46, 8, -1], leash: 3 }, { at: [51, 8, 4], leash: 2, role: 'flanker' }, { at: [47, 14, 0], leash: 3 }, { at: [44, 14, -8], leash: 2 },
        { at: [46, 20, 2], leash: 2 }, { at: [50, 20, -1.5], leash: 2, heavy: true },
      ],
    },
    c1: { faction: 'cordon', units: [{ at: [44, 8, 0] }, { at: [42, 8, -2], role: 'rusher' }, { at: [43, 8, 3], role: 'flanker' }] },
    c2: { faction: 'cordon', units: [{ at: [36, 14, -8.4] }, { at: [33, 14, -8.4], heavy: true }, { at: [46, 8, 0], role: 'rusher' }] },
    c3: { faction: 'cordon', units: [{ at: [44, 8, 1], heavy: true }, { at: [42, 8, -1], heavy: true }, { at: [38, 14, -8.4], role: 'flanker' }, { at: [50, 8, 2], role: 'rusher' }] },
  },
  stages: [
    {
      id: 'piers',
      tasks: [4, 5, 6].map((n, i): Task => ({
        id: `pier${n}`, text: `Set pier ${n} to manual hold`, at: P.consoles[i], interact: { label: `Pier ${n}: manual hold`, hold: 2.5 },
        onDone: (m) => pierDone(m, n),
      })),
      enter(m, restored) {
        m.spawn('p4');
        m.spawn('p5');
        m.spawn('p6');
        m.spawn('deck');
        m.spawn('gallery');
        if (restored) return;
        m.startClock(9 * 60, 'GATES OPEN IN', () => m.fail('Gates four to seven opened. The surge went into the Lower Wards.'));
        m.say('Mirela', 'You are on the west abutment. Piers four, five, six, left to right. The houses are up on the sea side.');
        m.say('Kestrel', 'I can feel it humming through the deck.');
        m.say('Mirela', 'That is the gates lifting. Move.');
      },
    },
    {
      id: 'tower',
      tasks: [{ id: 'control', text: 'Reach the control room at the top of the tower', at: P.control, reach: 6 }],
      enter(m, restored) {
        m.spawn('tower');
        m.water(0, 6.5, 0.02);
        if (restored) return;
        m.say('Mirela', 'Deck door at the bottom, the catwalk door half way up, or the gallery stair if it is not under water yet.');
      },
    },
    {
      id: 'lock',
      tasks: [{ id: 'key', text: 'Lock gates 4–7 at the console with Dace\'s key', at: P.lock, interact: { label: 'Lock the gates', hold: 3 } }],
      enter(m, restored) {
        m.stopClock();
        m.escort('Lantern', P.lantern).follow = false;
        if (restored) return;
        m.say('Lantern', 'Ilse. I have the Trust\'s model in front of me. Unless four to seven open, the Wall goes.');
        m.say('Kestrel', 'I have the woman who wrote the real one. Plus six point two. It holds.');
        m.say('Lantern', 'If her numbers are wrong, the Wall goes and it\'s all of us.');
        m.say('Kestrel', 'Then you\'ll be right. Step back from the console.');
        m.say('Lantern', '...It\'s yours.');
      },
    },
    {
      id: 'hold',
      tasks: [{ id: 'surge', text: 'Hold the control room until the surge passes', at: P.control, hold: { seconds: 120, label: 'Surge peak', radius: 14 } }],
      enter(m, restored) {
        m.escort('Lantern', P.lantern).follow = false;
        m.after(8, () => {
          m.spawn('c1', { alert: true });
          m.say('Vahl', 'Major Reyhan, remove her from that room. Cordon, you have your orders.');
        });
        m.after(48, () => {
          m.spawn('c2', { alert: true });
          m.say('Mirela', 'Water at the Wall is plus five point six and climbing. More of them on the catwalk.');
        });
        m.after(88, () => {
          m.spawn('c3', { alert: true });
          m.say('Mirela', 'Plus five point eight. That is the peak. Shields coming up the stairs. Hold on.');
        });
        if (restored) return;
        m.game.audio?.machine();
        m.say('Kestrel', 'Gates are locked. Key is out.');
      },
    },
    {
      id: 'after',
      any: true,
      tasks: [
        { id: 'arrest', text: 'Arrest Lantern, so he can testify', at: P.arrest, interact: { label: 'Arrest Major Reyhan', hold: 1.5 }, onDone: (m) => { m.flags.ending = 'arrest'; } },
        { id: 'leave', text: 'Or walk away and leave him to Cordon', at: P.leave, interact: { label: 'Walk away', hold: 1.5 }, onDone: (m) => { m.flags.ending = 'leave'; } },
      ],
      enter(m, restored) {
        m.escort('Lantern', P.lantern).follow = false;
        if (restored) return;
        m.say('Mirela', 'Plus five point eight and falling. It held. Ilse, it held.');
        m.say('Lantern', 'I sent you to every one of those places believing I was saving the city.');
        m.say('Lantern', 'Cordon will be up here for me in a minute. What happens now is yours to decide.');
      },
    },
  ],
  debrief(m) {
    const arrest = m.flags.ending === 'arrest';
    return [
      'Grey morning. The water drops. The Lower Wards are wet but standing, and the Wall held at plus five point eight, as Hana Lisowska\'s numbers said it would.',
      'The coastguard arrived because part of the upload from Signal Hill got through.',
      'MIRELA: Forty thousand people got on those buses. Dace would have complained about the timetable.',
      'OKOYE: They told me in the hospital it was you on the Wall. Of course it was.',
      arrest
        ? 'LANTERN: My name is Tomas Reyhan. I gave the orders. I will tell you who gave them to me, and what the model said, and who drew it.'
        : 'Cordon took Major Reyhan off the Wall before the coastguard landed. Nobody has seen him since. The Trust says he acted alone.',
      'Low Water. End.',
    ];
  },
};
