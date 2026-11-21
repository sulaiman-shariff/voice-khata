# Task 8 report: attention (server)

Added: shared/wake.ts (spotWake, isSleepWord), server/attention.ts (Attention), protocol messages (wake, hold_end, sleep; attention), api/voice.ts validation, session.ts gating (gate(), sleepNow(), hello/onClient/onFinal/dispatchFinal wiring).

Behaviour: new socket starts asleep (awake if resumed state has an open question); `attention` sent after every hello and on each change; typed text/taps/answers always handled (and touch the window); spoken finals gated; asleep + spotWake -> wake and handle rest (bare -> awakeHello); asleep while speaking -> dropped; sleep word / `sleep` msg -> sleep at once; phone wake needs wake word in first transcript else silent sleep; hold until hold_end; ptt_start wakes (deliberate).

Notes: merged main into the worktree first (needed awakeHello/LedgerCore). Existing onFinal tests now send a tap wake first. Test harness has no SNR so clear entries are confirmed; new tests tap yes.
