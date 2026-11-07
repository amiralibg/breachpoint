#!/usr/bin/env python3
"""
Synthesize Breachpoint's sound effects into public/assets/audio (numpy + scipy, no downloads).

Everything is built from physical pieces instead of beeps:
  - impacts: a broadband contact transient that excites a bank of decaying modes (modal synthesis).
    Steel, aluminium, polymer, brass and the rifle body each have their own inharmonic modes, so a
    bolt slamming home rings like steel and a magazine seats with a dull aluminium/polymer clack.
  - scrapes: band-passed noise with a gritty, randomly modulated envelope (parts sliding in rails).
  - rattles: clusters of tiny impacts (rounds in a magazine, springs, loose sling hardware).
  - footsteps: heel strike + toe roll, with a granular gravel crunch on dirt or a hard scuff on
    asphalt; several variants per surface so steps never repeat.
Run: npm run sounds
"""
import os
import wave

import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "assets", "audio")
rng = np.random.default_rng(7)


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


def env(d, attack=0.0005, tau=0.05):
    t = time(d)
    a = np.clip(t / max(attack, 1e-5), 0, 1)
    return a * np.exp(-t / tau)


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


def write(name, x, peak=0.9):
    os.makedirs(OUT, exist_ok=True)
    x = np.asarray(x, dtype=np.float64)
    # Gentle fade-out so nothing clicks at the end
    fade = min(len(x), n_(0.01))
    x[-fade:] *= np.linspace(1, 0, fade)
    m = np.max(np.abs(x)) or 1
    x = np.tanh(x / m * 1.1) / np.tanh(1.1) * peak
    data = (x * 32767).astype("<i2").tobytes()
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)


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


def cloth(d, gain=1.0):
    """Fabric swish: slow swelling band noise with fibrous flutter."""
    t = time(d)
    x = filt(noise(d), "band", (700, 5200), 1)
    flutter = 0.6 + 0.4 * np.abs(filt(noise(d), "low", 40, 1)) * 6
    swell = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.5
    return x * flutter * swell * gain


def thump(f0, f1, d, gain=1.0):
    t = time(d)
    f = f0 * (f1 / f0) ** (t / d)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env(d, 0.001, d / 3.5) * gain


def mix(d, *parts):
    buf = silence(d)
    for at, x, *g in parts:
        place(buf, x, at, g[0] if g else 1.0)
    return buf


# ---------------------------------------------------------------------------------------------
# Gunshots: supersonic crack, muzzle blast, body thump, mechanism clack and a compound slap-back

def gunshot(name, power, mech="steel", mech_at=0.012):
    d = 1.5 * power
    crack = filt(noise(0.012), "high", 2500) * env(0.012, 0.0001, 0.0025)
    blast = filt(noise(0.35 * power), "low", 5200) * env(0.35 * power, 0.0004, 0.045 * power)
    blast += filt(noise(0.35 * power), "band", (150, 900)) * env(0.35 * power, 0.001, 0.08 * power) * 1.3
    boom = thump(120 + 25 / power, 38, 0.32 * power, 1.4)
    tail = filt(noise(1.1 * power), "low", 1100) * env(1.1 * power, 0.03, 0.28 * power)
    slap = filt(noise(0.5 * power), "band", (250, 1800)) * env(0.5 * power, 0.004, 0.09 * power)
    x = mix(d, (0, crack, 1.1), (0, blast), (0, boom), (0.05, tail, 0.25), (0.13, slap, 0.22), (0.27, slap, 0.1))
    place(x, impact(mech, 0.18, bright=1.2, d=0.15), mech_at)
    write(name, x)


# ---------------------------------------------------------------------------------------------
# Weapon handling

def dry_fire():
    # Trigger slack, then the hammer falling on an empty chamber: small, hard, metallic
    x = mix(0.25,
            (0, scrape(0.018, 2000, 6000, 0.08)),
            (0.02, impact("steel", 1.0, bright=1.6, d=0.2, damp=0.7)),
            (0.02, impact("polymer", 0.35, d=0.08)))
    write("dry_fire.wav", x, 0.7)


def mag_out():
    # Thumb presses the release (click), the mag drops out of the well along its rails
    x = mix(0.4,
            (0, impact("steel", 0.6, bright=1.4, d=0.12, damp=0.6)),
            (0.025, scrape(0.11, 900, 4200, 0.45, grit=300)),
            (0.03, impact("aluminium", 0.55, d=0.2, body=0.35)),
            (0.06, rattle(0.12, 5, "brass", 0.5)),
            (0.14, impact("polymer", 0.3, d=0.08)))
    write("mag_out.wav", x)


def mag_in():
    # Rounds rattle, the mag slides up the well and the catch snaps into its notch
    x = mix(0.45,
            (0, rattle(0.06, 3, "brass", 0.35)),
            (0.02, scrape(0.09, 800, 3800, 0.55, grit=260, attack=0.02)),
            (0.115, impact("aluminium", 1.0, bright=1.1, d=0.3, body=0.9)),
            (0.118, impact("steel", 0.75, bright=1.5, d=0.25)),
            (0.12, thump(240, 120, 0.06, 0.5)),
            (0.16, rattle(0.08, 4, "brass", 0.3)))
    write("mag_in.wav", x)


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
    # Released: the bolt carrier slams home, strips a round and locks; the whole rifle rings
    x = mix(0.5,
            (0, scrape(0.035, 1500, 7000, 0.4, grit=500, attack=0.003)),
            (0.035, impact("steel_heavy", 1.0, bright=1.3, d=0.4, body=1.0)),
            (0.036, impact("steel", 0.8, bright=1.6, d=0.3)),
            (0.037, thump(210, 90, 0.08, 0.7)),
            (0.06, rattle(0.1, 4, "steel", 0.35)),
            (0.12, impact("polymer", 0.25, d=0.06)))
    write("charge_fwd.wav", x)


