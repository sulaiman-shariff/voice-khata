# KhataBhai v2 (wake-word voice agent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn KhataBhai into a voice agent you address on purpose: say "KhataBhai" or tap to wake it.
An awake window lasts ~15 s. A Gemini agent with a tool for every app action does the understanding,
behind a safety layer that never writes money on a guess.

**Architecture:**
- **Hearing:** Gnani Prisma stays the live listener: the app language + en/hi/kn in parallel
  (`server/gnani/multi.ts`).
- **Understanding:** an instant parser for plain entries; otherwise one Gemini 3.5 Flash-Lite call
  (Vertex, asia-south1) that returns tool calls, or `not_for_me`. Unclear moments are re-asked with
  the audio.
- **Safety:** every tool runs through the existing draft/confirm logic, moved out of
  `server/session.ts` into a ledger core.
- **Attention:** a small state machine (asleep / awake). An on-phone LiveKit wake-word model in a
  Web Worker; server-side transcript spotting as the check and the fallback.

**Tech Stack:**
- TypeScript;
- React + Vite PWA;
- Node `ws` on Vercel (bom1);
- Gnani Prisma/Timbre;
- Gemini on Vertex AI (REST, service-account JWT, `server/parse/gemini.ts`);
- onnxruntime-web;
- LiveKit WakeWord (training);
- vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-khatabhai-agent-design.md`

## Global Constraints

- **Wake word:** "KhataBhai". Tap-to-listen wakes the same way; holding the button keeps it awake
  while held.
- **Awake window:** sleeps 15 000 ms after the last reply or question; an open question holds it
  awake until answered or `PENDING_TTL_MS` (45 000). "bas" / "ho gaya" / "theek hai bas" sleep at
  once.
- **Listening set:** the app language + `en-IN`, `hi-IN`, `kn-IN` (`LISTEN_LANGS`). Streams are open
  only while awake when the on-phone detector works.
- **Agent model:** Gemini 3.5 Flash-Lite, Vertex `asia-south1`, project `sulaiman-projects`, env
  `GOOGLE_VERTEX_KEY` / `VERTEX_PROJECT` / `VERTEX_LOCATION`. 3 000 ms per call; warm-up 15 000 ms.
- **Audio re-ask:** total budget 2 500 ms. Then ask the shopkeeper.
- **Replies:** a full spoken sentence for every action, in the language spoken. A save always says
  the new balance ("Ramesh ka 300 udhaar likh diya. Ab Ramesh ka kul 640 baaki."). Use today's
  per-language Gnani voices (`VOICE_BY_LOCALE`).
- **Money text** comes from fixed templates (`shared/replies.ts`), never model free text.
- **Safety, never weaker than today.** Read back before writing on any of:
  - new customer;
  - credit/paid guessed;
  - name changed or near-match;
  - amount not literally heard;
  - confusable amount;
  - noisy room;
  - large or unusual amount;
  - amounts disagreeing between streams.

  A tapped card answer counts as the yes. Remove, move, merge, settle and erase always ask first.
  `erase_all` also needs a tap. Reminders only go to `remindersOptIn && adult` customers, and each
  send is confirmed.
- **Browser limits:** WhatsApp (`wa.me`) and backup (PIN) finish with one tap; voice prepares them.
- **Data:** the phone sends its whole ledger at session start. The server keeps it in memory only,
  never stored. Writes go to the phone as ops with seq/ack (unchanged).
- **Removed:**
  - Sarvam;
  - Prisma REST re-read / second reading / language rescue;
  - the Claude path (`@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`);
  - hold/join timers;
  - chatter gates (offTopic, strayWord, quietUnlessShort, askedEnough, chatter_over_number,
    unclear_over_guess, partialDraft, rescuable).
- **Anyone** who says the wake word or taps can use it (no speaker ID).
- **Test data is synthetic only** (Gnani Timbre voices + the noise in `eval/data/noise`).

## Review Focus

1. **The app's own reply contains "KhataBhai"** (e.g. a disclosure). It must not wake itself. Test:
   Task 8 `spotWake` is ignored while `speaking`, and Task 14's detector is paused during playback.
2. **"KhataBhai" in the middle of customer chatter**, followed by nothing for the ledger ("…bolo
   KhataBhai wale bhaiya ko"). Expect: it wakes, the agent returns `not_for_me`, nothing is
   written, and it sleeps after 15 s. Test in Task 8.
3. **A question is open when the window would expire.** Expect: it stays awake until answered or 45
   s, then sleeps and drops the question silently. Test in Task 8.
4. **The agent calls a write tool for a customer that exists twice** (two "Suresh"). Expect: the
   "which one" card, never a pick. Test in Task 4.
5. **Gemini down or slow** (token or 5xx or 3 s timeout) on an awake turn. Expect: a plain entry
   still saves via the instant path; anything else gets the spoken "didn't catch" in the turn's
   language, with no crash and no write. Test in Task 7.

---

### Task 1: Remove Sarvam, the Prisma re-read paths and Claude; tighten the name guard

**Files:**
- Delete:
  - `server/sarvam.ts`
  - `eval/stt_compare.ts`
  - `eval/llm_gemini.ts`
  - `eval/retranscribe.ts`
- Modify:
  - `server/session.ts`: drop `verify`, `VERIFY_WAIT_MS`, `fromVerifier`, `verified`, `verifyRead`,
    `confidentEntry`, `sameAmounts`, `restRead`, `secondReading`, `languageRescue`, `rescuable`,
    `RESCUE_WAIT_MS`, `SECOND_READ_WAIT_MS`, `transcribe2`/`secondReading` deps, `uttAudio` only
    if unused by Task 11 (keep it).
  - `api/voice.ts`
  - `server/parse/llm.ts`: delete the Claude path, `CLAUDE_MODEL`, `LLM_MODEL`, `llmProvider`;
    Gemini only.
  - `server/test-harness.ts`
  - `package.json`: remove `@anthropic-ai/sdk`.
  - `.env.example`: replace `ANTHROPIC_API_KEY` with the Vertex vars.
- Test:
  - `server/parse/llm.test.ts`
  - `server/session.test.ts`: delete the Sarvam / second-reading / rescue tests.

**Interfaces:**
- Produces:
  - `readWithLlm(transcript: string, ctx: LlmContext, signal?: AbortSignal): Promise<{ reading: Partial<LlmReading>; ms: number }>`
    (Gemini only; kept until Task 7 replaces its callers).
  - `llmModel(): string`.

- [ ] **Step 1: Write the failing test** in `server/parse/llm.test.ts`:
  `it('a name the model altered (Sunitu -> Sunita) is read back')`. Assert:
  `validate('Sunitu dobar 1,000 rupees on credit', entry('Sunita','credit'))` has reasons
  containing `'name-changed'`, and `validate('रमेश का 340 उधार', entry('Ramesh','credit'))` does
  not.
- [ ] **Step 2: Run** `npx vitest run server/parse/llm.test.ts`. Expected: FAIL on the Sunitu
  assertion.
- [ ] **Step 3: Change `saidName(name, transcript)`** in `server/parse/llm.ts`: a name counts as
  said only when some word of it has a `phoneticKey` (shared/names.ts) equal to a transcript
  word's key (or adjacent pair's). Then remove the listed code from all files above.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: all pass. Also
  `git grep -nE "sarvam|transcribe2|secondReading|languageRescue|Anthropic|ANTHROPIC" -- ':!docs'`
  prints nothing.
- [ ] **Step 5: Commit** `chore: remove Sarvam, Prisma re-read paths and Claude; stricter name guard`.

### Task 2: Whole-ledger snapshot

**Files:**
- Modify:
  - `shared/protocol.ts`: `Snapshot` gains `entries: SnapEntry[]` (all live entries, newest first,
    `voided` excluded); `SnapCustomer` gains `phone?: string`; remove `recent` (use `entries`).
  - `src/lib/store.ts` `snapshot()`.
  - `server/session.ts`: every `snap.recent` becomes `snap.entries`.
  - `eval/replay.ts`, `server/test-harness.ts`: build `entries`.
- Test: `src/lib/store.test.ts`, `server/session.test.ts`.

**Interfaces:**
- Produces: `Snapshot.entries: SnapEntry[]` and `SnapCustomer.phone?: string`, used by Tasks 4 and
  10.

- [ ] **Step 1: Failing test** `it('the snapshot carries every live entry and the phone')` in
  `src/lib/store.test.ts`. Add 25 entries and one consent event with `phone: '9876543210'`.
  Assert: `snapshot().entries.length === 25`, newest first; `customers[0].phone === '9876543210'`;
  a voided entry is absent.
- [ ] **Step 2: Run** `npx vitest run src/lib/store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `store.ts` `snapshot()`, and switch the server and test helpers from
  `recent` to `entries`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: phone sends its whole ledger at session start (memory only on the server)`.

### Task 3: Ledger core: move the safety layer out of session.ts

A pure move. Behaviour must not change; the existing session tests are the proof.

**Files:**
- Create: `server/ledger/core.ts`. Move from `server/session.ts`:
  - `Draft`, `Pending`, `Reply`;
  - `draftFrom`, `processDrafts`, `needsConfirm`, `opensAccount`, `ackable`, `save`,
    `resolveName`, `candidates`, `clearWinner`, `knownWithin`, `label`, `customerName`,
    `answerPending`, `answerBatch`, `modifyEntry`, `correctLast`, `settle`, `applyLocal`,
    `totals`, `pendingView`, `newCustomerName`, `titleCase`, `fillDirection`.
- Modify: `server/session.ts` (delegates to the core).
- Test: the existing `server/session.test.ts` (unchanged), plus a new `server/ledger/core.test.ts`.

**Interfaces:**
- Produces:
  - `class LedgerCore { constructor(deps: { lang: () => Lang; now: () => number; newId: () => string; log: Logger }) }`.
  - `snap: Snapshot`.
  - `pending: Pending | null`.
  - `focusCid: string | null`.
  - `turnSrc: 'voice' | 'tap' | 'resend'`.
  - `processDrafts(drafts: Draft[], acc?: Reply): Reply`.
  - `answerPending(text: string, intent: Intent, meta: TurnMeta): Reply | null`.
  - `modifyEntry(i)`, `correctLast(i)`, `settle(text, meta): Reply | null`.
  - `pendingView(): PendingView | null`.
  - `applyLocal(op: LedgerOp): void`.
  - `exportState()/importState(blob)`.
  - `type TurnMeta = { snrDb: number | null; noisy: boolean; path: 'fast' | 'llm' }`.
  - `type Reply = { parts: string[]; ops: LedgerOp[]; saved?: number; ackable?: number; show?: ShowMsg }`.

- [ ] **Step 1: Failing test** `server/ledger/core.test.ts`:
  `it('a heard new name is read back before an account is opened')`. Use `new LedgerCore(...)`
  directly and `processDrafts([draft('Pinky', 200_00, 'credit', { spoken: true })])`. Assert:
  `ops` is empty, `pending.kind === 'confirm'`, `pendingView().newCustomer === true`.
- [ ] **Step 2: Run** `npx vitest run server/ledger/core.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Move the code** into `LedgerCore`; `Session` holds `this.ledger` and forwards. No
  logic edits.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b && LOG_LEVEL=silent npx tsx eval/replay.ts`.
  Expected: all pass; replay still `wrong 0 | junk accounts 0`.
- [ ] **Step 5: Commit** `refactor: ledger core (drafts, questions, safety) out of session.ts`.

### Task 4: Tool registry, with the safety layer inside the tools

**Files:**
- Create: `server/agent/tools.ts`.
- Test: `server/agent/tools.test.ts`.

**Interfaces:**
- Consumes: `LedgerCore` (Task 3), `Snapshot.entries` (Task 2), and the replies (Task 5; use
  placeholders until merged, or order Task 5 first if parallel).
- Produces:
  - `interface ToolCall { name: ToolName; args: Record<string, unknown> }`.
  - `type ToolName`:
    - `'add_entries' | 'change_entry' | 'remove_entry' | 'undo_last' | 'move_entry' | 'settle'`
    - `| 'show_customer' | 'show_dues' | 'show_history' | 'show_today' | 'search' | 'top_debtors' | 'close_view'`
    - `| 'add_customer' | 'rename_customer' | 'merge_customers' | 'set_phone' | 'send_reminder' | 'send_statement'`
    - `| 'set_language' | 'set_read_back' | 'set_speed' | 'set_shop_name' | 'open_privacy' | 'backup' | 'erase_all'`
    - `| 'answer_question' | 'query_balance' | 'not_for_me' | 'unclear'`
  - `TOOL_SCHEMAS: { name: ToolName; description: string; parameters: JSONSchema }[]`: Gemini
    `functionDeclarations`, typed args, amounts as numbers in rupees.
  - `runTool(core: LedgerCore, call: ToolCall, meta: TurnMeta & { transcript: string }): Reply`.
  - New `Reply` fields:
    - `show?: ShowMsg`;
    - `setting?: SettingMsg`;
    - `ready?: { kind: 'whatsapp' | 'backup'; cid?: string; text?: string }`;
    - `notForMe?: true`.
- Rules (copy into code comments):
  - `add_entries` builds `Draft`s with `path: 'llm'` and reasons from `validate()`, so amounts not
    heard are dropped, and direction-guessed / name-changed lead to confirm.
  - Remove, move, merge, settle and erase always go through a pending question.
  - `erase_all` creates `pending.kind === 'delete'` with `view.requireTap = true`.
  - `send_reminder` refuses unless `remindersOptIn && adult` and asks for confirmation.

- [ ] **Step 1: Failing tests** in `server/agent/tools.test.ts`:
  - `'add_entries for a known customer with a spoken credit word writes at once and says the new balance'`:
    ops = one entry; reply text contains the new balance.
  - `'add_entries with a direction the sentence never said is read back'`: no ops,
    `pending.kind === 'confirm'`.
  - `'add_entries with an amount the sentence never had is refused'`: no ops, no pending; reply is
    didNotCatch.
  - `'two customers named Suresh: any write asks which one'`: `pending.kind === 'which'`; the
    options are labels with balances.
  - `'remove_entry, move_entry, merge_customers, settle always ask first'`: no ops on the first
    call.
  - `'erase_all needs a spoken yes and then a tap'`: after `answerPending('haan')` from voice,
    still no ops; after a tap (`turnSrc='tap'`), `delete_all`.
  - `'send_reminder to a customer without consent is refused with a spoken reason'`.
  - `'show_customer returns a show message and a spoken balance'`.
  - `'not_for_me returns notForMe and no speech'`.
- [ ] **Step 2: Run** `npx vitest run server/agent/tools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `runTool`** by mapping each tool onto `LedgerCore` methods. Answers for
  show and query tools are computed from `core.snap` (balances; history via `entries` filtered by
  `day`).
