#!/usr/bin/env python3
"""
Synthesize Breachpoint's sound effects into public/assets/audio (numpy + scipy, no downloads).

Everything is built from physical pieces instead of beeps:
  - gunshots: three files per weapon. `<gun>_shot_<i>` is the close, dry report (crack, muzzle
    blast, low punch, the action cycling) and is short on purpose so automatic fire stays
    articulate. `<gun>_tail_<i>` is the stereo slap-back off the compound walls, layered under the
    player's own shots. `<gun>_far_<i>` is what the same shot sounds like from across the map: a
    dull boom and its echoes, crossfaded in by distance in src/core/audio.ts.
  - impacts: a broadband contact transient that excites a bank of decaying modes (modal synthesis).
    Steel, aluminium, polymer, brass and the rifle body each have their own inharmonic modes, so a
    bolt slamming home rings like steel and a magazine seats with a dull aluminium/polymer clack.
  - scrapes: band-passed noise with a gritty, randomly modulated envelope (parts sliding in rails).
  - rattles: clusters of tiny impacts (rounds in a magazine, springs, loose sling hardware).
  - footsteps: heel strike + toe roll, with a granular gravel crunch on dirt or a hard scuff on
    asphalt; several variants per surface so steps never repeat.
Reload foley is one file per motion (release click, magazine out, pouch, insert, seat...); the
weapon timelines in src/weapons/weapons.ts fire them at the moment the hands do it.
Relative levels live in the MIX table in src/core/audio.ts, not here: files are written near full
scale. Run: npm run sounds
"""
import os
import wave

import numpy as np
from scipy.interpolate import CubicSpline
from scipy.signal import butter, resample_poly, sosfilt

SR = 44100
LOW_SR = 22050  # tails and distant layers have nothing above a few kHz
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "assets", "audio")
rng = np.random.default_rng(7)
written = set()


# ---------------------------------------------------------------------------------------------
# DSP helpers

def n_(d):
    return max(1, int(d * SR))


def time(d):
    return np.arange(n_(d)) / SR


def noise(d):
    return rng.standard_normal(n_(d))


def filt(x, kind, f, order=2):
    if kind == "band":
        lo, hi = f
        sos = butter(order, [max(20, lo), min(SR / 2 - 100, hi)], btype="band", fs=SR, output="sos")
    else:
        sos = butter(order, min(SR / 2 - 100, f), btype=kind, fs=SR, output="sos")
    return sosfilt(sos, x)


def nband(d, lo, hi, order=2):
    """Band noise at unit RMS, so layer gains mean the same thing whatever the bandwidth."""
    x = filt(noise(d), "band", (lo, hi), order)
    return x / (np.sqrt(np.mean(x ** 2)) or 1)


def env(d, attack=0.0005, tau=0.05):
    t = time(d)
    a = np.clip(t / max(attack, 1e-5), 0, 1)
    return a * np.exp(-t / tau)


def jit(a, s=0.08):
    return a * (1 + rng.uniform(-s, s))


def place(buf, x, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf):
        return
    m = min(len(x), len(buf) - i)
    seg = x[:m] * gain
    # Fade every segment's tail so truncated layers never click
    k = min(m, n_(0.003))
    seg[m - k:] *= np.linspace(1, 0, k)
    buf[i:i + m] += seg


def silence(d):
    return np.zeros(n_(d))


def write(name, x, peak=0.9, drive=1.1, sr=SR, loop=False, norm=True):
    """Write a mono (n,) or stereo (n, 2) buffer. `drive` is how hard it leans into the soft clip."""
    os.makedirs(OUT, exist_ok=True)
    x = np.array(x, dtype=np.float64)
    if x.ndim == 1:
        x = x[:, None]
    if not loop:
        # Gentle fade-out so nothing clicks at the end
        fade = min(len(x), n_(0.01))
        x[-fade:] *= np.linspace(1, 0, fade)[:, None]
    if norm:
        m = np.max(np.abs(x)) or 1
        x = np.tanh(x / m * drive) / np.tanh(drive) * peak
    if sr != SR:
        if loop:
            # Resample three laps and keep the middle one, so the filter never sees the seam
            k = len(x) * sr // SR
            x = resample_poly(np.tile(x, (3, 1)), sr, SR, axis=0)[k:2 * k]
        else:
            x = resample_poly(x, sr, SR, axis=0)
        # The resampler's ringing can overshoot the peak
        x *= min(1.0, peak / (np.max(np.abs(x)) or 1))
    data = (x * 32767).astype("<i2").tobytes()
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(x.shape[1])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(data)
    written.add(name)


# ---------------------------------------------------------------------------------------------
# Materials: (mode frequencies Hz, decay times s, relative amplitudes)

MATERIALS = {
    "steel": ([2870, 4180, 5960, 7730, 9910, 12100], [0.06, 0.045, 0.03, 0.022, 0.016, 0.012], [1, 0.8, 0.65, 0.5, 0.35, 0.25]),
    "steel_heavy": ([980, 1730, 2650, 3790, 5120, 6890], [0.09, 0.07, 0.05, 0.035, 0.025, 0.018], [1, 0.85, 0.7, 0.5, 0.35, 0.25]),
    "aluminium": ([1380, 2290, 3540, 5010, 6800], [0.035, 0.026, 0.02, 0.014, 0.01], [1, 0.8, 0.6, 0.4, 0.25]),
    "polymer": ([540, 1020, 1710, 2570, 3600], [0.014, 0.011, 0.008, 0.006, 0.005], [1, 0.8, 0.55, 0.35, 0.2]),
    "brass": ([3980, 5870, 8150, 10400], [0.03, 0.022, 0.015, 0.01], [1, 0.7, 0.5, 0.3]),
    "body": ([190, 330, 560, 820, 1180], [0.04, 0.032, 0.025, 0.018, 0.012], [1, 0.8, 0.6, 0.4, 0.3]),
    "wood": ([260, 510, 880, 1400], [0.025, 0.018, 0.012, 0.008], [1, 0.6, 0.4, 0.25]),
}


