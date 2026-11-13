#!/usr/bin/env python3
"""
Voice lines for enemy callouts, rendered with the macOS speech synthesizer and processed so they
sit in the world: public/assets/audio/voice/<faction>_<speaker>_<kind>_<n>.wav plus manifest.json.

These are stand-ins. Any file can be replaced by a real recording with the same name (the game only
reads the manifest and the files), and the script itself prefers the downloadable Enhanced/Premium
system voices when they are installed (System Settings > Accessibility > Spoken Content > System
voice > Manage Voices), which sound far more human than the built-in compact ones.

Processing per faction:
  - Low Water (a militia of dock workers): shouted. Tight, driven, a bit of grit, mid presence.
  - Cordon (Trust private security): clipped radio procedure. Band-limited, saturated, a squelch
    click in front and a short noise tail after, like a handset keyed and released.

Run: npm run voices   (needs macOS `say`; numpy + scipy like make_sounds.py)
"""
import json
import os
import subprocess
import tempfile
import wave

import numpy as np
from scipy.signal import butter, resample_poly, sosfilt

SR = 22050
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "assets", "audio", "voice")
rng = np.random.default_rng(11)

LINES = {
    "lowwater": {
        "contact": ["There! He's there!", "Contact! Contact!", "I see him!", "Got him, over there!"],
        "reloading": ["Reloading!", "I'm out, cover me!", "Changing mag!"],
        "grenade": ["Frag out!", "Grenade!", "Get down, frag out!"],
        "flanking": ["Going round the side!", "I'll cut him off!", "Flanking, keep him busy!"],
        "lostHim": ["Where'd he go?", "Lost him!", "He's gone quiet. Keep looking."],
        "manDown": ["Man down!", "We lost one!", "They got him!"],
        "suppressing": ["Keep his head down!", "Pin him!"],
    },
    "cordon": {
        "contact": ["Contact front.", "Hostile sighted.", "Eyes on target."],
        "reloading": ["Reloading.", "Mag change, cover."],
        "grenade": ["Frag out.", "Fragging the position."],
        "flanking": ["Moving to flank.", "Pushing the side, cover me."],
        "lostHim": ["Lost visual.", "Target's gone dark. Sweep it."],
        "manDown": ["Man down.", "Operator down."],
        "suppressing": ["Suppressing.", "Covering fire."],
    },
}

# Speakers per faction, best first. The first installed voice of each entry is used.
SPEAKERS = {
    "lowwater": [
        ["Daniel (Enhanced)", "Arthur (Enhanced)", "Daniel"],
        ["Moira (Enhanced)", "Moira"],
        ["Aman (Enhanced)", "Rishi (Enhanced)", "Aman"],
    ],
    "cordon": [
        ["Evan (Enhanced)", "Nathan (Enhanced)", "Tom (Enhanced)", "Karen"],
        ["Zoe (Premium)", "Samantha (Enhanced)", "Rishi"],
    ],
}
# Words per minute: shouting is fast, radio procedure brisk
RATE = {"lowwater": 215, "cordon": 200}


def installed_voices():
    out = subprocess.run(["say", "-v", "?"], capture_output=True, text=True).stdout
    names = set()
    for line in out.splitlines():
        # "Name (Lang)    en_US    # sample" -> name is everything before the locale column
        parts = line.split("#")[0].rsplit(None, 1)
        if parts:
            names.add(parts[0].strip())
    return names


def render(voice, text, rate):
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "v.wav")
        subprocess.run(["say", "-v", voice, "-r", str(rate), "--file-format=WAVE", f"--data-format=LEI16@{SR}", "-o", path, text], check=True)
        with wave.open(path) as w:
            x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    return x


def trim(x, thresh=0.01):
    idx = np.nonzero(np.abs(x) > thresh)[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] - int(0.01 * SR))
    b = min(len(x), idx[-1] + int(0.06 * SR))
    return x[a:b]


def band(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)


def hp(x, f):
    return sosfilt(butter(2, f, btype="high", fs=SR, output="sos"), x)


def peak(x, f, gain_db, q=1.2):
    # Presence bump: add a band-passed copy
    bw = f / q
    return x + (10 ** (gain_db / 20) - 1) * band(x, max(40, f - bw / 2), min(SR / 2 - 200, f + bw / 2))


def compress(x, amount):
    # Fast envelope follower squashing the dynamics (shouted speech is loud all the way through)
    env = np.abs(x)
    a = np.exp(-1 / (0.005 * SR))
    r = np.exp(-1 / (0.06 * SR))
    e = 0.0
    out = np.empty_like(env)
    for i, v in enumerate(env):
        e = a * e + (1 - a) * v if v > e else r * e + (1 - r) * v
        out[i] = e
    g = 1 / (1 + amount * out / (np.max(out) + 1e-9))
    return x * g


def shout(x):
    x = hp(x, 140)
    x = peak(x, 2600, 6)
    x = compress(x, 5)
    x = np.tanh(x / (np.max(np.abs(x)) + 1e-9) * 2.2)
    # Slight rasp: a little noise riding the envelope
    env = np.abs(band(x, 200, 3000))
    x = x + 0.04 * rng.standard_normal(len(x)) * env
    return x


def radio(x):
    x = band(x, 320, 3200, order=3)
    x = compress(x, 6)
    x = np.tanh(x / (np.max(np.abs(x)) + 1e-9) * 3.0)
    x = band(x, 300, 3400, order=2)
    x = x + 0.012 * band(rng.standard_normal(len(x)), 500, 5000)
    click = np.zeros(int(0.03 * SR))
    click[:40] = rng.standard_normal(40) * np.linspace(0.7, 0, 40)
    pre = np.concatenate([click, 0.03 * band(rng.standard_normal(int(0.05 * SR)), 800, 4000)])
    tail_n = int(0.16 * SR)
    tail = 0.22 * band(rng.standard_normal(tail_n), 600, 5000) * np.linspace(1, 0, tail_n) ** 2
    return np.concatenate([pre, x, tail])


def write(path, x):
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.9
    fade = int(0.008 * SR)
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade:] *= np.linspace(1, 0, fade)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def main():
    os.makedirs(OUT, exist_ok=True)
    have = installed_voices()
    manifest = {}
    for faction, kinds in LINES.items():
        speakers = []
        for options in SPEAKERS[faction]:
            v = next((h for o in options for h in sorted(have) if h == o or h.split(" (")[0] == o and "(" not in o), None)
            if v:
                speakers.append(v)
        manifest[faction] = []
        for si, voice in enumerate(speakers):
            bank = {}
            for kind, lines in kinds.items():
                files = []
                for li, text in enumerate(lines):
                    x = trim(render(voice, text, RATE[faction]))
                    x = shout(x) if faction == "lowwater" else radio(x)
                    name = f"{faction}_{si}_{kind}_{li}"
                    write(os.path.join(OUT, name + ".wav"), x)
                    files.append(name)
                bank[kind] = files
            manifest[faction].append(bank)
            print(f"{faction} speaker {si}: {voice}")
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)


if __name__ == "__main__":
    main()