- [ ] **Step 4: Run** `npx vitest run server/agent && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: agent tools with the safety layer inside`.

### Task 5: Spoken reply templates for every tool (10 languages)

**Files:**
- Modify: `shared/replies.ts`. Add these to the `Replies` interface and all 10 language objects:
  - `savedWithBalance(name, amt, dir, balanceRs)`
  - `showCustomer(name, balanceRs, lastEntry?)`
  - `showDues(count, totalRs)`
  - `showHistory(label, count)`
  - `showToday(creditRs, paidRs)`
  - `searchResult(text, count)`
  - `topDebtors(names[])`
  - `closed()`
  - `customerAdded(name)`
  - `renamed(old, new)`
  - `mergeAsk(a, b)`
  - `merged(a, b)`
  - `phoneSet(name)`
  - `reminderReady(name)`
  - `statementReady(name)`
  - `noConsent(name)`
  - `languageSet(langName)`
  - `readBackSet(on)`
  - `speedSet(fast)`
  - `shopNameSet(name)`
  - `privacyOpen()`
  - `backupReady()`
  - `eraseAsk()`
  - `eraseTap()`
  - `awakeHello()` ("haan, boliye")
  - `sleeping()`
- Test: `shared/replies.test.ts`.

**Interfaces:**
- Produces: `say(lang).<template>` as listed; used by Task 4.

