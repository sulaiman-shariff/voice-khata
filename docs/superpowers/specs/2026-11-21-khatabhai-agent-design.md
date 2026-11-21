# KhataBhai v2: a wake-word voice agent (design)


## Intent and why
KhataBhai is a voice credit ledger for kirana shops. Today the mic is always open and the
server guesses, sentence by sentence, whether speech was meant for it. There are 22 separate
text and word-list rules, none of which use the audio. Shopkeepers talk to customers all day,
so this produces false entries, nagging questions and missed instructions. That is the user's
main complaint. Each fix so far has been a patch.

v2 makes the product seamless:
- **You address it on purpose.** Say "KhataBhai" or tap the button, and it is awake for a short
  conversation.
- **The whole app is driven by voice.** An AI agent with a tool for every app action.
- **One understanding path** replaces four overlapping hearing and language-choice mechanisms.

## Decisions made with the user
- **Wake:** say "KhataBhai", or tap to listen. Both lead to the same awake state.
- **Awake window:** stays awake while ledger talk and its own questions keep coming. It sleeps
  **~15 s** after the last exchange, or at once on "bas" / "ho gaya". Its questions keep it awake
  until answered.
- **Voice control covers everything:**
  - showing and navigating;
  - ledger edits;
  - customers and WhatsApp messages;
  - settings and app actions.
- **Replies:** always a **full spoken sentence**, in the language spoken. The screen follows along.
  - A save is spoken with the **new balance**: "Ramesh ka 300 udhaar likh diya. Ab Ramesh ka kul 640
    baaki."
  - **Today's per-language Gnani voices** are kept.
- **Who can use it:** anyone who says "KhataBhai" or taps (owner, family, helper). No voice ID.
- **How it gets built:** subagent-driven development with **Sonnet** implementers, one task at a
  time, each reviewed before the next.
- **Wake-word training:** the user creates a **LiveKit Cloud project** and puts its API key and
  secret in `.env`.
- **Success means all four of:**
  - zero false entries at a busy counter;
  - mixed languages just work;
  - about 1.5 s or less from the end of speech to the reply starting;
  - the whole app is reachable by voice.
- **Approach A:**
  - Gnani hears (live, several languages).
  - A Gemini agent thinks (tools).
  - Gemini hears the audio only for unclear moments.
- **Sarvam is removed.** Privacy and the hackathon "Gnani" constraint are not concerns; the best
  output wins.

## Goals, non-goals, anti-goals
- **Goals:** the four success criteria above, a safety net that is never weaker than today, and a
  simpler server that is easier to change.
- **Non-goals (this round):**
  - Gemini Live: not in Mumbai, audio-only output, preview;
  - offline voice;
  - a native app;
  - multi-shop accounts.
- **Anti-goals (failure even if it "works"):**
  - an entry written from speech that was not addressed to it;
  - money written without a read-back when the model guessed (direction, name or amount);
  - replies slower than today on plain entries;
  - the screen and the voice disagreeing about what happened.

## Approaches considered
- **A (chosen):** Gnani live STT + a Gemini text agent with tools; Gemini audio only for
  unclear clips; wake word in the transcript first, on the phone later. It meets the latency
  target with proven pieces, and grows toward B if audio proves fast.
- **B:** Gemini hears every awake sentence. Best understanding, but measured and reported audio
  latency is 1.7–4 s per turn, which breaks the speed goal.
- **C:** Gemini Live end to end. Most natural, but US-only regions, Google's voice instead of
  Gnani's, preview "proactive audio", and weak Kannada/Tamil.

## Design