def modal(material, d=0.25, detune=0.03, damp=1.0):
    freqs, taus, amps = MATERIALS[material]
    t = time(d)
    out = np.zeros_like(t)
    for f, tau, a in zip(freqs, taus, amps):
        f = f * (1 + rng.uniform(-detune, detune))
        out += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / (tau * damp))
    return out


def impact(material, gain=1.0, bright=1.0, d=0.25, damp=1.0, body=0.0):
    """Contact transient + ringing modes (+ optional rifle-body resonance)."""
    tr = filt(noise(0.006), "high", 1800 * bright) * env(0.006, 0.0002, 0.0012 * bright)
    ring = modal(material, d, damp=damp)
    x = silence(d)
    place(x, tr, 0, 0.9)
    place(x, ring * env(d, 0.0003, 1.0), 0.0004, 0.5)
    if body:
        place(x, modal("body", d) * env(d, 0.001, 1.0), 0.0006, body)
    return x * gain


def scrape(d, lo, hi, gain=1.0, grit=220, attack=0.01):
    """Sliding contact: band noise with a rough random envelope."""
    x = filt(noise(d), "band", (lo, hi), 2)
    rough = np.abs(filt(noise(d), "low", grit, 1))
    rough /= rough.max() or 1
    shape = np.clip(time(d) / attack, 0, 1) * np.clip((d - time(d)) / (d * 0.3), 0, 1)
    return x * (0.35 + 0.65 * rough) * shape * gain


def rattle(d, hits, material, gain=1.0, spread=1.0):
    x = silence(d + 0.1)
    for k in range(hits):
        at = rng.uniform(0, d) ** 1.4 / d ** 0.4 * spread
        place(x, impact(material, rng.uniform(0.15, 0.5), bright=1.3, d=0.06, damp=0.4), min(at, d), 1.0)
    return x * gain


def cloth(d, gain=1.0, lo=700, hi=5200):
    """Fabric swish: slow swelling band noise with fibrous flutter."""
    t = time(d)
    x = filt(noise(d), "band", (lo, hi), 1)
    flutter = 0.6 + 0.4 * np.abs(filt(noise(d), "low", 40, 1)) * 6
    swell = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.5
    return x * flutter * swell * gain


def thump(f0, f1, d, gain=1.0):
    t = time(d)
    f = f0 * (f1 / f0) ** (t / d)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env(d, 0.001, d / 3.5) * gain


def sweep(f0, f1, tau, d, attack=0.001):
    """Pitch-dropping sine: the pressure pulse of a blast, settling from f0 to f1."""
    t = time(d)
    f = f1 + (f0 - f1) * np.exp(-t / (tau * 0.6))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.clip(t / attack, 0, 1) * np.exp(-t / tau)


def palm(gain=1.0, cut=1100, tau=0.009):
    """A gloved hand landing on the gun: a soft, dull pat."""
    return (filt(noise(0.06), "low", cut) * env(0.06, 0.0015, tau) * 1.2 + thump(210, 110, 0.06, 0.5)) * gain


def crunch(d, density, gain, lo=1500, hi=9000):
    """Granular gravel: lots of tiny grain impacts, front-loaded."""
    x = silence(d + 0.01)
    count = int(density * d)
    for _ in range(count):
        at = (rng.uniform(0, 1) ** 1.8) * d
        g = filt(noise(0.004), "band", (lo, hi)) * env(0.004, 0.0002, rng.uniform(0.0004, 0.0012))
        place(x, g, at, rng.uniform(0.2, 1.0) * (1 - at / d) ** 0.7)
    return x * gain


def mix(d, *parts):
    buf = silence(d)
    for at, x, *g in parts:
        place(buf, x, at, g[0] if g else 1.0)
    return buf


# ---------------------------------------------------------------------------------------------
# Gunshots

# Round trips to the compound's walls (the yard is 80 m across): [delay s, gain]
WALLS = [(0.065, 1.0), (0.105, 0.8), (0.16, 0.62), (0.23, 0.5), (0.31, 0.38), (0.42, 0.27), (0.56, 0.17), (0.72, 0.1)]


def echoes(d, bright, size=1.0, sub=0.5):
    """
    Slap-back off the walls: each return comes later, quieter, darker and more smeared than the
    last, over a low rumble. `size` stretches the decay for bigger guns.
    """
    out = silence(d)
    for at, g in WALLS:
        at *= rng.uniform(0.9, 1.1)
        length = 0.12 + at * 0.5
        cut = max(320, bright / (1 + at * 5))
        e = nband(length, 110, cut) * env(length, 0.004 + at * 0.03, (0.022 + at * 0.09) * size)
        e += sweep(95, 48, 0.05 * size, length, attack=0.004) * sub
        place(out, e, at, g * rng.uniform(0.75, 1.2))
    return out + nband(d, 45, 420) * env(d, 0.08, 0.3 * size) * 0.35