- [ ] **Step 1: Failing test** `'every language has every template, and money templates contain the digits'`:
  for each of the 10 langs, every key is a function, and
  `savedWithBalance('Ramesh', 300, 'credit', 640)` contains `'300'` and `'640'`.
- [ ] **Step 2: Run** `npx vitest run shared/replies.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write** the templates (short, natural, one sentence; numbers through the existing
  `r()` formatter).
- [ ] **Step 4: Run** `npx vitest run shared/replies.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: spoken replies for every agent tool in 10 languages`.

### Task 6: Agent call (Gemini, many tools, many calls)

**Files:**
- Create: `server/agent/agent.ts`, `eval/corpus/agent_cache.json` (written by Task 7's
  `--record`).
- Modify: `server/parse/gemini.ts`. Add
  `geminiAgentCall(system: string, user: string, tools: GeminiTool[], audio?: Buffer, opts?: { model?: string; timeoutMs?: number }): Promise<{ calls: ToolCall[]; ms: number }>`
  (returns every `functionCall` part; `audio` goes in as an `inlineData` WAV part).
- Test: `server/agent/agent.test.ts`.

**Interfaces:**
- Consumes: `TOOL_SCHEMAS`, `ToolCall` (Task 4).
- Produces:
  - `interface AgentContext { lang: Lang; heard: { locale: string; text: string }[]; history: string[]; screen: string; customers: string[]; recent: string[]; pending: PendingView | null }`.
  - `decide(ctx: AgentContext, audio?: Buffer): Promise<{ calls: ToolCall[]; ms: number }>`.
  - `AGENT_SYSTEM: string` (frozen prompt).
  - The deps hook `SessionDeps.agent?: (ctx, audio?) => Promise<{ calls; ms }>`, so tests stub it.
- Prompt rules (copy into `AGENT_SYSTEM`):
  - Only act on what was said to the app; otherwise `not_for_me`.
  - Never invent amounts; amounts must be ones that were said.
  - Reply language = the language spoken.
  - Use `unclear` when the words can't be trusted.
  - Several tools are allowed in one turn.

- [ ] **Step 1: Failing test** `'decide() passes all heard transcripts and returns the tool calls in order'`,
  with `fetch` mocked to return two `functionCall` parts. Assert the request body contains every
  `heard[i].text` and the tool names, and the result is
  `[{name:'add_entries',…},{name:'query_balance',…}]`.
- [ ] **Step 2: Run** `npx vitest run server/agent/agent.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `geminiAgentCall`** (`mode: 'ANY'`, `thinkingBudget: 0`, temperature 0,
  3 000 ms default) and `decide`.
