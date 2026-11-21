# Task 9 report

## Original implementation (db8f4ec)
- shared/protocol.ts: ClientMsg wake / hold_end, ServerMsg attention.
- contracts.ts / voice.ts: VoiceStatus 'asleep'; awake flag with optimistic wake; `attention` handled; socket-only start (`mic:false`) with attachMic() on first wake; setLang re-hellos on a fresh socket.
- MicButton (tap / 350 ms hold), App (chimes, single offline pill, language change keeps session, typed text without mic), feedback chimes, strings in 5 languages, voice.test.ts (2 tests).

## Fix round 1
Changes:
1. `sleep` message added to ClientMsg (R1); `VoiceClient.sleep()` sends it and shows asleep. After any socket swap (proactiveReconnect) and after reconnect the client calls setAwake(false, quiet) until the server's `attention` says otherwise.
2. Reply caption now clears when speaking ends (status leaves 'speaking': drained, stop_audio, barge-in) or at the next partial/final; a silent turn clears it on turn_done. A normal heard line clears on turn_done; a not_entry line stays 3 s (or until the next partial/final).
3. Hold race: App tracks `held`; a hold that starts the session relies on start()'s own tap wake (no wake('hold') after start, so never two wakes); pttDown only if still held. voice.ts also guards: holdEnd sends nothing unless a hold wake was sent; a second hold wake for one press is dropped.
4. Offline: status text shows t.offline, and the button is dim and not pressed (the footer pill remains the one indicator).
5. Keyboard PTT restored (keydown = hold start, keyup = hold end in push-to-talk mode).
6. A text-only session (no mic opened) shows tap-to-talk instead of "Say KhataBhai" (`micReady` state).
7. attachMic failure: sends sleep, reverts to asleep, fires new `VoiceEvents.micError`, App shows the micError toast and clears micReady.
8. Reconnect resets are quiet: no `attention` event, so no chime; chimes only for server attention changes or user taps.

Covering tests (src/lib/voice.test.ts, 5 total): 'tap while asleep sends wake{source:tap}', 'tap while awake sends sleep and shows asleep', 'a hold released before it started sends no hold_end, and a hold wakes once', 'a reconnect resets to asleep without a chime event', 'hold sends wake{hold} then hold_end'. Tests stub a minimal mic and AudioContext.

Command: `npx vitest run src/lib` then `npx tsc -b`
Output: Test Files 5 passed (5), Tests 43 passed (43); tsc exit 0.

Not covered by tests (UI, not browser-rechecked this round): caption timing, keyboard PTT, offline look, micReady text.