def level(x, rms, peak=0.97, win=0.1):
    """
    Soft-clip so the first `win` seconds land on a target RMS at a fixed peak. Variants of one gun
    then match in loudness however their random layers fell, and the report is dense, not peaky.
    """
    x = x / (np.max(np.abs(x)) or 1)
    k = n_(win)
    lo, hi = 0.3, 8.0
    for _ in range(40):
        g = (lo * hi) ** 0.5
        if np.sqrt(np.mean((np.tanh(x[:k] * g) / np.tanh(g) * peak) ** 2)) < rms:
            lo = g
        else:
            hi = g
    return np.tanh(x * g) / np.tanh(g) * peak


GUNS = {
    # 5.56 carbine: a hard supersonic crack over a tight blast, bolt carrier and buffer spring
    "m4": dict(d=0.3, crack=1.3, crack_hp=2600, crack_tau=0.0024, hi=1.05, hi_tau=0.008, mid=(400, 2800), mid_tau=0.017,
               low_tau=0.028, punch=(175, 60, 0.026), punch_gain=1.0, rms=0.3,
               tail_d=1.3, tail_bright=3200, size=1.0, shots=4, tails=2),
    # 9 mm pistol: less crack, a mid-forward pop, the slide snapping back and home
    "pistol": dict(d=0.26, crack=0.75, crack_hp=1900, crack_tau=0.0015, hi=0.5, hi_tau=0.005, mid=(400, 2400), mid_tau=0.012,
                   low_tau=0.02, punch=(200, 75, 0.018), punch_gain=1.0, rms=0.24,
                   tail_d=1.0, tail_bright=2600, size=0.8, shots=4, tails=2),
    # 7.62 bolt gun: the biggest crack and a long, heavy blast; nothing cycles by itself
    "sniper": dict(d=0.6, crack=1.3, crack_hp=2200, crack_tau=0.003, hi=0.95, hi_tau=0.011, mid=(250, 1900), mid_tau=0.032,
                   low_tau=0.065, punch=(125, 40, 0.075), punch_gain=1.6, rms=0.4,
                   tail_d=2.0, tail_bright=2900, size=1.5, shots=3, tails=2),
}


def shot_close(gun):
    """
    The dry report. Everything starts on sample 0 and the bright layers are gone within ~20 ms,
    so shots 80 ms apart stay separate; the length lives in the tail file instead.
    """
    p = GUNS[gun]
    d = p["d"]
    # One bipolar cycle: the N-wave of the muzzle blast, the same on every shot
    k = n_(0.0005)
    click = np.sin(2 * np.pi * np.arange(k) / k) * 2.5
    crack = filt(noise(0.03), "high", jit(p["crack_hp"])) * env(0.03, 0.00005, jit(p["crack_tau"]))
    # The blast in three bands, the bright ones dying first (the fireball cools in milliseconds)
    hi = nband(d, 2000, 9000) * env(d, 0.0002, jit(p["hi_tau"]))
    mid = nband(d, *p["mid"]) * env(d, 0.0004, jit(p["mid_tau"]))
    low = nband(d, 90, 420) * env(d, 0.001, jit(p["low_tau"]))
    f0, f1, tau = p["punch"]
    punch = sweep(jit(f0, 0.05), f1, jit(tau, 0.05), d)
    blast = hi * jit(p["hi"], 0.12) + mid * jit(0.9, 0.12) + low * jit(0.8, 0.12)
    x = mix(d, (0, click), (0, crack, jit(p["crack"], 0.1) * 1.6), (0, blast), (0, punch, p["punch_gain"]))
    # Ground bounce: the blast again a few milliseconds later, duller. This is what says "outdoors".
    place(x, filt(blast, "low", 2400), jit(0.0065, 0.2), 0.3)
    if gun == "m4":
        # Carrier hits the back of the receiver extension, the buffer spring sings, it runs home
        place(x, impact("steel_heavy", 0.3, bright=1.2, d=0.08, damp=0.5, body=0.4), jit(0.031, 0.06))
        place(x, nband(0.09, 800, 1500) * env(0.09, 0.01, 0.022), 0.034, 0.1)
        place(x, impact("steel", 0.22, bright=1.4, d=0.08, damp=0.5), jit(0.066, 0.04))
    elif gun == "pistol":
        place(x, impact("steel", 0.34, bright=1.5, d=0.07, damp=0.5), jit(0.021, 0.08))
        place(x, impact("steel", 0.3, bright=1.7, d=0.08, damp=0.6, body=0.2), jit(0.056, 0.05))
    else:
        # No action noise: the stock and barrel ring instead
        place(x, modal("wood", 0.2) * env(0.2, 0.002, 1.0), 0.002, 0.3)
        place(x, modal("steel_heavy", 0.25, damp=1.4) * env(0.25, 0.002, 1.0), 0.003, 0.08)
    return level(filt(x, "high", 28), p["rms"])


def shot_tail(gun):
    p = GUNS[gun]
    x = np.stack([echoes(p["tail_d"], p["tail_bright"], p["size"]) for _ in range(2)], axis=1)
    return sosfilt(butter(2, 5000, btype="low", fs=SR, output="sos"), x, axis=0)


def shot_far(gun):
    """From across the compound the crack is gone: a boom, a muffled pop and the walls answering."""
    p = GUNS[gun]
    d = p["tail_d"] + 0.2
    f0, f1, tau = p["punch"]
    boom = sweep(f0 * 0.75, f1, tau * 2.6, 0.5, attack=0.004)
    pop = nband(0.4, 150, 900) * env(0.4, 0.003, p["mid_tau"] * 2.6)
    x = mix(d, (0, boom, 1.5), (0, pop, 1.0), (0, echoes(d, 1300, p["size"], sub=0.7), 0.55))
    return filt(x, "low", 1250, 4)