- [ ] **Step 4: Live probe:** `LLM_TIMEOUT_MS=10000 npx tsx --env-file=.env eval/agent_probe.ts`
  (a new script: 5 sentences, prints the calls and ms). Expected: sensible tool calls, warm calls
  under 1 000 ms.
- [ ] **Step 5: Commit** `feat: Gemini agent call with tool registry`.

### Task 7: Understanding path in the session (instant + agent), old gates removed

**Files:**
- Modify:
  - `server/session.ts` `handleText`: instant path, else `deps.agent`, each call through
    `runTool`, results merged into one `Reply`.
  - Delete the hold/join (`held`, `MID_LIST_*`, `releaseHeld`) and the chatter gates listed in
    Global Constraints.
  - `api/voice.ts`: wire `agent: decide`.
  - `eval/replay.ts`:
    - add `--record` (live `decide`, saving calls into `eval/corpus/agent_cache.json`, keyed by
      the sha1 of the agent request);
    - the default replays from the cache;
    - replay every session **as awake throughout**.
  - `eval/replay.test.ts`: the same bar.
- Test: `server/session.test.ts` (rewrite the affected cases against a stub agent).

**Interfaces:**
- Consumes: `decide` (Task 6), `runTool` (Task 4).
- Produces: `Session.handleText(text, timing, src)`. Unchanged signature; it now always treats the
  text as addressed (attention is decided before it, in Task 8).

