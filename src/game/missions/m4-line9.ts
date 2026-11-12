import { LINE9 as P } from '../../world/maps/line9';
import type { MissionDef, MissionMode } from '../mission';

/** The doctor has to be with you: within a few metres when you get there. */
function withHana(m: MissionMode, at: [number, number, number], r: number): boolean {
  const h = m.friendly('Hana');
  return m.dist(at) < r && !!h && h.position.distanceTo(m.game.player.position) < 12;
}

/** M4 Line 9: find the "kidnapped" hydrologist under the city, then get her out past Cordon as the station floods. */
export const M4: MissionDef = {
  id: 'line9',
  index: 4,
  title: 'Line 9',
  subtitle: 'Ferrier Street interchange (closed)',
  clock: 'T−11 h · 22:50 · underground',
  map: 'line9',
  briefing: [
    'Ferrier Street interchange closed after the 2031 floods. The Trust says Low Water are holding its chief hydrologist, Dr. Hana Lisowska, in the drainage pump room three levels down.',
    'Kestrel goes in alone from the street hall with a weapon light. The battery emergency lamps still work in places. Nothing else does.',
    'LANTERN: Concourse, platform, then the service stairs down to the drainage gallery. Bring the doctor up the way you went in.',
  ],
  objectives: [
    'Reach the pump room on the drainage level',
    'Protect Dr. Lisowska',
    'Escort her west along the platform, through the derailed tram, to the vent shaft',
    'Climb the shaft to the street',
  ],
  loadout: ['m4', 'pistol'],
  groups: {
    sentries: {
      faction: 'lowwater',
      units: [{ at: [24, 12, 3], leash: 4 }, { at: [10, 6, 2.5], leash: 4 }, { at: [-14, 6, -2], leash: 5, role: 'flanker' }, { at: [6, 0, 0], leash: 3 }],
    },
    breach: { faction: 'cordon', units: [{ at: [14, 0, 0] }, { at: [10, 0, -1.2], role: 'rusher' }, { at: [6, 0, 1], role: 'flanker' }, { at: [2, 0, 0] }] },
    platform: {
      faction: 'cordon',
      units: [{ at: [30, 6, 1] }, { at: [22, 6, 2.5], role: 'flanker' }, { at: [3, 12, 5], role: 'marksman', leash: 2 }, { at: [6, 12, -5], leash: 3 }],
    },
    track: { faction: 'cordon', units: [{ at: [-4, 5, 7] }, { at: [2, 5, 7.5], role: 'flanker' }, { at: [8, 5, 6.5], role: 'rusher' }] },
    chase: { faction: 'cordon', units: [{ at: [-4, 6, 0] }, { at: [2, 6, 2], role: 'rusher' }, { at: [6, 6, -2], heavy: true }] },
  },
  stages: [
    {
      id: 'descend',
      tasks: [{ id: 'pump', text: 'Reach the pump room on the drainage level', at: P.pumpDoor, reach: 4 }],
      enter(m, restored) {
        m.spawn('sentries');
        if (restored) return;
        m.say('Lantern', 'You are in. Shutter is down behind you, so nobody follows you off the street.');
        m.say('Kestrel', 'Light is on. Going down.');
        m.after(30, () => m.say('Lantern', 'Low Water have sentries down there. Assume they shoot.'));
      },
    },
    {
      id: 'reveal',
      tasks: [{ id: 'listen', text: 'Hear the doctor out', at: P.pumpRoom, hold: { seconds: 34, label: 'Dr. Lisowska', radius: 12 } }],
      enter(m, restored) {
        m.escort('Hana', P.hana).follow = false;
        if (restored) return;
        m.say('Hana', 'Put that down, Sergeant. Nobody kidnapped me. I walked here, and I am running these pumps.');
        m.say('Hana', 'Managed Relief is the Trust\'s storm plan. At the peak it holds gates four to seven open, "to relieve structural load".');
        m.say('Hana', 'The surge goes into the Lower Wards basin. The financial district stays dry. The flood is declared a structural necessity.');
        m.say('Hana', 'That triggers the insurance and compulsory purchase. They are paid for the flood, then they buy what it drowned.');
        m.say('Kestrel', 'The Wall breaks if those gates stay shut. That is the model.');
        m.say('Hana', 'That is their model. I wrote the real one. The Wall holds at plus six point two.');
      },
    },
    {
      id: 'breach',
      tasks: [{ id: 'hold', text: 'Protect Dr. Lisowska', at: P.pumpRoom, clear: 'breach' }],
      enter(m, restored) {
        m.escort('Hana', P.hana).follow = false;
        m.spawn('breach', { alert: true });
        m.water(0, 5.7, 0.028);
        if (restored) return;
        m.say('Cordon', 'Cordon three-one, at the gallery. Recover the asset. Sanitise the site.');
        m.say('Kestrel', 'That is the shared channel. Those are their orders?');
        m.say('Hana', 'They have opened the sluice. The gallery will be under water in a few minutes.');
      },
    },
    {
      id: 'escort',
      tasks: [{ id: 'shaft', text: 'Escort the doctor west, through the tram, to the vent shaft', at: P.shaftBase, check: (m) => withHana(m, P.shaftBase, 5) }],
      enter(m, restored) {
        m.escort('Hana', [34, 0, 0]).follow = true;
        m.water(0, 5.7, 0.028);
        m.spawn('platform', { alert: true });
        m.after(20, () => m.spawn('track', { alert: true }));
        if (restored) return;
        m.say('Lantern', 'Kestrel, Cordon are there to help. Hand the doctor over at the street stairs.');
        m.say('Kestrel', 'They are blocking the street stairs. We are going west, to the vent shaft.');
        m.say('Hana', 'Stay off the track beds if you can. They flood first.');
      },
    },
    {
      id: 'climb',
      tasks: [{ id: 'street', text: 'Climb the vent shaft to the street', at: P.shaftTop, check: (m) => withHana(m, P.shaftTop, 4) }],
      enter(m, restored) {
        m.escort('Hana', [-38, 6, 0]).follow = true;
        m.water(0, 5.7, 0.028);
        m.spawn('chase', { alert: true });
        if (restored) return;
        m.say('Cordon', 'Asset is at the west shaft. All teams, the west shaft.');
      },
    },
    {
      id: 'surface',
      tasks: [{ id: 'rain', text: 'Catch your breath', hold: { seconds: 6, label: 'Street level' } }],
      enter(m, restored) {
        m.escort('Hana', [-34, 18, 1]).follow = true;
        if (restored) return;
        m.say('Lantern', 'Kestrel, step away from the doctor. That\'s an order.');
        m.say('Kestrel', 'Channel off.');
        m.say('Mirela', 'You\'re on our channel now, Sergeant. Bring her to Signal Hill and try not to get her shot.');
      },
    },
  ],
  debrief() {
    return [
      'Dr. Lisowska was never a hostage. She was running the station pumps with three Low Water engineers, and she had the real load model for the Wall.',
      'Managed Relief holds gates four to seven open at the surge peak. The Lower Wards flood, the financial district stays dry, and the Trust is paid for it. Cordon came down with orders to recover her and sanitise the site.',
      'At the top of the shaft Lantern ordered Kestrel to step away from the doctor. She switched his channel off.',
      'The old coastal relay at Signal Hill can broadcast the model citywide and to the coastguard. Aurel Dace is there.',
      'MIRELA: Boat leaves in ten minutes. Keep her head down.',
    ];
  },
};
