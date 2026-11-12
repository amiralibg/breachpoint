import { SPILLWAY as P } from '../../world/maps/spillway';
import type { MissionDef } from '../mission';

/** M1 Spillway: retake Pump Station 3. Assault across three levels; the valve and the control room in either order. */
export const M1: MissionDef = {
  id: 'spillway',
  index: 1,
  title: 'Spillway',
  subtitle: 'Pump Station 3 · No. 2 dry dock',
  clock: 'T−36 h · 02:40 · heavy rain',
  map: 'spillway',
  briefing: [
    'Overnight a militia calling itself Low Water seized Pump Station 3, the largest of the stations that drain the Lower Wards. The storm surge peaks in thirty-six hours. Without the pumps the Wards go under before it arrives.',
    'SRU-4 goes in by boat to the west quay. Armed hostiles, possible sabotage, Trust engineers unaccounted for. There is a gantry crane over the dry dock: look up before you cross open ground.',
    'LANTERN: Three ways to the hall, Kestrel. Across the quay, under it through the dock culvert, or over it on the service bridge. Pick one and keep moving.',
  ],
  objectives: [
    'Cross the quay to the pump hall',
    'Open the main valve in the pump gallery, under the hall',
    'Retake the control room on the mezzanine',
  ],
  loadout: ['m4', 'pistol'],
  groups: {
    quay: {
      faction: 'lowwater',
      units: [
        { at: [-12, 7, 16], leash: 5 }, { at: [1, 7, 9], leash: 5 }, { at: [9, 7, 22], leash: 6, role: 'flanker' },
        { at: [16, 7, 4], leash: 4 }, { at: [24, 7, 10], leash: 5 },
        { at: P.cab, role: 'marksman', leash: 0, face: Math.PI * 0.75 },
      ],
    },
    dock: { faction: 'lowwater', units: [{ at: [-16, 0, -19], leash: 6 }, { at: [0, 0, -12], leash: 5, role: 'flanker' }] },
    hall: {
      faction: 'lowwater',
      units: [
        { at: [16, 7, -6], leash: 4 }, { at: [30, 7, -8], leash: 5 }, { at: [38, 7, -6], leash: 4, role: 'rusher' },
        { at: [24, 7, -22], leash: 5 }, { at: [33, 7, -22], leash: 4 },
      ],
    },
    gallery: { faction: 'lowwater', units: [{ at: [24, 0, -20], leash: 4 }, { at: [32, 0, -9], leash: 4 }, { at: [37, 0, -20], leash: 3 }] },
    control: {
      faction: 'lowwater',
      units: [
        { at: [30, 12, -24], leash: 3 }, { at: [35, 12, -22.5], leash: 2 }, { at: [42, 12, -24], leash: 3 },
        { at: [17, 12, -26.8], leash: 3, role: 'rifleman' },
      ],
    },
    counter: { faction: 'lowwater', units: [{ at: [40, 7, 22] }, { at: [36, 7, 26], role: 'flanker' }, { at: [44, 7, 16], role: 'rusher' }] },
  },
  stages: [
    {
      id: 'quay',
      tasks: [{ id: 'reach', text: 'Cross the quay to the pump hall', at: P.hallDoor, reach: 6 }],
      enter(m, restored) {
        m.spawn('quay');
        m.spawn('dock');
        if (restored) return;
        m.say('Lantern', 'Brann and Okoye are hit. The boat is pulling them out. Sniper in the crane cab.');
        m.say('Lantern', 'You are the only one inside the wire, Kestrel. I need that station. Keep going.');
        m.say('Kestrel', 'Copy. Moving on the hall.');
        m.after(26, () => m.say('Lantern', 'Dock stairs are on your left if the quay is too hot. The culvert comes up under the hall.'));
      },
    },
    {
      id: 'hall',
      tasks: [
        {
          id: 'valve', text: 'Open the main valve in the pump gallery', at: P.valve, interact: { label: 'Open main valve', hold: 2.2 },
          onDone(m) {
            m.game.audio?.machine();
            m.water(0, 2.3, 0.22);
            m.say('Lantern', 'Drainage is restoring. The dock is flooding out, so nothing follows you through the culvert now.');
            if (!m.wasSpawned('counter')) {
              m.spawn('counter', { alert: true });
              m.after(4, () => m.say('Lantern', 'More of them coming in off the south-east quay.'));
            }
          },
        },
        { id: 'control', text: 'Clear the control room on the mezzanine', at: [36, 12.6, -24], clear: 'control' },
      ],
      enter(m, restored) {
        m.spawn('hall');
        m.spawn('gallery');
        m.spawn('control');
        if (restored) return;
        m.say('Lantern', 'You are at the hall. Valve first or control room first, your call. The valve is seven metres down, in the gallery.');
        m.say('Kestrel', 'Pumps are running, Lantern. All three.');
        m.say('Lantern', 'Then they have rigged something. Get me that control room.');
      },
    },
    {
      id: 'lock',
      tasks: [{ id: 'console', text: 'Cut the override lock at the control desk', at: P.console, interact: { label: 'Cut override lock', hold: 2.5 } }],
      enter(m, restored) {
        const pell = m.escort('Pell', P.pell);
        pell.follow = false;
        if (restored) return;
        m.say('Pell', 'Don\'t. Rifle\'s down. I\'m an engineer, I\'m not going anywhere on this leg.');
        m.say('Pell', 'Nobody sabotaged anything. We locked the pumps on. Manual override, so they can\'t be shut down from outside.');
        m.say('Pell', 'Ask your people who keeps trying to switch them off.');
        m.say('Lantern', 'He is stalling. Cut the lock, Kestrel. The Trust needs remote control back before the surge.');
      },
    },
    {
      id: 'out',
      tasks: [{ id: 'wait', text: 'Hold the control room for the Trust contractors', hold: { seconds: 14, label: 'Cordon inbound' } }],
      enter(m, restored) {
        if (restored) return;
        m.say('Lantern', 'Good. Station is ours. Contractors are coming in on Trust contract to take the prisoner. Cordon Group.');
        m.say('Cordon', 'SRU, this is Cordon two-one. We have him from here. You can stand down.');
        m.say('Kestrel', 'His radio log keeps naming a courier in Saltmarket. Orders on paper.');
        m.say('Lantern', 'Paper means they don\'t trust their radios. Follow the paper, Kestrel.');
      },
    },
  ],
  debrief() {
    return [
      'Pump Station 3 is back under Trust control. The pumps were never sabotaged: Low Water had locked them running, and you cut the lock.',
      'Cordon Group took the engineer, Pell, away "on Trust contract". Nobody told you where.',
      'His radio log points to a courier in Saltmarket carrying Aurel Dace\'s orders by hand.',
      'LANTERN: Get some sleep on the boat. Saltmarket at dusk.',
    ];
  },
};