- [ ] **Step 1: Failing tests** in `server/session.test.ts`, with the stub agent:
  - `'a plain known entry is written by the instant path without calling the agent'`: the agent
    stub is not called.
  - `'anything else goes to the agent and its tools'`: the stub returns `show_customer` and the
    show message is sent.
  - `'not_for_me writes nothing, says nothing and marks not_entry'`.
  - `'agent failure: a plain entry still saves; anything else gets didNotCatch in the turn language'`
    (Review Focus 5).
- [ ] **Step 2: Run** `npx vitest run server/session.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the path. Instant path = `parseFast` gives `entries` where every entry
  has a name resolving to a known customer, a direction and `confidence: 'high'`. Remove the old
  code. If the language streams heard different amounts (the `heard[]` texts give different
  `parseAmounts` values), set the other value as the draft's `alt`, so it asks "300 or 500?". Add
  the test `'streams that heard different amounts ask which'`.
- [ ] **Step 4: Record and score:**
  `GOOGLE_VERTEX_KEY=… npx tsx --env-file=.env eval/replay.ts --record`, then
  `npx vitest run && npx tsc -b`. Expected: replay `wrong 0 | junk accounts 0`, all tests pass.
- [ ] **Step 5: Commit** `feat: instant path + Gemini agent; hold timers and chatter gates removed`.

### Task 8: Attention (server): asleep, awake, wake spotting

**Files:**
- Create:
  - `shared/wake.ts`: `spotWake(text: string): { found: boolean; rest: string }` (phonetic match on
    the bigram "khata bhai" and single-token "khatabhai" in any script, via `phoneticKey`).
    `isSleepWord(text): boolean` (bas / ho gaya / theek hai bas, in hi/kn/en spellings).
  - `server/attention.ts`:
    `class Attention { state: 'asleep' | 'awake'; wake(source: 'word' | 'tap' | 'hold' | 'phone'): void; touch(): void; holdStart(): void; holdEnd(): void; sleep(): void; onChange(cb): void }`
    with a 15 000 ms window; `touch()` restarts it; it never sleeps while `hasPending()` is true
    and the pending question is younger than 45 000 ms.
- Modify:
  - `shared/protocol.ts`: ClientMsg `{ type: 'wake'; source: 'tap' | 'hold' | 'phone' }`,
    `{ type: 'hold_end' }`; ServerMsg `{ type: 'attention'; state: 'asleep' | 'awake' }`.
  - `server/session.ts` `onFinal`:
    - asleep: run `spotWake`; if found, wake and handle `rest` (if empty, say `awakeHello`);
      otherwise drop silently;
    - awake: handle, then `touch()`;
    - a sleep word puts it to sleep;
    - ignore `spotWake` while speaking.
  - A phone wake (`source: 'phone'`) is confirmed: if the first transcript after it has no wake
    word, it goes back to sleep silently.
- Test: `shared/wake.test.ts`, `server/attention.test.ts`, `server/session.test.ts`.

**Interfaces:**
- Produces: the protocol messages above (used by Tasks 9 and 14), `Attention` (used by Session).

- [ ] **Step 1: Failing tests**:
  - `spotWake`:
    - `'KhataBhai, Ramesh 300 udhaar'` gives `{found:true, rest:'Ramesh 300 udhaar'}`;
    - `'खाता भाई रमेश 300'` and `'ಖಾತಾ ಭಾಯ್'` are found;
    - `'Ramesh ka khata kholo'` and `'bhai 300 do'` are not found.
  - `Attention`:
    - it sleeps 15 000 ms after `touch()` (fake clock);
    - it stays awake past 15 s while pending (Review Focus 3) and sleeps at 45 s.
  - Session:
    - `'asleep: customer talk with numbers writes nothing and says nothing'`;
    - `'asleep: "KhataBhai, Ramesh 300 udhaar" wakes and writes'`;
    - `'awake: a sleep word sleeps at once'`;
    - `'our own reply containing KhataBhai does not wake it'` (Review Focus 1);
    - `'"…bolo KhataBhai wale bhaiya ko" wakes, agent says not_for_me, nothing written'` (Review Focus 2);
    - `'a phone wake with no wake word in the transcript goes back to sleep'`.
- [ ] **Step 2: Run** `npx vitest run shared/wake.test.ts server/attention.test.ts server/session.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: wake word and awake window on the server`.

### Task 9: Client attention, state model and mic button

**Files:**
- Modify:
  - `src/lib/contracts.ts`: `VoiceStatus` adds `'asleep'`, and `'listening'` means awake.
    `VoiceClient` gains `wake(source: 'tap' | 'hold')`, `holdEnd()`, and `onAttention`
    through `VoiceEvents.attention?(state)`.
  - `src/lib/voice.ts`: send `wake` / `hold_end`; handle `attention`.
  - `src/ui/parts.tsx` `MicButton`:
    - tap while asleep = wake;
    - tap while speaking = barge-in;
    - tap while awake = sleep;
    - hold = wake while held;
    - the "muted" look is gone;
    - asleep = dim ring + "say KhataBhai".
  - `src/ui/feedback.ts`: `wakeChime()` and `sleepChime()`.
  - `src/App.tsx`:
    - status texts;
    - clear captions on `turn_done`;
    - a single offline indicator (remove the duplicate pill and banner);
    - changing language does not call `stop()`;
    - typed text and example chips send without starting the mic.
  - `src/ui/strings.ts`: `sayKhataBhai`, `awake`, `asleep` for hi/en/kn/ta/te.
- Test:
  - `src/lib/voice.test.ts` (new, with a fake WebSocket): `'tap while asleep sends wake{source:tap}'`,
    `'hold sends wake{hold} then hold_end'`.
  - Browser check via Chrome DevTools MCP at 390×844.

**Interfaces:**
- Consumes: the protocol messages from Task 8.
- Produces: `VoiceClient.wake` and `VoiceClient.holdEnd`, used by Task 14.

- [ ] **Step 1: Failing tests** (above).
- [ ] **Step 2: Run** `npx vitest run src/lib/voice.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`, then in the browser (local servers): asleep
  shows "say KhataBhai"; a tap wakes with a chime; 15 s of silence sleeps with the soft chime;
  changing language keeps the mic on.
- [ ] **Step 5: Commit** `feat: asleep/awake on the phone, one clear mic button`.

### Task 10: The screen follows every tool

**Files:**
- Modify:
  - `shared/protocol.ts`: the `show` views add `history { from: string; to: string }`, `today`,
    `top_debtors`, `search { text: string }`, `settings`. Add ServerMsg
    `{ type: 'setting'; key: 'lang' | 'readBack' | 'fastSpeech' | 'shopName'; value: unknown }`
    and `{ type: 'ready'; kind: 'whatsapp' | 'backup'; cid?: string; text?: string }`.
    `PendingView` gains `requireTap?: boolean` and `amounts?: number[]`.
  - `src/App.tsx`, `src/ui/Ledger.tsx`, `src/ui/Sheets.tsx`: handle the views and the settings;
    the `ready` card has a single big button that opens `wa.me` / the backup PIN.
  - `src/ui/parts.tsx` `PendingCard`:
    - the `name` card gets a text field;
    - the `amount` card shows `amounts` as buttons;
    - `requireTap` shows the destructive button and refuses voice "haan".
  - "Save anyway" on a dimmed "not an entry" line: the client sends a new ClientMsg
    `{ type: 'force'; text: string }`. The server handles the text as addressed and goes straight
    to the agent; `not_for_me` is not allowed for a forced turn.
- Test: `server/agent/tools.test.ts` (messages produced); a browser check of each view.

**Interfaces:**
- Consumes: the `Reply.show` / `setting` / `ready` fields from Task 4.

- [ ] **Step 1: Failing tests**:
  - `'show_history for "kal" produces history with yesterday's date range'`;
  - `'set_language produces a setting message and a reply in the new language'`;
  - `'send_statement produces a ready{whatsapp} with the statement text'`;
  - in `server/session.test.ts`, `'force{text} after a not_for_me writes the entry'`.