def gunshots():
    for gun, p in GUNS.items():
        for i in range(p["shots"]):
            write(f"{gun}_shot_{i}.wav", shot_close(gun), norm=False)
        for i in range(p["tails"]):
            write(f"{gun}_tail_{i}.wav", shot_tail(gun), 0.85, drive=1.4, sr=LOW_SR)
            write(f"{gun}_far_{i}.wav", shot_far(gun), 0.9, drive=1.3, sr=LOW_SR)


def explosions():
    for i in range(2):
        d = 2.8
        crack = filt(noise(0.05), "high", 1400) * env(0.05, 0.0001, 0.004)
        blast = mix(1.6,
                    (0, nband(0.4, 2000, 8000) * env(0.4, 0.0003, jit(0.024)), 0.7),
                    (0, nband(0.9, 300, 2000) * env(0.9, 0.0005, jit(0.085))),
                    (0, nband(1.6, 60, 300) * env(1.6, 0.002, jit(0.22)), 1.1))
        sub = sweep(jit(78, 0.05), 26, 0.4, 1.8, attack=0.002)
        # Dirt and grit thrown up, raining back down over the next second
        debris = crunch(1.3, 260, 0.5, 700, 6000) + nband(1.31, 400, 3000) * env(1.31, 0.15, 0.35) * 0.06
        x = mix(d, (0, crack, 2.0), (0, blast), (0, sub, 1.7), (0.16, debris),
                (0, echoes(d, 1800, 2.2, sub=0.8), 0.5))
        write(f"explosion_{i}.wav", level(filt(x, "high", 22), 0.42, win=0.3), norm=False)
    d = 3.0
    x = mix(d, (0, sweep(60, 26, 0.5, 1.6, attack=0.006), 1.6), (0, nband(1.0, 80, 600) * env(1.0, 0.004, 0.16)),
            (0, echoes(d, 1100, 2.4, sub=0.8), 0.6))
    write("explosion_far_0.wav", filt(x, "low", 900, 4), 0.9, drive=1.4, sr=LOW_SR)


# ---------------------------------------------------------------------------------------------
# Weapon handling: one file per motion, so the timelines can place each where the hands do it

def dry_fire():
    # Trigger slack, then the hammer falling on an empty chamber: small, hard, metallic
    x = mix(0.25,
            (0, scrape(0.018, 2000, 6000, 0.08)),
            (0.02, impact("steel", 1.0, bright=1.6, d=0.2, damp=0.7)),
            (0.02, impact("polymer", 0.35, d=0.08)),
            (0.021, thump(320, 180, 0.03, 0.25)))
    write("dry_fire.wav", x, 0.7)


def cloth_set():
    # Glove and sleeve leaving the gun: a short rustle, each one a different length and colour
    for i, (d, lo, hi) in enumerate([(0.15, 800, 5200), (0.2, 600, 4200), (0.17, 1000, 6000)]):
        x = mix(d + 0.03, (0, cloth(d, 1.0, lo, hi)), (rng.uniform(0.02, 0.05), palm(0.18, 800, 0.006)))
        write(f"cloth_{i}.wav", x, 0.6)


def grip_set():
    # The hand settling back on the gun: a gloved pat on polymer, a little fabric
    for i in range(2):
        x = mix(0.2,
                (0, cloth(0.07, 0.25)),
                (0.03, palm(1.0, jit(1000, 0.2))),
                (0.031, impact("polymer", 0.3, d=0.06)),
                (0.05, rattle(0.04, 2, "steel", 0.12)))
        write(f"grip_{i}.wav", x, 0.7)


def rattle_set():
    # The weapon turned over in the hands: sling hardware, the magazine and stock shifting
    for i in range(3):
        x = mix(0.34,
                (0, cloth(0.2, 0.3)),
                (0.02, rattle(0.14, 3 + i, "steel", 0.55)),
                (0.04, rattle(0.12, 2, "aluminium", 0.5)),
                (rng.uniform(0.1, 0.16), impact("polymer", 0.35, d=0.07)))
        write(f"rattle_{i}.wav", x, 0.6)


def ads_set():
    # Rifle coming up to the eye: sleeve, cheek on the stock, hardware barely moving
    for i in range(2):
        x = mix(0.2,
                (0, cloth(0.14, 0.9, 600, 3800)),
                (0.07, palm(0.4, 700)),
                (rng.uniform(0.05, 0.09), rattle(0.04, 2, "steel", 0.12)))
        write(f"ads_{i}.wav", x, 0.5)


def mag_release():
    # Thumb on the catch: one small steel click, and the button springing back
    x = mix(0.12,
            (0, impact("steel", 0.9, bright=1.5, d=0.08, damp=0.4)),
            (0.001, impact("polymer", 0.4, d=0.05)),
            (0.014, impact("steel", 0.3, bright=1.7, d=0.05, damp=0.3)))
    write("mag_release.wav", x, 0.7)


def mag_out():
    # The magazine drawn down its rails, rounds shifting, then clearing the well with a hollow pop
    x = mix(0.34,
            (0, scrape(0.12, 900, 4200, 0.6, grit=300, attack=0.012)),
            (0.01, impact("aluminium", 0.4, d=0.15, body=0.3)),
            (0.03, rattle(0.1, 5, "brass", 0.45)),
            (0.118, impact("aluminium", 0.6, d=0.2, body=0.5)),
            (0.12, impact("polymer", 0.45, d=0.08)),
            (0.12, thump(260, 140, 0.04, 0.3)))
    write("mag_out.wav", x)


