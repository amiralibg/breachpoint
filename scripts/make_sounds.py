#!/usr/bin/env python3
"""Synthesize the game's sound effects into assets/audio (stdlib only, no downloads)."""
import math, os, random, struct, wave

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "assets", "audio")
random.seed(7)


def write(name, samples):
    os.makedirs(OUT, exist_ok=True)
    peak = max(1e-6, max(abs(s) for s in samples))
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s / peak * 0.95)) * 32767)) for s in samples))


def noise_burst(dur, gain, f0, f1, attack=0.001, curve=1.0):
    """White noise through a one-pole lowpass whose cutoff sweeps f0 -> f1, exponential decay."""
    n = int(dur * SR)
    out, y = [], 0.0
    for i in range(n):
        t = i / n
        fc = f0 * (f1 / f0) ** t
        a = 1 - math.exp(-2 * math.pi * fc / SR)
        y += a * (random.uniform(-1, 1) - y)
        env = min(1.0, i / (attack * SR + 1)) * math.exp(-t * 6 * curve)
        out.append(y * gain * env)
    return out


def sweep(dur, gain, f0, f1):
    n = int(dur * SR)
    out, ph = [], 0.0
    for i in range(n):
        t = i / n
        f = f0 * (f1 / f0) ** t
        ph += 2 * math.pi * f / SR
        out.append(math.sin(ph) * gain * math.exp(-t * 5))
    return out


def mix(length, *parts):
    buf = [0.0] * int(length * SR)
    for offset, samples in parts:
        o = int(offset * SR)
        for i, s in enumerate(samples):
            if o + i < len(buf):
                buf[o + i] += s
    return buf


def gunshot(power, name):
    crack = noise_burst(0.08 * power, 1.0, 12000, 2500, curve=1.4)
    body = noise_burst(0.5 * power, 0.75, 3000, 120)
    thump = sweep(0.2 * power, 0.9, 95 + 30 / power, 38)
    tail = noise_burst(0.9 * power, 0.14, 900, 70, attack=0.03)
    tail2 = noise_burst(0.7 * power, 0.08, 700, 60, attack=0.03)
    write(name, mix(1.4 * power, (0, crack), (0, body), (0, thump), (0.09, tail), (0.23, tail2)))


def click(name, pitch=1.0, dur=0.05):
    n = int(dur * SR)
    out, ph = [], 0.0
    for i in range(n):
        t = i / n
        ph += 2 * math.pi * (1800 * pitch * (0.25 ** t)) / SR
        out.append((1 if math.sin(ph) > 0 else -1) * 0.25 * math.exp(-t * 9))
    write(name, mix(dur + 0.05, (0, out), (0, noise_burst(0.04, 0.4, 7000, 2000))))


gunshot(1.25, "m4_shot.wav")
gunshot(1.0, "pistol_shot.wav")
gunshot(1.8, "sniper_shot.wav")
click("dry_fire.wav", 0.7)
click("mag_out.wav", 0.8, 0.08)
click("mag_in.wav", 1.2, 0.08)
click("bolt.wav", 0.6, 0.12)
write("impact.wav", noise_burst(0.12, 0.6, 6000, 500, curve=1.6))
write("flesh.wav", mix(0.15, (0, noise_burst(0.1, 0.6, 1400, 200)), (0, sweep(0.1, 0.5, 90, 40))))
write("footstep.wav", noise_burst(0.12, 0.5, 1800, 150, attack=0.004, curve=1.5))
write("whiz.wav", [s * math.sin(math.pi * i / (0.25 * SR)) for i, s in enumerate(noise_burst(0.25, 0.5, 4000, 900, attack=0.06))])
write("hitmarker.wav", [math.sin(2 * math.pi * 1250 * i / SR) * math.exp(-i / (0.02 * SR)) * 0.4 for i in range(int(0.07 * SR))])
print("sounds written to", os.path.normpath(OUT))


# ---- weapon handling (appended; the seeded RNG keeps the sounds above unchanged)

def tick(pitch, dur, gain=0.25):
    n = int(dur * SR)
    out, ph = [], 0.0
    for i in range(n):
        t = i / n
        ph += 2 * math.pi * (1800 * pitch * (0.25 ** t)) / SR
        out.append((1 if math.sin(ph) > 0 else -1) * gain * math.exp(-t * 9))
    return out


def metal(dur, gain, f0, f1, curve=1.0):
    return noise_burst(dur, gain, f0, f1, attack=0.0005, curve=curve)


# Charging handle: spring-loaded rattle back, then a hard slam forward
write("charge_back.wav", mix(0.2, (0, metal(0.09, 0.5, 5000, 1500)), (0.02, tick(0.55, 0.06, 0.15)), (0.07, metal(0.06, 0.3, 3000, 900))))
write("charge_fwd.wav", mix(0.25, (0, metal(0.05, 1.0, 9000, 2500, 1.6)), (0, tick(0.45, 0.08, 0.3)), (0.012, sweep(0.08, 0.35, 260, 120))))
# Pistol slide release / rack
write("slide.wav", mix(0.22, (0, metal(0.05, 0.6, 7000, 1800)), (0.06, metal(0.05, 0.9, 9000, 2500, 1.5)), (0.06, tick(0.7, 0.06, 0.25))))
# Empty magazine hitting the ground
write("mag_drop.wav", mix(0.3, (0, metal(0.12, 0.6, 2500, 300, 1.4)), (0, sweep(0.12, 0.4, 180, 70)), (0.11, metal(0.06, 0.2, 2000, 300))))
# Single round pushed into a magazine/receiver
write("round_in.wav", mix(0.12, (0, tick(1.5, 0.04, 0.2)), (0, metal(0.04, 0.35, 8000, 3000))))
# Cloth/gear swish for holster and draw
write("holster.wav", noise_burst(0.28, 0.35, 900, 2800, attack=0.08, curve=1.2))