- [ ] **Step 2: Run** `npx vitest run server/agent/tools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the server messages and the client handling.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`, then a browser check of: "show Ramesh",
  "aaj ka hisaab", "kal ka hisaab", "sabse zyada kiska baaki", "Kannada mein bolo", "Suresh ko
  statement bhejo" (via the typed input).
- [ ] **Step 5: Commit** `feat: screen follows every voice action`.

### Task 11: Gemini hears the audio when the words are unclear

**Files:**
- Modify: `server/session.ts`. When `decide` returns `unclear`, call `decide(ctx, pcm)` once with
  the utterance audio (`uttAudio`, max 20 s), within the remaining part of the 2 500 ms budget.
  Then ask.
- Create: `eval/audio_latency.ts`. It runs 20 synthetic clips (Task 12) through `decide` with audio
  on `gemini-3.5-flash-lite` and `gemini-3.5-flash` in asia-south1 and prints p50/p95. Pick the
  model with p95 ≤ 2 500 ms; set `AGENT_AUDIO_MODEL`.
- Test: `server/session.test.ts`.

**Interfaces:**
- Consumes: `decide(ctx, audio?)` (Task 6).

- [ ] **Step 1: Failing tests**:
  - `'unclear text is retried once with the audio and the audio reading is used (read back)'`;
  - `'audio retry over budget asks the shopkeeper'`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, then `npx tsx --env-file=.env eval/audio_latency.ts`.
  Expected: PASS; the latency table is printed and recorded in README.
