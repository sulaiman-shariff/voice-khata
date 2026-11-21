# Updates on `dev`

Changes made on the `dev` branch, newest first. Each item lists what changed, why, the files touched and how it was tested. `main` is untouched.

**Run locally** (two terminals, from the repo root):

```
npm install
npm run server      # voice function on ws://localhost:8787 (reads .env, restarts on server changes)
npm run dev         # UI on http://localhost:5173 (proxies /api/voice to 8787)
```

**Tests:** `npx vitest run` (575 pass) and `npx tsc -b` (clean).

---

## 3. Auto language (any language in, reply in the same language)

**What the user sees**
- The first screen has a new top tile, **"Auto · कोई भी भाषा"**. It is the default: no language has to be picked.
- In Settings, **Auto** sits above the 10 language chips. Picking a single language locks it as before.
- In the header, the language button reads "Auto · हिन्दी", showing the language last spoken.
- The shopkeeper can speak Hindi, then Kannada, then English: each reply comes in the language just spoken, and the screen labels follow.

**How it works**
- **Auto detection:** Prisma realtime accepts `language_code: indic-auto` (not in the README until now). It detects the language per utterance, keeps switching on one open stream, and adds no latency.
  - Probe on 12 clips, 10 languages plus Hinglish: 11 came back in the right script with the right tag, 0.5–1.0 s after speech end.
  - The 2 misses: one Kannada clip came back in Hindi script, and Marathi is tagged `hi-IN`.
  - Re-run it with `npx tsx --env-file=.env eval/probe_gnani6.ts`.
- **Replies follow the speaker:** in auto mode the session switches its reply language to the turn's `detected_language_code` in the same turn, before the reply is built. The switch costs no extra round trip.
  - It never switches on a bare yes/no or an unreadable turn, so "ok" or "haan" can't flip the language.
  - English does switch in auto mode. indic-auto writes Hinglish in Devanagari tagged `hi-IN`, so an `en-IN` tag really means English.
  - Marathi tagged `hi-IN` stays Marathi: if the current language is Marathi, or the text has Marathi-only words (आहे, नाही, दिले, घेतले…).
- **No re-locking:** the stream is never re-locked to one language in auto mode. `update_settings` is not sent on a switch.
- **Warm-up in every language:** in auto mode, the short replies ("noted", "didn't catch that") are pre-synthesized in all 10 languages, 2.5 s after the first session starts. The cache is per server instance. The first reply after a language switch then comes from memory.
- **keyterms fix (important):** customer names sent as `keyterms` in an Indic script pull indic-auto to that language. With Devanagari names, Kannada, Tamil and Telugu speech all came back as Hindi (`eval/probe_gnani6.ts --headers`). In auto mode only Latin-script names are sent. Our own name matcher still finds रमेश from "Ramesh" or ರಮೇಶ್.
- **Wrong-script fallback:** the existing Prisma REST language rescue also runs in auto mode. If realtime writes Kannada in Hindi script and the turn doesn't read, the REST reading in the right language is used.
- **Locked mode is unchanged:** a picked language behaves exactly as before.

**Protocol**
- `hello` has a new optional `auto?: boolean`. When it is absent, the server behaves as before. `lang` is then the starting / last-spoken language.
- The client persists it as `settings.autoLang`, default `true`.

**Files**
- `server/session.ts`: `auto` flag, `sttLocale()`, `sttKeyterms()`, `followAuto()`, `looksMarathi()`; `switchLang` no longer re-locks the stream in auto mode; language rescue is also allowed in the current language in auto mode.
- `shared/protocol.ts`: `hello.auto`.
- `src/lib/contracts.ts`, `src/lib/store.ts`, `src/lib/voice.ts`: `autoLang` setting, sent in `hello`.
- `src/App.tsx`: Auto tile on onboarding (starting language = phone language if supported, else Hindi), header label.
- `src/ui/Sheets.tsx`, `src/ui/strings.ts`: Auto chip in Settings, `AUTO_LANG` labels.
- `eval/probe_gnani6.ts`: new probe (indic-auto per language, on one stream, and header effects).
- `eval/e2e_auto.ts`: new end-to-end test, one conversation in hi → kn → ta → en → te → hi with real Gnani audio. It checks each entry and that the reply is in the spoken language. Run: `npx tsx --env-file=.env eval/e2e_auto.ts [ws-url] [--locked]`.
- `eval/local_server.ts`: honours `PORT`, so a second server can run beside the normal one.

**Parser:** the Telugu joined form "అప్పిచ్చాను" (appu + ichchaanu, "I gave on credit") is now read as credit. indic-auto writes it as one word.

**Tests added** (`server/session.test.ts`, "auto language", plus one parser case)
- Opens with indic-auto; a Kannada turn saves and is answered in Kannada; then English switches to English.
- A bare "yes" or an unreadable turn does not switch.
- Marathi tagged `hi-IN` stays Marathi.
- Locked mode still ignores English.

**Measured** (`eval/e2e_auto.ts`, local server, real Gnani STT/TTS): see "Latest e2e numbers" at the bottom.

---

## 2. Fewer confirmations, better understanding (commit `163a88f`)

**Problem:** "I give 340 to Ramesh" still asked "credit or paid?". A sentence with three new customers asked three separate questions.

