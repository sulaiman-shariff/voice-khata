# KhataBhai wake word (LiveKit WakeWord)

Output: `public/wakeword/khatabhai.onnx` (7.4 MB, standard streaming model, Apache-2.0 toolchain).

## Runtime contract (for the on-phone detector)
- Runtime: onnxruntime-web (or `@livekit/wakeword` client, `WakeWordModel`), model name `khatabhai`.
- Audio: mono, 16 kHz. Feed float32 in [-1, 1] (int16 / 32768).
- Step: exactly 1280 samples (80 ms) per call; no overlap. No features to compute, the mel front end is inside the model.
- Inputs: `chunk` float32 `[1,1280]`, plus state tensors (`audio` [1,352], `sub0`, `sub1`, ... all fixed shape, initialise to zeros). Outputs: `score` (float, 0..1) plus `<state>_out` for every state input; feed each `X_out` back as input `X` on the next step.
- Warm-up: run 25 frames of silence (2 s) through a fresh state before real audio; the result is the state every stream starts from (save it to reset after a detection).
- Score: per-step wake probability; the model is calibrated so 0.5 is about 0.5 false alarms per hour on speech/noise. Recommended threshold 0.5 (the default); use a 2 s debounce (reset state after a fire). Raise to 0.6-0.7 if the shop is noisy.
- Reference implementation: livekit-wakeword `client/js/src/model.ts` (Stream class) and `wakeword/check.py` (Python mirror).

## Retrain
Needs: CUDA GPU (or Apple silicon), Python 3.13, uv, LiveKit Cloud creds (`LIVEKIT_URL/API_KEY/API_SECRET`), optionally `HF_TOKEN` (speeds HF downloads).
```bash
cd wakeword
uv venv --python 3.13 .venv
uv pip install --python .venv/Scripts/python.exe "livekit-wakeword[train]"
# Windows/NVIDIA Blackwell: CUDA torch is needed, PyPI gives CPU-only
uv pip install --python .venv/Scripts/python.exe torch --index-url https://download.pytorch.org/whl/cu128
export $(grep -E '^LIVEKIT_' ../.env | xargs) HF_TOKEN=... PYTHONUTF8=1
npx tsx --env-file=../.env render_gnani.ts      # run from repo root: extra Gnani Timbre positives/negatives -> data/
.venv/Scripts/livekit-wakeword.exe setup --config khatabhai.yaml --wakeword "Khata Bhai"   # LiveKit TTS speech (~20 min)
.venv/Scripts/python.exe train.py                # merges data/ clips, trains, calibrates, exports ../public/wakeword/khatabhai.onnx
.venv/Scripts/python.exe check.py                # scores held-out clips
```
`train.py` packs `data/pos` (Gnani positives, x4 repeat, files with `_1.2_` held out) and `data/neg` + optional `data/shop/*.pcm` (16 kHz s16le shop-noise negatives) as an extra dataset. Config: `khatabhai.yaml`.

## Gotchas hit on Windows
- `setup` without `--eval` still prepares all noise sources; the esc50 step finished writing 400 flacs then hung and the test-only sources (gtzan etc.) stalled on HF. Workaround: hand-write `.cache/lkwb/sources/esc50/manifest.jsonl` and empty manifests for gtzan, slr28_rir, treble10_rir, ami, earnings22, peoples_speech (test-only, not used for training).
- Calibration streams ~108 min of speech from HF before exporting; ~40 min on this connection (training itself ~12 min on RTX 5060).

## Results (first model)
Held-out Gnani positives (speed 1.2, 21 clips): scores 0.80-0.86, recall 100% at 0.5. Non-wake Gnani speech (36 clips): max 0.010. Silence 0.005, white noise 0.007. Not yet measured on Task 12 shop-noise set (second pass).