- [ ] **Step 5: Commit** `feat: Gemini reads the audio for unclear moments`.

### Task 12: Synthetic test sessions (counter talk + wake word)

**Files:**
- Create:
  - `eval/synth/scenes.ts`: about 40 scenes. Each is a list of lines `{ text, lang, addressed: boolean, expect?: ToolCall[] }`:
    customer chatter with prices, shop talk, and "KhataBhai …" instructions in hi/kn/en and mixed.
    It includes Review Focus 2 and "khata" said without "bhai".
  - `eval/synth/make.ts`:
    - render each line with `TtsPool.speak` (a voice per line from the stock voices);
    - insert 0.4–1.5 s gaps;
    - mix noise from `eval/data/noise/*.pcm` at 5–15 dB;
    - write `eval/data/synth/<scene>.pcm` + `.json`.
  - `eval/synth/score.ts`:
    - plays each scene into a local Session (real Gnani STT, recorded agent cache) the way the
      phone does;
    - reports false wakes per hour, missed wakes, entries from un-addressed lines, wrong tool or
      amount;
    - `--detector` also runs the on-phone model (Task 14) over the PCM.
- Test: `eval/synth/score.test.ts` (scoring logic on a hand-made result).

**Interfaces:**
- Produces: `eval/data/synth/*` (used by Tasks 11, 13 and 14).

- [ ] **Step 1: Failing test** `'score counts an entry from an un-addressed line as a failure'`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** scenes, make and score.
- [ ] **Step 4: Run** `npx tsx --env-file=.env eval/synth/make.ts && npx tsx --env-file=.env eval/synth/score.ts`.
  Expected: `entries from un-addressed speech 0`, false wakes reported.
- [ ] **Step 5: Commit** `test: synthetic counter sessions with the wake word`.

### Task 13: Train the "KhataBhai" wake-word model (LiveKit)

