# Updates on `dev`

Changes made on the `dev` branch, newest first. Each item lists what changed, why, the files touched and how it was tested. `main` is untouched.

**Run locally** (two terminals, from the repo root):

```
npm install
npm run server      # voice function on ws://localhost:8787 (reads .env, restarts on server changes)
npm run dev         # UI on http://localhost:5173 (proxies /api/voice and /api/* to 8787)
```

**Tests:** `npx vitest run` (580 pass) and `npx tsc -b` (clean).

---

## 4. New look, shop sign-up, simpler editing, WhatsApp reminders (Twilio)

**Status:** built and committed locally. Type check and unit tests pass. **Not yet tested by hand in the app.** The owner is testing it now; feedback will be added below under "Feedback and fixes".

### What the user sees
- **Header**
  - **Left:** hamburger (☰) button.
  - **Middle:** the shop name in a serif display font, with a small gold "KHATABHAI".
  - **Right:** a single **language dropdown**: "Auto" plus the 10 languages, with a ✓ on the current one.
  - "Auto · English" is gone: in auto mode the button says just **Auto**.
  - The privacy and settings icons moved into the menu.
- **Hamburger menu** (slides in from the left), in this order:
  - **Shop profile**, with "Edit profile".
  - **Colour theme** dropdown.
  - **WhatsApp reminders:** Twilio status, "Send automatically", "Repeat every 3/7/15/30 days", "Remind all due (N)".
  - **Voice:** hands-free, faster replies, read every entry back, latency, debug logs.
  - **My data** (the old privacy sheet).
- **5 colour schemes:**
  - Bahi Maroon (default, maroon + gold on ivory)
  - Emerald Ivory
  - Royal Indigo
  - Noir & Gold (dark)
  - Midnight Peacock (dark)

  The choice is saved, and applied from the first paint on the next open.
- **Luxury styling**
  - **Cut corners:** every box, button, card and sheet has bevelled corners instead of curves (CSS `corner-shape: bevel`). The mic is an octagon. Browsers without `corner-shape` (Safari/Firefox today) show small rounded corners instead.
  - **Fonts:** Playfair Display for the shop name, headings and every amount; Manrope for body text. Indian scripts keep the Noto fonts.
  - **Accents:** thin gold rules under the header and in the menu.
- **Sign-up step**
  - **New shops:** after picking a language, a "Set up your shop" form asks for shop name (required), owner name, address/area and shop phone.
  - **Existing shops:** they see it once too (until `profileDone`).
  - **Where it's used:** the profile signs every WhatsApp reminder.
- **Simpler edit-entry sheet**
  - **The sheet now holds:** big amount (gold underline instead of a red focus box), credit/paid, the customer as one line with "Change", date (Today / Yesterday / a calendar button), and one Save button.
  - **Moved to small text:** "Remove entry" and "what was said", at the bottom and under the title.
  - **Picking a customer:** a search plus the 8 most recent customers.
  - **Same-name customers:** typing a name that already exists offers "Another 'Ramesh'" for a genuinely different customer with the same name.
- **Mic row:** the keyboard (type instead) button is now on the **right** of the mic.
- **No overlap:** the list's bottom padding follows the real height of the floating bottom panel (question card + mic), so the last entries are never hidden behind it. The bottom panel also respects the phone's safe area.
- **Customer sheet**
  - **New fields:** a big **Send reminder** button next to the balance, and the last reminder time.
  - **Phone:** prefilled from what is saved, validated to 10+ digits.
  - **Tag:** area / nickname.
  - **Switches:** Adult and Allow reminders.

### Customers with the same name
- **The tag:** customers have an optional **tag** (area, shop, nickname: "Gali 3", "doodhwala"). It is stored in the existing `consent` event (`tag?`), so older ledgers still load.
- **Display name:** `displayName()` (shared/ledger.ts) is the name everywhere: lists, chips, sheet titles.
  - A unique name shows as it is.
  - Two customers with one name show as "Ramesh · Gali 3" (tag), else "Ramesh · …3210" (last 4 phone digits), else a short id.
- **Voice:** the snapshot sends this as `label`. When a spoken name matches two customers, the agent asks "Which one, Ramesh · Gali 3 or Ramesh · …3210?". Both the buttons and a spoken tag pick the right one.

