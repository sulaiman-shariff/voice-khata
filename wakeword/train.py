"""Train the KhataBhai model: LiveKit's synthetic set + our Gnani Timbre renders.

Run from wakeword/ after `livekit-wakeword setup` (see README.md):
    .venv/Scripts/python.exe train.py

Gnani clips in data/pos (positives) and data/neg (+ data/shop, if present: Task 12 shop-noise
negatives, 16 kHz s16le mono .pcm) are packed into a clip-set cache that LiveKit's trainer reads
like any other dataset. Positives whose file name has speed `1.2` are held out for check.py.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SR = 16000
POS_REPEAT = 4  # the base set has ~1000 positives; weight our 42 train clips up a little
HOLDOUT_TAG = "_1.2_"


def span(x: np.ndarray) -> tuple[int, int]:
    """Speech onset/offset by short-window energy, with a 50 ms margin."""
    f = x.astype(np.float32)
    win = 320
    n = len(f) // win
    e = np.sqrt((f[: n * win].reshape(n, win) ** 2).mean(1)) if n else np.zeros(1)
    idx = np.where(e > max(150.0, e.max() * 0.04))[0]
    if not len(idx):
        return 0, len(x)
    return max(0, idx[0] * win - 800), min(len(x), (idx[-1] + 1) * win + 800)


def pack(clips: list[np.ndarray], spans: list[tuple[int, int]]):
    if not clips:
        return [np.zeros(0, np.int16), np.zeros(0, np.int64), np.zeros(0, np.int64), np.zeros(0, np.int64), np.zeros(0, np.int64)]
    lengths = np.array([len(c) for c in clips], np.int64)
    offsets = np.concatenate([[0], np.cumsum(lengths)[:-1]]).astype(np.int64)
    return [
        np.concatenate(clips).astype(np.int16),
        offsets,
        lengths,
        np.array([s for s, _ in spans], np.int64),
        np.array([e for _, e in spans], np.int64),
    ]


def build_extra_dataset() -> str:
    from livekit.wakeword_train import data as D

    d = HERE / "data" / "gnani_ds"
    d.mkdir(parents=True, exist_ok=True)
    pos, neg = [], []
    for f in sorted((HERE / "data" / "pos").glob("*.pcm")):
        if HOLDOUT_TAG in f.name:
            continue
        pos.append(np.fromfile(f, np.int16))
    for sub in ("neg", "shop"):
        for f in sorted((HERE / "data" / sub).glob("*.pcm")):
            if sub == "neg" and HOLDOUT_TAG in f.name:
                continue
            neg.append(np.fromfile(f, np.int16))
    pos = pos * POS_REPEAT
    sets = {
        "positive": pack(pos, [span(c) for c in pos]),
        "adversarial": pack(neg, [span(c) for c in neg]),
        "speech": pack([], []),
    }
    cdir = D.CACHE / "clipsets" / str(d).strip("/").replace("/", "_")
    for cat, arrs in sets.items():
        (cdir / cat).mkdir(parents=True, exist_ok=True)
        for k, a in zip(D._KEYS, arrs):
            np.save(cdir / cat / f"{k}.npy", a)
    print(f"gnani extra: {len(pos)} positive clips (x{POS_REPEAT} repeat), {len(neg)} negatives")
    return str(d)


def main() -> None:
    os.chdir(HERE)
    from livekit.wakeword_train import pipeline
    from livekit.wakeword_train.config import load_config

    extra = build_extra_dataset()
    orig = pipeline.train_datasets
    pipeline.train_datasets = lambda cfg: [*orig(cfg), extra]
    cfg = load_config("khatabhai.yaml")
    steps = int(sys.argv[1]) if len(sys.argv) > 1 else cfg.steps
    cfg.steps = steps
    print("model:", pipeline.run_train(cfg, type="standard"))


if __name__ == "__main__":
    main()