**Files:**
- Create:
  - `wakeword/khatabhai.yaml`: the LiveKit WakeWord training config. Phrase "KhataBhai",
    languages hi/kn/en. Extra positives: Gnani Timbre renders of "KhataBhai" from Task 12's
    voices. Negatives: the Task 12 un-addressed lines.
  - `wakeword/README.md`: how to retrain.
  - `public/wakeword/khatabhai.onnx`: the trained model output.
- Env: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (already in `.env`).

- [ ] **Step 1:** Read the livekit-wakeword README for the training command and config format;
  install its CLI in a Python venv under `wakeword/.venv` (git-ignored).
- [ ] **Step 2: Generate the extra positives and negatives** from Task 12 into `wakeword/data/`.
- [ ] **Step 3: Train** with the LiveKit Cloud credentials, and export ONNX to
  `public/wakeword/khatabhai.onnx`.
- [ ] **Step 4: Verify** with `npx tsx eval/synth/score.ts --detector` (model only). Expected:
  missed wakes ≤ 5% and false wakes 0 on the synthetic set; record the threshold chosen.
- [ ] **Step 5: Commit** `feat: KhataBhai wake-word model`.

### Task 14: On-phone wake detector

**Files:**
- Create:
  - `src/lib/wake/worker.ts`: onnxruntime-web; loads `/wakeword/khatabhai.onnx`; consumes 16 kHz
    Int16 frames over a `MessagePort`; posts `{ type: 'wake', score }`.
  - `src/lib/wake/index.ts`:
    `createWakeDetector(opts: { threshold: number }): Promise<{ feed(frame: ArrayBuffer): void; pause(): void; resume(): void; onWake(cb: () => void): void; dispose(): void } | null>`.
    It returns null if the model or WASM can't load.
  - `public/sw.js`: caches `/wakeword/*` and the onnxruntime WASM.
- Modify: `src/lib/voice.ts` at the frame gate:
  - asleep + detector: feed the detector, send nothing;
  - on wake: send `wake{source:'phone'}`, replay the last 2 s from `SpeechBuffer`, then stream;
  - pause the detector while speaking;
  - with no detector: stream as today (the server spots the wake word).

  Register the service worker in `src/main.tsx`.
- Add `onnxruntime-web` to package.json.
- Test: `src/lib/wake/index.test.ts` (a fake worker): `'frames are not sent while asleep with a detector'`,
  `'a wake sends wake{phone} and the 2 s pre-roll first'`.

**Interfaces:**
- Consumes: `VoiceClient.wake` (Task 9), the protocol `wake{phone}` (Task 8), the model (Task 13).

- [ ] **Step 1: Failing tests** (above).
- [ ] **Step 2: Run** `npx vitest run src/lib/wake`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`, then in the browser: saying "KhataBhai, Ramesh
  300 udhaar" (played from a Task 12 clip through the speakers) wakes it and writes the entry;
  chatter clips do not wake it; the Network tab shows no audio frames while asleep.
- [ ] **Step 5: Commit** `feat: on-phone wake word; no audio leaves the phone while asleep`.

### Task 15: Agent eval, docs and production

**Files:**
- Modify:
  - `eval/llm_compare.ts` becomes `eval/agent_eval.ts`: the hard cases plus 30 "control" sentences
    (show/settings/customers) with the expected tool, scoring correct tool, silent wrong and p50.
  - `README.md`: architecture, attention, tools, measurements, and the env vars list.
  - `.env.example`.
  - The deck link if the domain changes.

- [ ] **Step 1: Run** `npx tsx --env-file=.env eval/agent_eval.ts`. Expected: silent wrong 0;
  record the score.
- [ ] **Step 2: Set production env** on the Vercel project `khatabhai` (scope `zoodlemes-projects`),
  values piped and never printed:
  - `GOOGLE_VERTEX_KEY` = base64 of `~/.khatabhai/vertex-sa.json`;
  - `VERTEX_PROJECT=sulaiman-projects`;
  - `VERTEX_LOCATION=asia-south1`;
  - `LISTEN_LANGS=en-IN,hi-IN,kn-IN`.

  Remove `SARVAM_API_KEY` and `ANTHROPIC_API_KEY`.
- [ ] **Step 3: Deploy** `vercel deploy --prod --yes --scope zoodlemes-projects`.
- [ ] **Step 4: Verify** `npx tsx eval/text_dialogue.ts wss://khatabhai-nine.vercel.app/api/voice`.
  Expected: all pass. Then `vercel logs` shows `llm_call provider=gemini` under 1 000 ms, and a
  synthetic scene played at the live site wakes and writes.
- [ ] **Step 5: Commit** `docs: v2 architecture, measurements and env`.
