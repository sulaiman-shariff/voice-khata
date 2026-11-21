# Task 12 part 1 report

Status: DONE (part 1 only). Branch: worktree-agent-afd9615e4312047c4. Commit b95480f.

Files: eval/synth/scenes.ts (40 scenes), make.ts, score.ts (scoreScene, callMatches, sumScores, runScenes stub throwing 'not yet wired (Task 12 part 2)'), score.test.ts (2 tests, red first then green).

Generated: 40 scenes, 9.0 minutes in C:/Users/sulai/OneDrive/Desktop/hackbriven/eval/data/synth (<scene>.pcm + .json with per-line startMs/endMs, snrDb, durationMs). TTS cache in eval/data/synth/tts_cache.

Tests: vitest eval/synth 2/2 pass. Full vitest: 449 pass, 3 suites fail to load (server/context, parse/llm, session tests) because @anthropic-ai/sdk is not installed in the worktree (pre-existing, unrelated). tsc -b clean.

Concerns:
- TtsPool.speak takes no voice argument (voice fixed per locale in tts.ts), so voice rotation was not possible without editing tts.ts; I rotated speed (0.8/1/1.2) per line instead. Same speaker per language.
- make.ts reads DATA from env SYNTH_DATA (default eval/data); run with SYNTH_DATA=<main repo>/eval/data from the worktree.
- Scoring interface: LineResult = {woke, calls}; a woke un-addressed line counts as a false wake, any add_entries entries from it count as unaddressed entries. Part 2 must produce LineResult per line.
- Tool arg shapes assumed (add_entries direction 'gave'|'got', names in Latin script); the later agent task must match or callMatches needs adjusting.
- No ASR verification of how "KhataBhai" in Devanagari/Kannada script is pronounced by TTS.
- The report is in the worktree copy of .superpowers (writing to the main checkout path was blocked).

## Fix round 1
- Directions now credit/payment (scenes.ts add helper type+default, multi-entry scenes, score.test.ts).
- Added s41-s44: chatter containing the real wake word (hi/en/kn/mixed), addressed:false, nothing may be written.
- Voice rotation: speed rotation accepted for now; follow-up: add a voice arg to TtsPool.speak.
- Regenerated: 44 scenes, 10.1 minutes (SYNTH_DATA=main eval/data npx tsx --env-file=main .env eval/synth/make.ts).
- npx vitest run eval/synth: 2/2 pass.