### 1. Attention: asleep, awake and the wake word
- **Asleep:** nothing becomes an entry and nothing is spoken.
- **On-phone wake word (in this build, user's decision):**
  - A custom **"KhataBhai" LiveKit WakeWord model** (Apache 2.0, any language and script).
  - **Trained** from synthetic voices: LiveKit's own pipeline, plus Gnani Timbre voices in hi/kn/en
    for Indian accents. Needs a LiveKit Cloud project and a GPU run (~11 min).
  - **Runs** in the browser (onnxruntime-web, ~7 MB model, ~1 ms CPU per 80 ms) in a **Web
    Worker** fed the 16 kHz mic frames directly (src/lib/voice.ts frame gate, ~line 176). The
    model file is cached by a service worker.
  - **While asleep, no audio leaves the phone.** On a wake, the 12 s speech buffer
    (src/lib/link.ts SpeechBuffer, same pattern as replay) sends the words from just before the
    wake plus the live audio, so "KhataBhai, Ramesh 300 udhaar" in one breath is heard whole.
  - The detector pauses while the app is speaking, so its own voice saying "KhataBhai" can't
    wake it.
- **Server-side check (always on):**
  - After a phone wake, the server confirms "KhataBhai" (or a sound-alike in any script, via the
    shared/names.ts phonetic matcher) is in the first transcript. If it isn't, the wake is treated
    as false and it goes back to sleep silently; a tap-to-listen wake skips this.
  - The same transcript spotting is the **fallback** if the on-phone model can't load (old phone),
    with asleep audio then streaming as today.
- **Waking:**
  - A soft wake chime plus the lit mic ring.
  - If the wake word is followed by an instruction in the same breath ("KhataBhai, Ramesh 300
    udhaar"), the instruction is handled; a bare "KhataBhai" answers with a short "haan, boliye"
    in the spoken language.
- **Awake:** every utterance goes to the understanding step (§2). The 15 s window restarts after
  each reply or question; an open question holds it awake until answered or expired.
  "bas" / "ho gaya" / "theek hai bas" sleeps at once.
- **Asleep again:** a softer sound, the ring dims, and status reads "say KhataBhai".
- **Tap to listen:** wakes it the same way. Holding forces awake while held, for very loud shops.
- **Removed (only needed because the mic was always open):**
  - the hold/join timers (mid-list, dangling, lone-name);
  - early-commit guessing beyond Prisma's own end-of-speech;
  - the chatter gates: offTopic, strayWord, quietUnlessShort, askedEnough, chatter_over_number,
    unclear_over_guess, partialDraft, rescuable;
  - money-gated heard cues;
  - not_entry while asleep.

  Echo-drop and barge-in stay, adapted to the awake state.

### 2. Understanding: one path per awake utterance
1. **Hearing:**
   - Gnani live STT, several languages at once (MultiStt, kept), with ledger words and customer
     names as hints.
   - **Fixed listening set: the app's language + English, Hindi, Kannada** (user's decision).
   - Streams open when awake. While asleep they stay closed when the on-phone detector works.
   - `set_language` changes the app language: the primary stream, the replies when the language
     spoken is unclear, and the UI text.
   - Removed: Prisma REST re-read, Sarvam, the second reading, languageRescue.
   - followDetectedLang is replaced by the agent replying in the language spoken.
2. **Instant path:**
   - parseFast (shared/intent.ts) handles plain, complete ledger lines ("Ramesh 300 udhaar",
     "Suresh ne 200 diye") with a known customer and a stated credit/paid in about 0 ms.
   - It calls the **same tool** the agent would, so safety and replies are identical.
3. **Agent path (everything else):**
   - One Gemini call (3.5 Flash-Lite, asia-south1, ~0.45 s measured).
   - Context: the transcript(s) from each language stream, the last few turns, the screen the
     user is on, customer names, recent entries and the open question.
   - It picks **one or more tools** (§3) or answers "not for me" (an aside while awake).
4. **Audio for hard moments:**
   - When the agent says it is unsure what was said, the same request is repeated **with the
     utterance audio** (Gemini audio input), with a ~2.5 s budget. If that still fails, ask.
   - The audio latency in asia-south1 (Flash-Lite vs Flash) is measured on the recordings before
     the budget is fixed.
5. **Asides while awake:** "not for me" is dimmed on screen with "not an entry", and one tap
   saves it anyway. Nothing is spoken.

### 3. The agent's tools (function calling; the safety layer is in the tools, not the model)
Every app action is a tool with typed arguments; the app's screen and the spoken reply follow
each tool result.

- **Show & navigate:**
  - show_customer(name)
  - show_dues(sort)
  - show_history(day | range)
  - show_today
  - search(text)
  - top_debtors(n)
  - close_view
- **Ledger:**
  - add_entries([{name, amount, direction, day, promise}])
  - change_entry(ref | {name, amount}, new values)
  - remove_entry(ref)
  - undo_last
  - move_entry(ref, to_name)
  - settle(name), which pays off the full balance
- **Customers & messages:**
  - add_customer(name, phone?)
  - rename_customer
  - merge_customers
  - set_phone
  - send_reminder(name) (WhatsApp, consent required)
  - send_statement(name)
- **Settings & app:**
  - set_language
  - set_read_back
  - set_speed
  - set_shop_name
  - open_privacy
  - backup
  - erase_all (always double-confirmed)

**Where tool data comes from (my call):**
- When a session starts, the phone sends its **whole ledger** to the server: all entries,
  customers, phones and consent flags.
- The server holds it **in memory for that session only, never stored**.
- Every show, question and statement tool answers from it with no extra round trip.
- Writes still go to the phone as ops (seq/ack), as today.

**Browser limits (my call):** WhatsApp sending (`wa.me`) and backup (PIN) need one tap; the
browser blocks them without one. Voice prepares everything, the screen shows the ready button,
and the spoken reply says "tap send". This counts as "reachable by voice".

**Riskiest actions (my call):**
- `erase_all` is a spoken request + a spoken yes + **a tap**; never voice alone.
- Reminders go only to customers with `remindersOptIn` (and adult), and the shopkeeper confirms
  each send.

**Safety layer (shared by the instant path and the agent), never weaker than today:**
- Read-back before writing when any of these holds:
  - new customer;
  - credit/paid guessed;
  - name changed or near-match;
  - amount not literally heard (validate's rule);
  - confusable amount;
  - noisy room;
  - large or unusual amount;
  - amounts disagreeing between language streams.
- A tapped card answer counts as the confirmation. Removing, moving, merging, settling and erasing
  always ask first.
- Existing pieces kept: Draft/Pending/processDrafts/needsConfirm/opensAccount/resolveName/
  candidates/label/save/applyLocal/exportState (server/session.ts), validate's amount rule
  (server/parse/llm.ts), number parsing, name matching and replies (shared/*).

### 4. Replies and screen
- **Full spoken sentence for every action,** in the language spoken, via Gnani Timbre (the phrase
  cache is kept). The agent writes the reply from fixed templates per tool and language
  (shared/replies.ts, extended), never free text for money.
- **The screen follows each tool result:**
  - new `show` views for history ranges, today and top debtors;
  - the question card gains a type-a-name field and amount choices;
  - captions clear at the end of each turn.
- **Client fixes from the review:**
  - one clear mic state model: off / asleep / awake / thinking / speaking / offline;
  - "muted" no longer looks like "off";
  - one offline indicator, not three;
  - changing language no longer stops the mic;
  - typed text no longer needs mic permission.

### 5. Server shape
- **Split server/session.ts (1,934 lines, 41 state fields) into:**
  - **attention** (asleep/awake/window/wake spotting);
  - **hearing** (Gnani streams, echo, barge-in);
  - **understanding** (instant path + agent);
  - **tools + safety**;
  - **conversation state** (pending question, focus, history, resume).
- The transport (api/voice.ts: heartbeat, replay, resend, ops seq/ack) is kept as is.
- **Removed:** server/sarvam.ts, verify, REST rescue/second reading, the Claude path and its key.

## Measurement
- **Replay set (my call on the bar):**
  - The 28 real sessions (eval/corpus) are replayed **as if awake the whole time**, the harshest
    case. The agent alone must ignore every aside: 0 wrong, 0 junk.
- **Synthetic sessions only (user's decision):**
  - Generated with Gnani Timbre voices in hi/kn/en: shop talk, customer chatter, prices and
    numbers, with "KhataBhai" instructions mixed in. Mixed with background noise (the existing
    noise sets in eval/).
  - Scored for: false wakes per hour (target 0 on the set), missed wakes, entries from
    un-addressed speech = 0, and correct tool and amount.
  - The same set tunes the wake-word threshold and the audio-latency budget.
- **eval/llm_compare.ts** becomes an agent eval: tool choice correct, silent wrong = 0.
- **Latency per turn type** (instant / agent / agent+audio): speech end to first reply audio.
- **Live checks:** eval/text_dialogue.ts against production, and a busy-counter recording run.

## Constraints
- Vercel Node function in Mumbai (bom1), WebSocket, 300 s max per connection (already handled).
- Gemini on Vertex, project sulaiman-projects (service account `khatabhai-vertex`, key outside
  the repo, `GOOGLE_VERTEX_KEY` env).
- Gnani Prisma/Timbre keys are as today.
- The ledger stays encrypted on the phone; the server holds no ledger.

## Left to the builder
- The exact phonetic matching for the wake word, and its false-wake threshold (tune on recordings).
- The agent prompt and tool schemas, and the reply template wording per language.
- How the module boundaries fall inside the server split.
- The client visual details of asleep/awake (follow the existing palette).
- The order of work. Suggested:
  1. tools/safety + full-ledger snapshot;
  2. agent;
  3. attention (awake window, tap, server wake spotting);
  4. synthetic test sessions;
  5. on-phone wake word (training, then the Web Worker);
  6. audio for hard clips;
  7. client polish.
- External setup:
  - The **user** creates the LiveKit Cloud project for wake-word training and adds its key and
    secret to `.env`.
  - The Vertex service account already exists.
- **My calls, for the user to check:**
  - The full ledger is held in session memory.
  - Voice + one tap for WhatsApp and backup.
  - erase_all needs a tap.
  - Consent: the opt-in flag plus confirming each send.
  - Replay the 28 sessions as always-awake.
  - Typed text goes through the same agent.
  - The instant parser is kept for plain entries.
  - A Hinglish sentence is answered in Hindi.
  - The wake check favours fewer false wakes over catching every wake (a tap is always available).
