"""Convert the existing noise sources to raw 16 kHz s16le mono files for eval/e2e_suite.ts.
No new downloads: reads the DEMAND zips and the cached Indic babble from eval/data/noise.
Sources and licenses: eval/NOISE_SOURCES.md."""
import io, zipfile
from pathlib import Path
import numpy as np, soundfile as sf

N = Path(__file__).resolve().parent / "data" / "noise"
def save(name, x):
    x = np.asarray(x, dtype=np.float32)
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.9
    (N / f"{name}.pcm").write_bytes((x * 32767).astype("<i2").tobytes())
    print(name, len(x) / 16000, "s")

for name, z in [("street", "STRAFFIC"), ("cafeteria", "PCAFETER"), ("square", "SPSQUARE")]:
    zf = zipfile.ZipFile(N / "demand" / f"{z}_16k.zip")
    m = next(n for n in zf.namelist() if n.endswith("ch01.wav"))
    x, sr = sf.read(io.BytesIO(zf.read(m)), dtype="float32"); assert sr == 16000
    save(name, x)
save("babble", np.load(N / "indic_babble.npy"))