def slide():
    # Pistol slide released: snaps forward, locks with a sharp steel clack
    x = mix(0.4,
            (0, impact("steel", 0.4, bright=1.3, d=0.08, damp=0.6)),
            (0.008, scrape(0.03, 1800, 7500, 0.35, grit=600, attack=0.003)),
            (0.04, impact("steel", 1.0, bright=1.7, d=0.3)),
            (0.041, impact("steel_heavy", 0.5, d=0.25, body=0.4)),
            (0.075, rattle(0.06, 3, "steel", 0.25)))
    write("slide.wav", x)


def bolt():
    # Bolt-action: handle lifts (cam click), bolt draws back on its raceway, case is extracted
    x = mix(0.55,
            (0, impact("steel", 0.6, bright=1.2, d=0.12, damp=0.7)),
            (0.03, impact("steel_heavy", 0.45, d=0.15)),
            (0.07, scrape(0.16, 900, 5500, 0.55, grit=320, attack=0.03)),
            (0.23, impact("steel_heavy", 0.7, d=0.25, body=0.5)),
            (0.25, impact("brass", 0.6, bright=1.4, d=0.2)),
            (0.3, rattle(0.08, 3, "brass", 0.3)))
    write("bolt.wav", x)


def round_in():
    x = mix(0.3,
            (0, scrape(0.05, 2500, 8000, 0.35, grit=500, attack=0.01)),
            (0.045, impact("brass", 0.9, bright=1.3, d=0.2)),
            (0.047, impact("steel", 0.45, d=0.15)),
            (0.05, rattle(0.05, 2, "brass", 0.25)))
    write("round_in.wav", x)


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


def casing(name, material="brass"):
    # Spent case tinkling on hard ground (two bounces)
    x = mix(0.5,
            (0, impact(material, 1.0, bright=1.4, d=0.3, damp=1.2)),
            (0.09, impact(material, 0.45, bright=1.4, d=0.25)),
            (0.16, impact(material, 0.2, bright=1.4, d=0.2)))
    write(name, x, 0.6)


# ---------------------------------------------------------------------------------------------
# Footsteps

def crunch(d, density, gain, lo=1500, hi=9000):
    """Granular gravel: lots of tiny grain impacts, front-loaded."""
    x = silence(d + 0.01)
    count = int(density * d)
    for _ in range(count):
        at = (rng.uniform(0, 1) ** 1.8) * d
        g = filt(noise(0.004), "band", (lo, hi)) * env(0.004, 0.0002, rng.uniform(0.0004, 0.0012))
        place(x, g, at, rng.uniform(0.2, 1.0) * (1 - at / d) ** 0.7)
    return x * gain


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
# Impacts and the rest

def impacts():
    x = mix(0.35,
            (0, filt(noise(0.01), "high", 2500) * env(0.01, 0.0001, 0.002), 1.0),
            (0, filt(noise(0.2), "band", (400, 3500)) * env(0.2, 0.001, 0.03), 0.6),
            (0.005, crunch(0.12, 500, 0.4, 1200, 8000)))
    write("impact.wav", x, 0.7)
    flesh = mix(0.25,
                (0, filt(noise(0.06), "low", 1600) * env(0.06, 0.001, 0.012), 1.0),
                (0, thump(95, 50, 0.08, 0.8)),
                (0.01, filt(noise(0.12), "band", (200, 900)) * env(0.12, 0.003, 0.03), 0.5))
    write("flesh.wav", flesh, 0.7)


def whiz():
    d = 0.3
    t = time(d)
    x = filt(noise(d), "band", (1200, 7000), 2)
    # Doppler-ish sweep: band moves down as the round passes
    sweep = filt(noise(d), "band", (600, 2400), 2)
    shape = np.exp(-((t - 0.09) / 0.045) ** 2)
    crack = filt(noise(0.006), "high", 3000) * env(0.006, 0.0001, 0.0012)
    out = (x * 0.6 + sweep * 0.5) * shape
    place(out, crack, 0.085, 0.8)
    write("whiz.wav", out, 0.75)


def hitmarker():
    x = impact("steel", 1.0, bright=1.8, d=0.12, damp=0.5)
    write("hitmarker.wav", x, 0.5)


if __name__ == "__main__":
    gunshot("m4_shot.wav", 1.2, "steel_heavy", 0.01)
    gunshot("pistol_shot.wav", 0.95, "steel", 0.008)
    gunshot("sniper_shot.wav", 1.8, "steel_heavy", 0.02)
    dry_fire()
    mag_out()
    mag_in()
    charge_back()
    charge_fwd()
    slide()
    bolt()
    round_in()
    mag_drop()
    holster()
    casing("casing_0.wav")
    casing("casing_1.wav")
    casing("casing_2.wav")
    for i in range(6):
        footstep_dirt(i)
        footstep_hard(i)
    impacts()
    whiz()
    hitmarker()
    old = os.path.join(OUT, "footstep.wav")
    if os.path.exists(old):
        os.remove(old)
    print("sounds written to", os.path.normpath(OUT))
