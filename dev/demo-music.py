# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""The demo video's background music, made here rather than licensed.

A calm, bright loop for a product tour: four chords (A minor, F, C, G) at
96 beats a minute, a soft pad, a bass, a plucked arpeggio with an echo and,
after the first bars, a light kick and hi-hat. It is synthesised from sine,
triangle and noise, so nobody else's recording is in it and it can go up
anywhere. Deterministic: the same length gives the same file.

    uv run dev/demo-music.py OUT.wav SECONDS

dev/demo-video.mjs runs this for the narrated version and mixes it under
the voice, ducked while the narrator speaks.
"""
import sys
import wave

import numpy as np

RATE = 44100
BPM = 96
BEAT = 60 / BPM
BAR = 4 * BEAT
CHORDS = [  # MIDI notes: root for the bass, then the chord
    (45, [57, 60, 64, 69]),  # A minor
    (41, [53, 57, 60, 65]),  # F
    (48, [55, 60, 64, 67]),  # C
    (43, [55, 59, 62, 67]),  # G
]


def hz(note):
    return 440.0 * 2 ** ((note - 69) / 12)


def envelope(n, attack, release, sustain=1.0):
    env = np.full(n, sustain)
    a = min(n, int(attack * RATE))
    r = min(n - a, int(release * RATE))
    if a:
        env[:a] = np.linspace(0, sustain, a)
    if r:
        env[n - r:] = np.linspace(sustain, 0, r)
    return env


def lowpass(x, cutoff):
    """A one-pole low-pass, enough to take the edge off the pad."""
    k = np.exp(-2 * np.pi * cutoff / RATE)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - k) * v + k * acc
        y[i] = acc
    return y


def add(track, start, sound):
    i = int(start * RATE)
    if i >= len(track):
        return
    sound = sound[: len(track) - i]
    track[i : i + len(sound)] += sound


def main(out, seconds):
    n = int(seconds * RATE)
    t_bar = np.arange(int(BAR * RATE)) / RATE
    pad = np.zeros(n)
    bass = np.zeros(n)
    arp = np.zeros(n)
    drums = np.zeros(n)
    rng = np.random.default_rng(7)
    bars = int(np.ceil(seconds / BAR))
    drums_from, drums_to = 2, bars - 3

    for b in range(bars):
        start = b * BAR
        root, chord = CHORDS[b % len(CHORDS)]
        # Pad: each chord note as a few detuned sines with soft harmonics.
        tone = np.zeros(len(t_bar))
        for note in chord:
            for detune in (-0.12, 0.0, 0.12):
                f = hz(note + detune)
                tone += np.sin(2 * np.pi * f * t_bar) + 0.25 * np.sin(4 * np.pi * f * t_bar)
        pad_env = envelope(len(t_bar), 0.6, 0.7)
        add(pad, start, tone * pad_env / (len(chord) * 3))
        # Bass: the root on beats one and three, a sine with a little drive.
        for beat in (0, 2):
            m = int(1.6 * BEAT * RATE)
            tb = np.arange(m) / RATE
            note = np.tanh(1.6 * np.sin(2 * np.pi * hz(root) * tb)) * np.exp(-tb * 1.4)
            add(bass, start + beat * BEAT, note * envelope(m, 0.01, 0.2))
        # Arpeggio: sixteenths up and down the chord, an octave up, plucked.
        pattern = [0, 1, 2, 3, 2, 1, 2, 3] * 2
        for s, idx in enumerate(pattern):
            m = int(0.5 * RATE)
            tb = np.arange(m) / RATE
            f = hz(chord[idx] + 12)
            tri = 2 / np.pi * np.arcsin(np.sin(2 * np.pi * f * tb))
            add(arp, start + s * BEAT / 4, tri * np.exp(-tb * 9) * (0.9 if s % 4 == 0 else 0.6))
        # Drums after the first bars: a soft kick on the beat, a hi-hat between.
        if drums_from <= b < drums_to:
            for beat in range(4):
                m = int(0.35 * RATE)
                tb = np.arange(m) / RATE
                f = 50 + 70 * np.exp(-tb * 30)
                kick = np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-tb * 9)
                add(drums, start + beat * BEAT, kick * 0.9)
                m2 = int(0.06 * RATE)
                hat = rng.standard_normal(m2)
                hat = np.diff(hat, prepend=0) * np.exp(-np.arange(m2) / RATE * 70)
                add(drums, start + (beat + 0.5) * BEAT, hat * 0.05)

    pad = lowpass(pad, 1800)
    # The arpeggio's echo: three dotted-eighth repeats, panned.
    delay = int(0.75 * BEAT * RATE)
    left, right = arp.copy(), arp.copy()
    for k, gain in enumerate((0.45, 0.3, 0.18), start=1):
        target = left if k % 2 else right
        target[k * delay :] += arp[: n - k * delay] * gain

    mix_l = 0.55 * pad + 0.5 * bass + 0.32 * left + 0.5 * drums
    mix_r = 0.55 * pad + 0.5 * bass + 0.32 * right + 0.5 * drums
    stereo = np.stack([mix_l, mix_r], axis=1)
    fade = envelope(n, 2.5, 5.0)
    stereo *= fade[:, None]
    stereo /= np.max(np.abs(stereo)) / 0.89  # about -1 dBFS
    data = (stereo * 32767).astype("<i2")
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data.tobytes())


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]))
