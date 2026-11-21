"""Score the exported ONNX over held-out Gnani positives (speed 1.2) and non-wake clips.

    .venv/Scripts/python.exe check.py [../public/wakeword/khatabhai.onnx] [threshold]

Mirrors the official JS client: 1280-sample (80 ms) float32 chunks, stateful, 25 silent warm-up
frames, per-clip score = max over steps.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

HERE = Path(__file__).resolve().parent
FRAME = 1280


def clip_score(sess: ort.InferenceSession, pcm: np.ndarray) -> float:
    state = {i.name: np.zeros(i.shape, np.int64 if i.type == "tensor(int64)" else np.float32)
             for i in sess.get_inputs() if i.name != "chunk"}
    outs = [o.name for o in sess.get_outputs()]

    def step(chunk: np.ndarray) -> float:
        nonlocal state
        r = dict(zip(outs, sess.run(None, {"chunk": chunk[None].astype(np.float32), **state})))
        state = {k[:-4]: v for k, v in r.items() if k != "score"}
        return float(np.asarray(r["score"]).reshape(-1)[0])

    for _ in range(25):
        step(np.zeros(FRAME, np.float32))
    x = pcm.astype(np.float32) / 32768
    x = np.concatenate([np.zeros(FRAME * 3, np.float32), x, np.zeros(FRAME * 8, np.float32)])
    x = x[: len(x) // FRAME * FRAME]
    return max(step(x[i : i + FRAME]) for i in range(0, len(x), FRAME))


def main() -> None:
    model = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "public/wakeword/khatabhai.onnx"
    thr = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
    sess = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
    print("inputs :", [(i.name, i.shape, i.type) for i in sess.get_inputs()][:4], "...")
    print("outputs:", [o.name for o in sess.get_outputs()][:4], "...")
    rng = np.random.default_rng(0)
    groups = {
        "held-out positives (speed 1.2)": sorted((HERE / "data/pos").glob("*_1.2_*.pcm")),
        "train positives (speed 0.8/1.0)": [f for f in sorted((HERE / "data/pos").glob("*.pcm")) if "_1.2_" not in f.name],
        "non-wake speech (Gnani)": sorted((HERE / "data/neg").glob("*.pcm")),
        "shop-noise negatives": sorted((HERE / "data/shop").glob("*.pcm"))[:60],
    }
    for name, files in groups.items():
        if not files:
            continue
        s = np.array([clip_score(sess, np.fromfile(f, np.int16)) for f in files])
        pos = "positive" in name
        hit = (s >= thr).mean() if pos else (s >= thr).mean()
        print(f"{name:42s} n={len(s):3d} min={s.min():.3f} mean={s.mean():.3f} max={s.max():.3f} "
              f"{'recall' if pos else 'false-wake rate'}@{thr}={hit:.2%}")
    noise = {"silence": np.zeros(SR := 16000 * 5, np.int16),
             "white noise": (rng.normal(0, 2000, SR)).astype(np.int16)}
    for k, v in noise.items():
        print(f"{k:42s} score={clip_score(sess, v):.4f}")


if __name__ == "__main__":
    main()