- **One read-back for a list**
  - When a sentence has several complete lines that each need a yes (new names, noise, unusually big amount), the lines for known customers are saved at once. The rest are read back together, e.g. "Pinky 200 उधार, Sonu 300 जमा. सब सही है?".
  - One "haan" saves them all, answered with a short "लिख दिया" instead of every line again.
  - "Sonu ka 350" fixes just that line and asks again. "nahi" goes line by line, so only the wrong line is dropped.
  - Two lines for the same new name open one account, not two.
  - The batch card shows each line with its own credit/paid chip and a "new customer" badge, plus a "Correct × N" button.
- **The model reads a missing direction before the shopkeeper is asked**
  - With no credit/paid word, the turn now goes to the LLM if it has any other words ("I", "give", "to"…). The model takes about 1 s; a spoken question plus its answer takes several seconds.
  - A bare "Ramesh, 300" still asks at once.
- **Parser (no LLM needed)**
  - "I give / gave / have given / sold / lent X to NAME" and "maine / hamne diya" are read as credit.
  - "NAME gave me X" is read as payment.
  - The LLM prompt has the same English rules.
- **Files:** `server/session.ts` (`confirmBatch`, `batchRows`, batch `mode: 'confirm'` in `answerBatch`, `save` joins a just-opened account, `needsLlm`), `shared/intent.ts` (`hasOtherWords`, English/Hinglish cues), `shared/replies.ts` (`batchConfirm` in all 10 languages), `shared/protocol.ts` (`PendingView.rows`), `src/ui/parts.tsx` (batch card), `server/parse/llm.ts` (prompt).
- **Tests:** 11 new (parser cases plus session: batch yes, fix one line, no goes line by line, one account per new name, model reads the missing direction).
- **Still asked on purpose** (a voice entry still needs a yes):
  - a new name heard by voice (misheard words created junk accounts in production),
  - noise (SNR < 11 dB),
  - an amount 5× the customer's usual,
  - sound-alike amounts (60/7).
  - Typed entries skip these.

---

## 1. Gemini as the LLM, with several keys (commit `bbe0ce9`)

- **Provider choice:** the slow path (hard turns only) uses Anthropic when `ANTHROPIC_API_KEY` is set. Otherwise it uses Google Gemini (`gemini-3.5-flash-lite`, override with `GEMINI_MODEL`). `LLM_PROVIDER=gemini|anthropic` forces one.
- **Keys:** `GEMINI_API_KEY`, `GEMINI_API_KEY_2` … `_9`, or `GEMINI_API_KEYS=k1,k2,k3`.
  - Each call starts from the next key.
  - A key that fails is benched: 429 for its retry delay or 30 s, 401/403 for 10 min, 5xx/timeouts for 5 s. The next key is tried in the same call.
  - Logged as `gemini_key_failed`, with the key masked.
- **Same reading as before:** same prompt, same tool schema, same `validate()`. An amount the model invents is still never saved.
- **Measured:** about 1–2 s per call. A deliberately broken first key fell over to the next one with no failed turn.
- **Other changes:**
  - `npm run server` script added.
  - The privacy note now says hard sentences go to "an AI model (Google Gemini)".
  - `.env.example` lists the Gemini variables.
- **Files:** `server/parse/llm.ts`, `package.json`, `.env.example`, `src/ui/Sheets.tsx`, `eval/llm_gemini.ts` (import rename).

---

## Open items / notes for integration

- **Marathi:** indic-auto tags Marathi as Hindi. The Marathi-word check catches common sentences, not all.
- **Kannada:** indic-auto sometimes writes Kannada in Hindi script. The REST language rescue (one extra 0.2–0.5 s call, only on turns that don't read) recovers it.
- **Vercel:** env needs `GEMINI_API_KEY*` (and no `ANTHROPIC_API_KEY`, or `LLM_PROVIDER=gemini`).
- **Backups:** backup and customer confirmation links need `DATABASE_URL` (Neon). Not set locally.

## Latest e2e numbers

`eval/e2e_auto.ts`, 21 Nov 2026, local server (Windows laptop), real Gnani Prisma/Timbre. One conversation: hi → kn → ta → en → te → hi. "Correct" means the right customer, amount and direction were saved AND the reply was in the language spoken. Latency is speech end → first reply audio.

| Mode | Correct | p50 | max |
|---|---|---|---|
| Auto, warm server | **6/6** | **714 ms** | **935 ms** |
| Auto, first session after server start | 6/6 | 783 ms | 2,074 ms (first turn: cold TLS) |
| Locked Hindi (old behaviour) | 2/6 | 2,314 ms | 2,663 ms |

- **Locked Hindi:** Kannada, Tamil, Telugu and English were written in Hindi script, misread or sent to the LLM, and answered in Hindi.
- **Earlier auto runs, before two fixes:**
  - With Devanagari keyterms, auto mode scored 2/6 (everything came back as Hindi).
  - Without the all-language phrase warm-up, the first reply in a new language took about 1.25 s instead of about 0.75 s.
  - Without the Telugu fix, the joined form "అప్పిచ్చాను" fell to the LLM (up to 4.7 s when Gemini returned 503 and failed over to the next key). The parser now reads it directly.