def mag_insert():
    # The fresh magazine finds the well (a tick on the lip) and slides up, rounds rattling
    x = mix(0.2,
            (0, impact("aluminium", 0.55, bright=1.2, d=0.1, damp=0.6)),
            (0.004, impact("polymer", 0.3, d=0.05)),
            (0.03, scrape(0.125, 800, 3800, 0.6, grit=260, attack=0.06)),
            (0.04, rattle(0.09, 4, "brass", 0.3)))
    write("mag_insert.wav", x, 0.7)


def mag_in():
    # Seated with a slap on the baseplate: the catch snaps into its notch and the receiver rings
    x = mix(0.34,
            (0, impact("aluminium", 1.0, bright=1.1, d=0.3, body=0.9)),
            (0.002, impact("steel", 0.8, bright=1.5, d=0.25)),
            (0, palm(0.9)),
            (0.003, thump(240, 120, 0.06, 0.6)),
            (0.035, rattle(0.08, 4, "brass", 0.3)))
    write("mag_in.wav", x)


def bolt_release():
    # Palm slapped onto the bolt catch: flesh on the receiver and the lever tripping
    x = mix(0.14,
            (0, palm(1.0, 1400, 0.007)),
            (0.003, impact("steel", 0.6, bright=1.4, d=0.1, damp=0.5)),
            (0.004, impact("aluminium", 0.35, d=0.1, body=0.3)))
    write("bolt_release.wav", x, 0.8)


def charge_back():
    # Charging handle pulled: grinding travel against the buffer spring, then it bottoms out
    t_ = 0.14
    spring = filt(noise(t_), "band", (1800, 7000)) * np.linspace(0.2, 1, n_(t_)) * 0.25
    x = mix(0.4,
            (0, impact("steel", 0.5, bright=1.3, d=0.1, damp=0.6)),
            (0.01, scrape(t_, 1200, 6500, 0.6, grit=400, attack=0.02)),
            (0.01, spring),
            (0.15, impact("steel_heavy", 0.8, d=0.25, body=0.6)),
            (0.16, rattle(0.06, 3, "steel", 0.3)))
    write("charge_back.wav", x)


def charge_fwd():
    # Bolt carrier driven home by the buffer spring: a short run, then it strips a round, slams
    # into battery and the whole rifle rings; the spring twangs in the stock afterwards
    twang = (np.sin(2 * np.pi * 640 * time(0.25)) + 0.6 * np.sin(2 * np.pi * 1130 * time(0.25))) * env(0.25, 0.004, 0.06)
    x = mix(0.5,
            (0, scrape(0.03, 1500, 7000, 0.45, grit=500, attack=0.003)),
            (0.03, impact("steel_heavy", 1.0, bright=1.3, d=0.4, body=1.0)),
            (0.031, impact("steel", 0.8, bright=1.6, d=0.3)),
            (0.031, thump(210, 90, 0.08, 0.8)),
            (0.033, twang, 0.14),
            (0.05, rattle(0.1, 4, "steel", 0.35)),
            (0.11, impact("polymer", 0.25, d=0.06)))
    write("charge_fwd.wav", x, 0.95, drive=1.5)


def slide_back():
    # Overhand grab and pull against the recoil spring until the slide stops
    t_ = 0.065
    spring = filt(noise(t_), "band", (2200, 8000)) * np.linspace(0.2, 1, n_(t_)) * 0.3
    x = mix(0.2,
            (0, palm(0.35, 1500, 0.004)),
            (0.004, scrape(t_, 1800, 7500, 0.55, grit=600, attack=0.015)),
            (0.004, spring),
            (0.07, impact("steel", 0.7, bright=1.5, d=0.12, damp=0.6)),
            (0.071, impact("polymer", 0.3, d=0.05)))
    write("slide_back.wav", x, 0.75)


def slide():
    # Pistol slide let go: snaps forward, strips a round and locks with a sharp steel clack
    x = mix(0.36,
            (0, scrape(0.022, 1800, 7500, 0.4, grit=600, attack=0.003)),
            (0.023, impact("steel", 1.0, bright=1.7, d=0.3)),
            (0.024, impact("steel_heavy", 0.55, d=0.25, body=0.4)),
            (0.024, thump(300, 150, 0.04, 0.4)),
            (0.055, rattle(0.06, 3, "steel", 0.25)))
    write("slide.wav", x, 0.9, drive=1.3)


def pistol_mags():
    # Steel magazine in a polymer grip: quicker, thinner and drier than the rifle's
    out = mix(0.22,
              (0, scrape(0.055, 1400, 6500, 0.6, grit=500, attack=0.006)),
              (0.004, impact("steel", 0.35, bright=1.3, d=0.08, damp=0.5)),
              (0.055, impact("polymer", 0.6, d=0.08)),
              (0.056, thump(380, 200, 0.03, 0.3)),
              (0.03, rattle(0.05, 2, "brass", 0.25)))
    write("pistol_mag_out.wav", out, 0.8)
    ins = mix(0.2,
              (0, impact("steel", 0.5, bright=1.4, d=0.08, damp=0.5)),
              (0.003, impact("polymer", 0.4, d=0.05)),
              (0.03, scrape(0.11, 1400, 6000, 0.55, grit=420, attack=0.05)))
    write("pistol_mag_insert.wav", ins, 0.65)
    seat = mix(0.28,
               (0, impact("steel", 0.9, bright=1.5, d=0.2, damp=0.8)),
               (0.001, impact("polymer", 0.9, d=0.1)),
               (0, palm(0.8, 1300)),
               (0.002, thump(330, 170, 0.04, 0.5)),
               (0.03, rattle(0.05, 2, "brass", 0.2)))
    write("pistol_mag_in.wav", seat, 0.85)


