"""Noise robustness test for Prisma v3.0 on khata utterances.

Synthesises test lines with Timbre v3.0 stock voices (no cloning), mixes real background
noise at fixed SNRs, streams each mix to Prisma v3.0 in real time (same headers as the
production proxy) and scores exact amount match.

Noise sources (licenses recorded in eval/NOISE_SOURCES.md):
  - DEMAND (Thiemann et al., CC BY 4.0): STRAFFIC, PCAFETER, SPSQUARE, channel 1
  - Indic babble: 4 overlapped IndicVoices Hindi speakers (AI4Bharat, CC BY 4.0)

Usage: python eval/noise_test.py [--snr 15 10 5 0] [--concurrency 4] [--limit N]
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import math
import random
import re
import time
import zipfile
from pathlib import Path

import numpy as np
import soundfile as sf
import websockets

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RESULTS = ROOT / "results"
SR = 16000
FRAME = 1024  # bytes = 512 samples = 32 ms, exactly as Prisma requires

# ---------------------------------------------------------------- test set
# (id, stt_lang, tts_lang, text, expected amounts)
UTTERANCES = [
    ("u01", "hi-IN", "hi-IN", "रमेश का तीन सौ चालीस रुपये उधार लिख दो", [340]),
    ("u02", "hi-IN", "hi-IN", "सुरेश ने साठ रुपये जमा किए", [60]),
    ("u03", "hi-IN", "hi-IN", "गीता का सात रुपये बाकी है", [7]),
    ("u04", "hi-IN", "hi-IN", "मोहन का पौने दो सौ उधार", [175]),
    ("u05", "hi-IN", "hi-IN", "अनिल ने डेढ़ सौ दिए", [150]),
    ("u06", "hi-IN", "hi-IN", "प्रिया का सत्तर रुपये उधार लिख लो", [70]),
    ("u07", "hi-IN", "hi-IN", "रवि का सत्रह रुपये बाकी", [17]),
    ("u08", "en-IN", "en-IN", "Sunita took fifteen hundred rupees on credit", [1500]),
    ("u09", "hi-IN", "hi-IN", "दीपक ने दो सौ साठ रुपये दिए", [260]),
    ("u10", "hi-IN", "hi-IN", "विमला का एक हज़ार आठ सौ सत्तर उधार", [1870]),
    ("u11", "kn-IN", "kn-IN", "ಲಕ್ಷ್ಮಿ ಎರಡು ಸಾವಿರದ ಐನೂರು ರೂಪಾಯಿ ಕೊಟ್ಟರು", [2500]),
    ("u12", "hi-IN", "hi-IN", "हरि का साढ़े तीन सौ बाकी", [350]),
]
VOICES = ["Avinash", "Lakshmi", "Prakash", "Riyaa"]  # stock Timbre v3 voices; agent uses Shivani

# ------------------------------------------------- minimal number reader (scoring only)
# The production parser is shared/numbers.ts; this just reads amounts back out of transcripts.
HI_UNITS = {
    "शून्य": 0, "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "छः": 6, "सात": 7,
    "आठ": 8, "नौ": 9, "दस": 10, "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14, "पंद्रह": 15,
    "पन्द्रह": 15, "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19, "बीस": 20, "तीस": 30,
    "चालीस": 40, "पचास": 50, "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90, "पच्चीस": 25,
}
HI_SCALE = {"सौ": 100, "हज़ार": 1000, "हजार": 1000, "लाख": 100000}
EN = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30,
    "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
EN_SCALE = {"hundred": 100, "thousand": 1000, "lakh": 100000}
KN = {"ಐನೂರು": 500, "ಎರಡು": 2, "ಸಾವಿರ": 1000, "ಸಾವಿರದ": 1000}
FRAC = {"डेढ़": 1.5, "ढाई": 2.5}


def read_amounts(text: str) -> list[int]:
    import unicodedata
    t = unicodedata.normalize("NFC", text).replace(",", "")
    nums: list[int] = [int(x) for x in re.findall(r"\d+", t)]
    toks = re.findall(r"[\wऀ-ൿ]+", t.lower())
    total = cur = 0.0
    pending_frac = None  # ("+", .5) saadhe / ("-", .25) paune
    in_num = False
    for w in toks:
        if w in ("साढ़े", "साढे"):
            pending_frac, in_num = 0.5, True
            continue
        if w == "पौने":
            pending_frac, in_num = -0.25, True
            continue
        if w in FRAC:
            cur, in_num = FRAC[w], True
            continue
        v = HI_UNITS.get(w, EN.get(w, KN.get(w) if KN.get(w, 0) < 100 else None))
        s = HI_SCALE.get(w, EN_SCALE.get(w, 1000 if w in ("ಸಾವಿರ", "ಸಾವಿರದ") else None))
        if w == "ಐನೂರು":
            cur += 500
            in_num = True
        elif v is not None:
            cur += v
            in_num = True
        elif s is not None and in_num:
            base = cur if cur else 1
            if pending_frac is not None:
                base += pending_frac
                pending_frac = None
            if s >= 1000:
                total += base * s
                cur = 0
            else:
                cur = base * s
        elif in_num:
            nums.append(int(round(total + cur)))
            total = cur = 0
            in_num = False
    if in_num:
        nums.append(int(round(total + cur)))
    return nums


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


# ------------------------------------------------------------------ audio io
def key() -> str:
    env = ROOT.parent / ".env"
    return [l.split("=", 1)[1].strip() for l in env.read_text().splitlines() if l.startswith("GNANI_API_KEY=")][0]


async def synth(text: str, lang: str, voice: str) -> np.ndarray:
    cache = DATA / "speech" / f"{voice}_{abs(hash((text, lang))) % 10**10}.npy"
    if cache.exists():
        return np.load(cache)
    async with websockets.connect("wss://api.vachana.ai/api/v1/tts", additional_headers={"X-API-Key-ID": key()}) as ws:
        await ws.send(json.dumps({"text": text, "voice": voice, "model": "timbre-v3.0", "language": lang,
                                  "audio_config": {"sample_rate": SR, "num_channels": 1, "sample_width": 2,
                                                   "encoding": "linear_pcm", "container": "raw"}}))
        pcm = b""
        while True:
            m = json.loads(await ws.recv())
            if m["type"] == "audio":
                pcm += base64.b64decode(m["data"]["audio"])
            elif m["type"] in ("complete", "error"):
                break
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.save(cache, x)
    return x


def load_demand(name: str) -> np.ndarray:
    z = zipfile.ZipFile(DATA / "noise" / "demand" / f"{name}_16k.zip")
    member = next(n for n in z.namelist() if n.endswith("ch01.wav"))
    x, sr = sf.read(io.BytesIO(z.read(member)), dtype="float32")
    assert sr == SR, sr
    return x


def load_babble(seconds: float = 300, talkers: int = 4) -> np.ndarray:
    import pyarrow.parquet as pq

    cache = DATA / "noise" / "indic_babble.npy"
    if cache.exists():
        return np.load(cache)
    pf = pq.ParquetFile(DATA / "indicvoices" / "hindi_valid.parquet")
    rng = random.Random(7)
    clips: list[np.ndarray] = []
    for b in pf.iter_batches(batch_size=64, columns=["audio_filepath"]):
        for row in b.to_pylist():
            a = row["audio_filepath"]
            x, sr = sf.read(io.BytesIO(a["bytes"]), dtype="float32")
            if x.ndim > 1:
                x = x.mean(axis=1)
            if sr != SR:
                x = np.interp(np.arange(0, len(x), sr / SR), np.arange(len(x)), x).astype(np.float32)
            clips.append(x / (np.sqrt(np.mean(x**2)) + 1e-9))
        if sum(len(c) for c in clips) > seconds * SR * talkers * 1.2:
            break
    n = int(seconds * SR)
    out = np.zeros(n, dtype=np.float32)
    for _ in range(talkers):
        track = np.concatenate(rng.sample(clips, len(clips)))[:n]
        out[: len(track)] += track
    out /= np.max(np.abs(out)) + 1e-9
    np.save(cache, out)
    return out


def mix(speech: np.ndarray, noise: np.ndarray, snr_db: float | None, rng: random.Random) -> np.ndarray:
    lead = np.zeros(int(0.4 * SR), dtype=np.float32)
    tail = np.zeros(int(1.0 * SR), dtype=np.float32)
    s = np.concatenate([lead, speech, tail])
    if snr_db is None:
        return s
    start = rng.randrange(0, len(noise) - len(s))
    nz = noise[start : start + len(s)]
    ps = np.mean(speech**2)
    pn = np.mean(nz**2) + 1e-12
    nz = nz * math.sqrt(ps / (pn * 10 ** (snr_db / 10)))
    y = s + nz
    peak = np.max(np.abs(y))
    return y / peak * 0.95 if peak > 0.99 else y


async def stt(audio: np.ndarray, lang: str) -> tuple[str, float | None]:
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes()
    pcm += b"\0" * (-len(pcm) % FRAME)
    hdr = {"x-api-key-id": key(), "model": "prisma-v3.0", "language_code": lang, "format": "transcribe",
           "x-sample-rate": str(SR), "x-partials": "true"}
    texts: list[str] = []
    async with websockets.connect("wss://api.vachana.ai/stt/v3/stream", additional_headers=hdr) as ws:
        await ws.recv()  # connected
        start = time.perf_counter()

        async def send():
            for n, i in enumerate(range(0, len(pcm), FRAME)):
                d = start + n * 0.032 - time.perf_counter()  # absolute clock: no drift
                if d > 0:
                    await asyncio.sleep(d)
                await ws.send(pcm[i : i + FRAME])
            await ws.send(json.dumps({"type": "commit"}))

        st = asyncio.create_task(send())
        try:
            while True:
                m = json.loads(await asyncio.wait_for(ws.recv(), 6))
                if m["type"] in ("final_transcript", "transcript") and m.get("text"):
                    texts.append(m["text"])
        except (asyncio.TimeoutError, websockets.ConnectionClosed):
            pass
        st.cancel()
    return " ".join(texts), None


# ---------------------------------------------------------------------- main
async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snr", type=float, nargs="+", default=[15, 10, 5, 0])
    ap.add_argument("--noises", nargs="+", default=["STRAFFIC", "PCAFETER", "SPSQUARE", "BABBLE"])
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--limit", type=int, default=len(UTTERANCES))
    args = ap.parse_args()

    utts = UTTERANCES[: args.limit]
    speech = {}
    for i, (uid, _sl, tl, text, _exp) in enumerate(utts):
        speech[uid] = await synth(text, tl, VOICES[i % len(VOICES)])
    noises = {n: (load_babble() if n == "BABBLE" else load_demand(n)) for n in args.noises}

    rng = random.Random(42)
    jobs = [(uid, sl, exp, "clean", None) for uid, sl, _tl, _t, exp in utts]
    jobs += [(uid, sl, exp, n, snr) for n in args.noises for snr in args.snr for uid, sl, _tl, _t, exp in utts]
    mixes = {(j[0], j[3], j[4]): mix(speech[j[0]], noises.get(j[3], np.zeros(1)), j[4], rng) for j in jobs}

    sem = asyncio.Semaphore(args.concurrency)
    rows = []

    async def run(job):
        uid, lang, exp, noise, snr = job
        async with sem:
            for attempt in range(3):
                try:
                    text, _ = await stt(mixes[(uid, noise, snr)], lang)
                    break
                except Exception as e:  # transient connect errors / rate limit
                    text = f"<error {e}>"
                    await asyncio.sleep(2 + attempt * 3)
        got = read_amounts(text)
        ok = all(a in got for a in exp)
        rows.append({"id": uid, "noise": noise, "snr": snr, "expected": exp, "got": got, "ok": ok, "text": text})
        print(f"{'OK ' if ok else 'BAD'} {uid} {noise:9s} {str(snr):5s} exp={exp} got={got} | {text}", flush=True)

    t0 = time.time()
    await asyncio.gather(*(run(j) for j in jobs))
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / f"noise_{time.strftime('%Y%m%d_%H%M%S')}.json"
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n{len(rows)} streams in {time.time() - t0:.0f}s -> {out.name}")
    print(f"{'condition':22s} {'acc':>6s}  95% CI")
    groups: dict[str, list[bool]] = {}
    for r in rows:
        groups.setdefault("clean" if r["noise"] == "clean" else f"{r['noise']} @{r['snr']:g}dB", []).append(r["ok"])
        if r["noise"] != "clean":
            groups.setdefault(f"ALL NOISE @{r['snr']:g}dB", []).append(r["ok"])
    for g, v in sorted(groups.items()):
        lo, hi = wilson(sum(v), len(v))
        print(f"{g:22s} {sum(v)/len(v):6.0%}  [{lo:.0%}, {hi:.0%}]  n={len(v)}")


if __name__ == "__main__":
    asyncio.run(main())