### WhatsApp reminders
- **Manual:** the customer sheet's "Send reminder" button, or saying "Ramesh ko yaad dilao" (the existing remind intent).
  - The message is the existing polite template (shared/replies.ts `reminderText`, in the shop's language), signed with owner name, shop name, address and phone.
  - **With Twilio set up:** it is sent from the Twilio WhatsApp number.
  - **Without Twilio, or if Twilio refuses:** WhatsApp opens with the message filled in, for the shopkeeper to tap send.
- **Automatic:** with "Send automatically" on, when the app opens (and every 6 h while it stays open), every customer is reminded at most once per "Repeat every N days", if they are:
  - adult,
  - opted in,
  - with a phone number,
  - and owe money.

  It runs on the phone because the ledger only lives on the phone. A closed app sends nothing.
- **Consent unchanged:** only adult customers who agreed get reminders. Each message ends with how to stop them.
- **Payments:** not done. Paying from the message and the payment showing in the khata are left for the next step.

### Twilio setup (free trial, step by step)
1. Sign up at twilio.com (free trial) and verify your own phone number.
2. Open **Console → Messaging → Try it out → Send a WhatsApp message**. Twilio shows the **sandbox number** `+1 415 523 8886` and a join code like `join bright-river`.
3. Each phone that should receive reminders (start with your own) sends **`join <your-code>`** on WhatsApp to `+1 415 523 8886`. Trial limits:
   - **Only joined numbers get messages.** Twilio error 63015 means the number hasn't joined.
   - **The 24-hour window:** free-form text arrives only within 24 h of that phone's last message to the sandbox. Sending "join …" again, or any message, reopens it.
4. Copy **Account SID** and **Auth Token** from Console → Account Info. Add them to `voice-khata/.env`:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
   ```
5. Restart `npm run server`. In the app: ☰ → WhatsApp reminders should show "✓ Sent from your Twilio WhatsApp number".
6. **Test:**
   - Open a customer who owes money and enter your (joined) number.
   - Turn on Adult + Allow reminders.
   - Tap **Send reminder**. The WhatsApp message should arrive within seconds.
7. **Production, later:** register your own WhatsApp sender in Twilio, get a message **template** approved (variables {{1}} name, {{2}} amount, {{3}} shop), and set `TWILIO_WHATSAPP_FROM` and `TWILIO_CONTENT_SID`. Then any customer can be reminded at any time, with no join and no 24 h window. On Vercel, add the same env vars in the project settings.

### How it is built
- `server/remind/twilio.ts`: Twilio Messages API with one form POST (no SDK); `toE164()` turns 10-digit Indian numbers into +91 format.
- `api/remind.ts`:
  - `GET` → `{configured}`; `POST {to, body, vars?}` → send.
  - Guards: own origin only, phone validation, ≤1000 chars, 60 per IP per hour.
  - Nothing is stored; only the number and the text reach the server.
- `eval/local_server.ts`: serves `/api/remind`, `/api/backup` and `/api/confirm` beside the voice socket, and `vite.config.ts` proxies `/api/*` to it. Local dev therefore works without `vercel dev`.
- `src/lib/remind.ts`: builds the message, sends or falls back to wa.me, records the last reminder per customer (`settings.reminded`), runs automatic reminders.
- `src/ui/theme.ts` + `src/index.css`: 5 themes as CSS token sets (`<html data-theme>`, dark ones also set `.dark`), fonts, bevel corners, gold rule. Hard-coded `ring-black/*` and amber colours became theme-aware.
- New UI pieces:
  - `src/ui/Dropdown.tsx`: listbox dropdown, used for language, theme and repeat days.
  - `src/ui/Menu.tsx`: the hamburger menu.
  - `src/ui/Profile.tsx`: the sign-up and profile form.
- Rewritten: the `EntrySheet` form; `CustomerSheet` (tag, phone, reminder); `App.tsx` header, onboarding, mic row and footer padding.
- `SettingsSheet` is removed; its switches moved to the menu.
- Data: `shared/ledger.ts` (`tag`, `displayName`); `shared/protocol.ts` (`SnapCustomer.label`); `server/session.ts` (labels in "which one?"); `src/lib/contracts.ts` (profile, theme and reminder settings).
- Strings: about 30 new UI strings in hi/en/kn/ta/te (`EXTRA3` in `src/ui/strings.ts`).
- Fonts: `@fontsource-variable/playfair-display`, `@fontsource-variable/manrope`.
- Also fixed: a type-narrowing gap in the batch-confirm fix-one-line code from change 2. The project's `tsc -b` doesn't cover `server/`, so it was only found by checking the server files directly.

### Tests added
- `server/remind/twilio.test.ts`: number normalisation, rejects, configured check.
- `shared/ledger.test.ts`: `displayName` for unique names, tag, phone digits, id.

### Feedback and fixes
_(to be filled in from the owner's testing)_

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
- **Vercel env:** needs `GEMINI_API_KEY*` (and no `ANTHROPIC_API_KEY`, or `LLM_PROVIDER=gemini`), plus `TWILIO_*` for reminders.
- **Typecheck gap:** `npx tsc -b` only covers `src/` and `shared/`; server files can be checked with `npx tsc --ignoreConfig --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck --types node api/*.ts server/session.ts`.
- **Reminders:** automatic reminders need the app to be opened; a server-side schedule would need balances on the server, which the design avoids.
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