def bolt_action():
    # Handle lifted: the cocking cam clicks as it starts and knocks at the top of its turn
    up = mix(0.2,
             (0, impact("steel", 0.7, bright=1.2, d=0.12, damp=0.7)),
             (0.01, scrape(0.06, 1500, 6000, 0.25, grit=400)),
             (0.075, impact("steel_heavy", 0.6, d=0.15, damp=0.8)),
             (0.076, impact("wood", 0.5, d=0.08)))
    write("bolt_up.wav", up, 0.75)
    # Drawn back along its raceway until the bolt stop; the case comes out with it
    back = mix(0.42,
               (0, scrape(0.14, 900, 5500, 0.6, grit=320, attack=0.03)),
               (0.14, impact("steel_heavy", 0.8, d=0.25, body=0.5)),
               (0.15, impact("brass", 0.5, bright=1.4, d=0.2)),
               (0.19, rattle(0.07, 3, "brass", 0.25)))
    write("bolt.wav", back)
    # Pushed forward: picks a round off the magazine and runs it into the chamber
    fwd = mix(0.3,
              (0, impact("brass", 0.35, bright=1.3, d=0.08)),
              (0.005, scrape(0.085, 1000, 6000, 0.65, grit=380, attack=0.03)),
              (0.09, impact("steel_heavy", 0.85, d=0.2, body=0.5)),
              (0.092, impact("wood", 0.5, d=0.1)))
    write("bolt_fwd.wav", fwd, 0.85)
    # Handle turned down: the lugs cam into the receiver and the knob lands on the stock
    lock = mix(0.3,
               (0, scrape(0.035, 1500, 6500, 0.3, grit=450, attack=0.005)),
               (0.038, impact("steel_heavy", 1.0, bright=1.2, d=0.25, body=0.6)),
               (0.039, impact("steel", 0.5, bright=1.4, d=0.15)),
               (0.04, impact("wood", 0.9, d=0.12)),
               (0.04, thump(230, 110, 0.05, 0.5)))
    write("sniper_charge_fwd.wav", lock, 0.9)


def round_in():
    # A cartridge laid on the follower and thumbed down until it snaps under the feed lips
    x = mix(0.26,
            (0, impact("brass", 0.5, bright=1.3, d=0.1)),
            (0.008, scrape(0.03, 2500, 8000, 0.4, grit=500, attack=0.01)),
            (0.032, impact("brass", 0.9, bright=1.3, d=0.2)),
            (0.034, impact("steel", 0.5, d=0.15)),
            (0.034, thump(300, 170, 0.03, 0.3)),
            (0.045, rattle(0.05, 2, "brass", 0.25)))
    write("round_in.wav", x)


def pouch():
    # Old magazine away, new one out: a flap ripped open, fabric, magazines knocking together
    x = mix(0.4,
            (0, crunch(0.09, 900, 0.5, 2500, 9000)),
            (0.03, cloth(0.3, 1.0, 500, 4200)),
            (0.16, impact("aluminium", 0.3, d=0.12, damp=0.5)),
            (0.19, rattle(0.08, 3, "brass", 0.3)),
            (0.25, impact("polymer", 0.3, d=0.06)))
    write("pouch.wav", x, 0.6)


def mag_drop():
    # Empty aluminium mag lands on gravel: dull hit, skitter, small second bounce
    grit = rattle(0.12, 10, "polymer", 0.4)
    x = mix(0.6,
            (0, impact("aluminium", 1.0, d=0.3, damp=0.6)),
            (0, thump(160, 80, 0.07, 0.6)),
            (0.004, filt(noise(0.08), "band", (1500, 7000)) * env(0.08, 0.001, 0.02), 0.5),
            (0.02, grit),
            (0.19, impact("aluminium", 0.45, d=0.2, damp=0.6)),
            (0.3, impact("aluminium", 0.18, d=0.12, damp=0.5)))
    write("mag_drop.wav", x, 0.8)


def holster():
    # Gear movement: fabric swish, sling swivel jingle, a soft polymer knock on the plate carrier
    x = mix(0.45,
            (0, cloth(0.3, 1.0)),
            (0.12, rattle(0.08, 3, "steel", 0.35)),
            (0.22, impact("polymer", 0.4, d=0.08)))
    write("holster.wav", x, 0.6)


def raise_stow():
    # Weapon coming up into the hands: the grip caught, hardware settling, stock into the shoulder
    up = mix(0.36,
             (0, cloth(0.16, 0.5)),
             (0.02, palm(0.9, 1000)),
             (0.025, impact("polymer", 0.5, d=0.08)),
             (0.04, rattle(0.12, 4, "steel", 0.45)),
             (0.15, thump(150, 80, 0.07, 0.6)),
             (0.15, filt(noise(0.05), "low", 600) * env(0.05, 0.003, 0.012), 0.6))
    write("raise.wav", up, 0.7)
    # Lowered out of the way: quick fabric and a knock against the kit
    down = mix(0.26,
               (0, cloth(0.2, 0.9, 500, 4000)),
               (0.05, rattle(0.07, 2, "steel", 0.3)),
               (0.13, impact("polymer", 0.35, d=0.07)),
               (0.13, thump(170, 90, 0.05, 0.4)))
    write("stow.wav", down, 0.6)


