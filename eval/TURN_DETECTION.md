# End-of-turn detection: why we don't use Smart Turn v3

We planned to use [Smart Turn v3.2](https://huggingface.co/pipecat-ai/smart-turn-v3) (pipecat-ai, BSD-2-Clause)
as an audio end-of-turn model, and measured it before adopting it (2026-11-13).

Setup: 37 khata utterances (Gnani Timbre stock voices, Hindi/English/Kannada), leading/trailing
silence trimmed, then a 200 ms pause appended (what the agent sees in real use). "Cut" = the same
clip truncated at a random 35-70% point (an unfinished sentence).

| Model | Complete -> "done" | Cut -> "not done" | Accuracy |
|---|---|---|---|
| v3.2 int8 (8.7 MB) | 34/37 | 19/37 | 72% |
| v3.2 fp32 (32 MB) | 20/37 | 27/37 | 64% |

Our TypeScript Whisper log-mel port matched `transformers.WhisperFeatureExtractor` to within 1e-3, and
fp32 outputs matched Python onnxruntime exactly, so these numbers are the model's, not the port's.
Inference on Vercel's WASM runtime took 300-800 ms per call, longer than the 500 ms silence it would save.

Decision: end of turn is decided from the streaming transcript instead (`server/turn/`): a complete khata
sentence (name + amount + closing verb/marker) triggers Prisma's `commit` at once; anything else waits for
Prisma's own voice-activity silence.