def pickups():
    # Ammo scooped up: rounds chattering in a magazine as it goes into a pouch
    ammo = mix(0.42,
               (0, cloth(0.22, 0.6)),
               (0.03, rattle(0.16, 7, "brass", 0.6)),
               (0.06, impact("aluminium", 0.5, d=0.15, damp=0.6)),
               (0.2, impact("aluminium", 0.7, d=0.15, damp=0.6, body=0.3)),
               (0.21, impact("polymer", 0.4, d=0.07)))
    write("pickup_ammo.wav", ammo, 0.7)
    # A weapon lifted off the ground: sling and swivels, then its weight landing in the hands
    gun = mix(0.5,
              (0, cloth(0.28, 0.7)),
              (0.02, rattle(0.18, 5, "steel", 0.6)),
              (0.08, impact("steel_heavy", 0.4, d=0.15, damp=0.6)),
              (0.24, palm(1.0, 900)),
              (0.245, impact("polymer", 0.6, d=0.09)),
              (0.25, impact("steel_heavy", 0.35, d=0.2, body=0.5)))
    write("pickup_weapon.wav", gun, 0.7)


def casings():
    for i in range(3):
        # Spent case tinkling on hard ground: three bounces, each closer and quieter
        b1 = rng.uniform(0.07, 0.11)
        b2 = b1 + rng.uniform(0.05, 0.08)
        x = mix(0.5,
                (0, impact("brass", 1.0, bright=1.4, d=0.3, damp=1.2)),
                (b1, impact("brass", 0.45, bright=1.4, d=0.25)),
                (b2, impact("brass", 0.2, bright=1.4, d=0.2)))
        write(f"casing_hard_{i}.wav", x, 0.6)
        # On dirt it barely rings: a dull tick and a few grains kicked loose
        x = mix(0.3,
                (0, impact("brass", 0.7, bright=1.0, d=0.1, damp=0.3)),
                (0, filt(noise(0.03), "low", 900) * env(0.03, 0.001, 0.007), 0.5),
                (0.003, crunch(0.06, 400, 0.3)),
                (rng.uniform(0.07, 0.1), impact("brass", 0.18, bright=1.0, d=0.06, damp=0.25)))
        write(f"casing_dirt_{i}.wav", x, 0.5)


# ---------------------------------------------------------------------------------------------
# Footsteps

def footstep_dirt(i):
    heel = filt(noise(0.05), "low", 380) * env(0.05, 0.002, 0.012)
    x = mix(0.3,
            (0, heel, 1.3),
            (0, thump(110, 60, 0.05, 0.6)),
            (0.002, crunch(0.1, 700, 0.55)),
            (0.012, filt(noise(0.07), "band", (300, 1600)) * env(0.07, 0.005, 0.02), 0.35),
            # toe roll
            (0.055 + rng.uniform(0, 0.02), crunch(0.07, 500, 0.3)),
            (0.06, filt(noise(0.03), "low", 500) * env(0.03, 0.002, 0.008), 0.4))
    write(f"footstep_dirt_{i}.wav", x, 0.8)


def footstep_hard(i):
    # Boot on asphalt/concrete: firm heel tap with a gritty scuff, then the toe
    heel = filt(noise(0.03), "band", (120, 900)) * env(0.03, 0.001, 0.009)
    tap = filt(noise(0.01), "band", (1500, 6000)) * env(0.01, 0.0002, 0.0018)
    x = mix(0.3,
            (0, heel, 1.2),
            (0, thump(140, 70, 0.04, 0.5)),
            (0, tap, 0.6),
            (0.004, scrape(0.05, 900, 5000, 0.18, grit=500, attack=0.004)),
            (0.003, crunch(0.04, 300, 0.2, 3000, 10000)),
            (0.05 + rng.uniform(0, 0.02), tap, 0.35),
            (0.052, heel, 0.4))
    write(f"footstep_hard_{i}.wav", x, 0.8)


# ---------------------------------------------------------------------------------------------
# Bullets arriving, bodies, UI, ambience

def impacts():
    for i in range(3):
        # Concrete, brick, steel: a hard crack, chips flying, a short ring from the wall
        x = mix(0.34,
                (0, filt(noise(0.012), "high", jit(2400)) * env(0.012, 0.0001, 0.002), 1.2),
                (0, nband(0.2, 500, 4000) * env(0.2, 0.0006, jit(0.022)), 0.5),
                (0, thump(jit(190), 90, 0.05, 0.5)),
                (0.001, modal("steel_heavy", 0.1, detune=0.2, damp=0.25), 0.12),
                (0.006, crunch(0.14, 480, 0.4, 1500, 9000)))
        write(f"impact_hard_{i}.wav", x, 0.8)
        # Dirt: a thud that swallows the round and a spray of soil
        x = mix(0.36,
                (0, filt(noise(0.08), "low", jit(900)) * env(0.08, 0.0008, 0.018), 1.3),
                (0, thump(jit(130), 55, 0.08, 0.9)),
                (0.004, nband(0.2, 400, 2600) * env(0.2, 0.01, 0.045), 0.16),
                (0.01, crunch(0.2, 380, 0.3, 700, 4500)))
        write(f"impact_dirt_{i}.wav", x, 0.8)
        # Ricochet: the hit, then the deformed bullet whining away, tumbling as it slows
        d = 0.6
        t = time(d)
        f0 = rng.uniform(2600, 4600)
        f = f0 * (0.45 + 0.55 * np.exp(-t / rng.uniform(0.08, 0.16)))
        ph = 2 * np.pi * np.cumsum(f) / SR
        tumble = 1 + 0.55 * np.sin(2 * np.pi * rng.uniform(50, 110) * t * (1 - 0.5 * t / d))
        whine = (np.sin(ph) + 0.35 * np.sin(2.01 * ph) + nband(d, 1500, 7000) * 0.3) * tumble * env(d, 0.004, rng.uniform(0.1, 0.17))
        x = mix(d,
                (0, filt(noise(0.01), "high", 2800) * env(0.01, 0.0001, 0.0018), 1.4),
                (0, modal("steel", 0.1, detune=0.15, damp=0.4), 0.2),
                (0.004, whine, 0.45))
        write(f"ricochet_{i}.wav", x, 0.7)
    for i in range(3):
        # Round into a body: a dull, wet slap with weight behind it
        x = mix(0.26,
                (0, filt(noise(0.06), "low", jit(1600)) * env(0.06, 0.001, 0.012), 1.0),
                (0, thump(jit(95), 50, 0.08, 0.8)),
                (0.002, nband(0.03, 1000, 4500) * env(0.03, 0.0005, 0.005), 0.2),
                (0.01, filt(noise(0.12), "band", (200, 900)) * env(0.12, 0.003, 0.03), 0.5),
                (0.015, cloth(0.06, 0.25)))
        write(f"flesh_{i}.wav", x, 0.75)


def whizzes():
    for i in range(4):
        d = 0.3
        t = time(d)
        at = 0.085
        air = filt(noise(d), "band", (jit(1200, 0.15), jit(7000, 0.15)), 2)
        # Doppler-ish sweep: band moves down as the round passes
        low = filt(noise(d), "band", (jit(600, 0.15), jit(2400, 0.15)), 2)
        shape = np.exp(-((t - at) / jit(0.045, 0.2)) ** 2)
        tilt = np.clip((t - at) / 0.1 + 0.5, 0, 1)
        out = (air * 0.6 * (1 - tilt * 0.6) + low * 0.5 * (0.5 + tilt)) * shape
        if i < 2:
            # Supersonic and close: the bullet's own crack leads the hiss
            place(out, filt(noise(0.006), "high", 3000) * env(0.006, 0.0001, 0.0012), at, 1.0)
        write(f"whiz_{i}.wav", out, 0.75)


def hurts():
    for i in range(2):
        # Hit taken: the thud through the plate carrier and the kit jolting
        x = mix(0.4,
                (0, filt(noise(0.1), "low", jit(520)) * env(0.1, 0.001, 0.03), 1.2),
                (0, sweep(jit(85), 40, 0.09, 0.3), 1.2),
                (0.002, impact("polymer", 0.9, d=0.08)),
                (0.004, nband(0.08, 400, 2200) * env(0.08, 0.001, 0.016), 0.9),
                (0.03, cloth(0.14, 0.2)),
                (0.05, rattle(0.08, 3, "steel", 0.12)))
        write(f"hurt_{i}.wav", x, 0.85, drive=1.6)


def ui():
    # Hit confirm: a dry tick. The headshot is higher and doubled, the kill has a low knock under it.
    write("hitmarker.wav", impact("steel", 1.0, bright=1.8, d=0.1, damp=0.35), 0.5)
    head = mix(0.14, (0, impact("brass", 1.0, bright=1.9, d=0.1, damp=0.6)), (0.035, impact("brass", 0.6, bright=2.0, d=0.08, damp=0.5)))
    write("hitmarker_head.wav", head, 0.5)
    kill = mix(0.2, (0, impact("wood", 1.0, d=0.12)), (0, thump(220, 120, 0.06, 0.8)), (0.001, impact("steel", 0.3, bright=1.6, d=0.08, damp=0.4)))
    write("hit_kill.wav", kill, 0.6)


def wind():
    """Open-air bed: gusting mid-band wind, a little hiss in the gusts, a low rumble. Loops."""
    D, X, lead = 8.0, 2.0, 1.0
    total = D + X + lead

    def gusts():
        knots = np.arange(0, total + 1.5, 0.75)
        return CubicSpline(knots, rng.uniform(0.4, 1.0, len(knots)))(time(total))

    def chan(g):
        # Mostly the shared gusts (wind is one air mass) with a little of this ear's own
        g = np.clip(0.8 * g + 0.2 * gusts(), 0.25, 1.1)
        x = nband(total, 110, 650, 1) * g + nband(total, 900, 3600, 1) * g ** 3 * 0.22 + nband(total, 30, 110) * 0.45
        x = x[n_(lead):]
        k, m = n_(D), n_(X)
        r = np.linspace(0, np.pi / 2, m)
        y = x[:k].copy()
        # The lap's first seconds are blended with what would have followed its end
        y[:m] = x[:m] * np.sin(r) + x[k:k + m] * np.cos(r)
        return y

    shared = gusts()
    write("amb_wind.wav", np.stack([chan(shared), chan(shared)], axis=1), 0.6, drive=0.8, sr=16000, loop=True)


if __name__ == "__main__":
    gunshots()
    explosions()
    dry_fire()
    cloth_set()
    grip_set()
    rattle_set()
    ads_set()
    mag_release()
    mag_out()
    mag_insert()
    mag_in()
    bolt_release()
    charge_back()
    charge_fwd()
    slide_back()
    slide()
    pistol_mags()
    bolt_action()
    round_in()
    pouch()
    mag_drop()
    holster()
    raise_stow()
    pickups()
    casings()
    for i in range(6):
        footstep_dirt(i)
        footstep_hard(i)
    impacts()
    whizzes()
    hurts()
    ui()
    wind()
    # Files from an older version of this script would otherwise ship as dead weight
    for f in os.listdir(OUT):
        if f.endswith(".wav") and f not in written:
            os.remove(os.path.join(OUT, f))
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in written)
    print(f"{len(written)} sounds ({total / 1e6:.1f} MB) written to {os.path.normpath(OUT)}")
