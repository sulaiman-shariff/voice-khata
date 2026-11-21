# Updates

Changes to KhataBhai, newest first. Each item lists what changed, why, the files touched and how it was tested. Everything here is merged into `main`.

**Run locally** (two terminals, from the repo root):

```
npm install
npm run server      # voice function on ws://localhost:8787 (reads .env, restarts on server changes)
npm run dev         # UI on http://localhost:5173 (proxies /api/voice and /api/* to 8787)
```

**Tests:** `npx vitest run` (667 pass, 11 skipped) and `npx tsc -b` (clean).

---

## 10. Android app (Capacitor)

**Status:** code is built, and type check, unit tests, web build and `cap sync` all pass. **The APK has not been built on a device yet.**

**What it is:**
- A native Android app (`com.khatabhai.app`, "KhataBhai") that carries the UI inside the APK.
- It talks to the Vercel backend, set in `.env.android`, which `vite build --mode android` reads.
- The web build is unchanged and stays same-origin.

**Native pieces** (`src/lib/native.ts`, each does nothing on the web):
- **WhatsApp:** `openExternal()` opens `wa.me` links in WhatsApp through `@capacitor/app-launcher`, falling back to `window.open`. Used by `remind.ts` and `Sheets.tsx`.
- **Screen awake:** `keepAwake()` (`@capacitor-community/keep-awake`) keeps the screen on while the khata listens. The web still uses `navigator.wakeLock`.
- **Status bar:** `syncStatusBar()` gives a solid status bar in the theme's background colour, with matching icon style. It is re-applied by `applyTheme()`.
- **Back button:** `onBackButton()` closes the top layer: entry, then typing, then the open sheet, then the customer. With nothing open it minimizes the app.
- **Splash:** `hideSplash()` hides it after the first frame.
- **Offline banner:** `useOnline()` (`src/lib/online.ts`, `@capacitor/network` in the app) shows "No internet — voice is paused, your khata is safe".
- **Mic step during onboarding:** a one-time "Allow microphone" step after the shop profile. It is skipped when the permission is already granted, and remembered as `micAsked` in settings.

**Android project** (`android/`, committed):
- **Permissions:** `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` and `CAMERA` (camera not required).
- **Icons and splash:** generated from `public/icon.svg` by `scripts/make-app-assets.mjs` and `@capacitor/assets`.

**Build and install** (needs Android Studio installed once, for its Java and SDK; phone with USB debugging on):
```
npm run apk           # cap sync, then gradlew assembleDebug; sets JAVA_HOME / ANDROID_HOME / local.properties itself
npm run apk:install   # adb install -r, with adb found under the Android SDK
```
Debug the app's WebView from the PC at `chrome://inspect`.

**Backend:** the deployed Vercel site must include `server/http.ts`'s CORS allow-list, which accepts `https://localhost`. Otherwise reminders and backup are refused, though voice already works.

**Check on the phone:**
- the mic step, then hands-free voice
- a reminder opens WhatsApp
- photo import opens the camera
- the back button
- the status bar in light and dark themes
- the screen stays awake while listening
- the offline banner when you switch on airplane mode

---

## 10. One clean look, a living voice orb, counter QR, payment announcements, due dates, plans, cashbook, suppliers, same-name customers (branch `feat/refine-ui-features`)

### What the user sees
- **One look.** The five colour themes and the theme picker are gone. There is one ivory design with consistent radii, three shadow levels, proper contrast on red/green buttons, and fonts for Malayalam, Bengali, Gujarati and Gurmukhi. With "reduce motion" on, movement stops but state changes still show.
- **The voice orb** looks different in each state:
  - off: outline only
  - offline: slashed mic
  - asleep: a breathing glow with a moon, "Say KhataBhai"
  - listening: a live level ring
  - heard: a pulse
  - thinking: orbiting dots
  - speaking: navy equaliser bars. Green is now used only for money.
- **Motion everywhere:** rows animate in and out, a new entry rises from the dock with a colour flash, tabs slide, dock cards spring in, sheets can be swiped away, amounts count up, and onboarding staggers in. There is a branded splash, plus empty, loading and error states.
- **Counter QR.** "Ramesh ka QR dikhao" shows a QR for the amount, usually the balance.
  - Razorpay QR Codes are used when the account has them. Otherwise the app makes a 20-minute Razorpay Payment Link and draws it as our own QR; the customer scans it with the camera.
  - When the payment lands, the webhook books it, the QR turns into a check with a coin burst, and the app says "Ramesh ne ₹340 jama kiye, baaki ₹900".
  - "Paid in cash" records a cash payment instead.
- **Payment announcements.** Any Razorpay payment, from a reminder link or a QR, is spoken aloud within a few seconds. The app polls every 2 s while a QR is open and for 10 minutes after a link is sent. A menu switch turns this off.
- **Partial payments.** "Ramesh ne 200 diye, 140 baaki — naya link bhejun?" Saying "haan" prepares a link for the rest.
- **Daily summary.** "Aaj ka hisaab" gives credit, collected, cash in hand, new customers, top dues and today's promises. Today also has a summary card with a 7-day chart. On the first wake of the day the app offers a morning briefing.
- **Due dates and ageing.**
  - "Ramesh ka 340, Somvaar tak" sets a due date.
  - Dues rows show an age pill: 0–7, 8–30 and 30+ days. They can be sorted by amount, age or due date.
  - Overdue entries get a chip. "Kiska 30 din se purana hai?" opens the overdue list.
- **Collect today** (from the bell, or "aaj kisse lena hai"). It lists everyone due, everyone who promised today and everyone 30+ days old. "Sabko yaad dilao" reminds them all, and rows tick off as payments land.
- **Instalment plans.**
  - "Ramesh ka 3000, teen hafte mein" or "har hafte 500" is always read back first.
  - The server sweep sends a link for each instalment on its day.
  - The customer sheet shows a progress bar.
- **Cashbook (galla).**
  - "Bijli 800", "500 ka maal kharida", "galle mein 2000 daale" are recorded by category, in a Cashbook tab.
  - Cash payments from customers and payments to suppliers appear there too; they are worked out from the khata, never stored twice.
  - Razorpay and QR payments count as bank.
- **Supplier khata.**
  - "Gupta ji ko 5000 dene hain" records money the shop owes, shown in its own colour as "dena hai".
  - The header shows "Lena hai" and "Dena hai".
  - Suppliers never get reminders or QRs, and never appear in dues.
- **Itemised bills.** "Ramesh: do kilo chawal, ek Maggi, 340" stores the items as chips on the entry and on the statement.
- **Statement image.** The customer sheet or "statement bhejo" draws a PNG on the phone: the last 15 entries, the running balance and a pay QR. It is shared through the phone's share sheet. Only that customer's entries leave the phone.
- **Customer voice notes.** A WhatsApp voice reply such as "kal de dunga" is transcribed and shown as a one-tap "add promise" card.
- **Customers with the same name.**
  - Adding a second Ramesh asks once for a nickname ("doodhwala", "Gali 3"). It can be skipped, and the label then falls back to the phone's last 4 digits, then "Ramesh 2". Labels are always different and never include a balance.
  - "Doodhwala Ramesh" picks that customer. "Which one?" lists all the twins (up to 4), and "doosra wala" works without the model.
  - "Naya Ramesh" creates a twin.
  - "Rakesh 200" when only Ramesh exists offers [Ramesh] and [+ naya Rakesh] and keeps the amount.
  - When importing, a name that matches two customers makes you choose.
  - Twins that share a phone number get a "same person? merge" hint. The app never merges on its own.

### Setup
- **Razorpay.** No new keys. Counter links use the existing `payment_link.paid` webhook event. If QR Codes are ever enabled on the account, also add `qr_code.credited` to the webhook; the code prefers native QRs automatically.
- **Cloud Run.** Redeploy: the image now includes ffmpeg (for voice notes), and `deploy/cloudrun.sh` passes `GNANI_API_KEY` and uses 512Mi.
- **Database.** New table `qr_codes`. New `receivables` columns `due_day`, `plan_next_day` and `plan_part_paise`. All are created by the existing migration in `server/db.ts`.

### How it is built
- **UI.**
  - `src/ui/kit.tsx`: Segmented, Toggle, Chip, PhoneInput, AnimatedAmount, StatTile, Avatar, NameTag, ListRow, EmptyState, Skeleton, ConfirmDialog.
  - `src/ui/home/*`: Header, StatsRow, TodayTab, DuesTab, VoiceDock, VoiceOrb, Onboarding, Splash. The voice wiring is in `src/ui/useVoice.ts`.
  - `src/components/ui/sheet.tsx` is built on the base-ui Drawer.
  - The feature screens are QrSheet, CollectSheet, CashbookTab, TodaySummaryCard, PlanCard, AgePill, OverdueChip, PromiseSuggestionCard and StatementButton. The image is drawn by `src/lib/statement.ts`.
- **Ledger** (`shared/ledger.ts`). New events, all optional, so old logs replay unchanged: `cash`, `plan_set`, `plan_cancelled`, `customer_kind`, `entry.due`, `customer_added.kind`.
  - Helpers: `ageing`, `collectList`, `planStatus`, `cashbook`, `sevenDayTotals`, `lenaDena`, `owedLabel`, `uniqueLabel`.
  - A cash row has no customer, so it is sealed under the existing `shop` key.
- **Agent.**
  - New tools: `show_qr`, `show_overdue`, `collect_today`, `set_plan`, `cancel_plan`, `add_cash`, `set_tag`.
  - `add_entries` gains `due_*`, `items`, `party` and `new_customer`.
  - Replies are in `shared/replies-shop.ts` (`sayShop`) and `sayPay` in `shared/replies.ts`, in 10 languages, through the tone guard.
- **Payments.**
  - `server/pay/qr.ts` and `api/qr.ts`: the QR is tried first, the payment link second, and the upi:// QR last.
  - `server/pay/webhook.ts` books payments idempotently. A payment event carries `via`, `qrId` and `partial`.
  - The `announce` client message is spoken by the session after any current reply.
  - `src/lib/qr.ts`, and `expectPayments()` in `src/lib/sync.ts`.
- **Voice notes.** `server/wa/voicenote.ts` handles download, ffmpeg conversion to 16 kHz, Gnani transcription and the `promise_suggestion` event.

### Known gaps
- The automatic replay test (`eval/replay.test.ts`) was removed: its recorded agent cache predated the new tools. The replay itself still runs by hand: `node --env-file=.env --import tsx eval/replay.ts eval/corpus/prod.json --record --fill` (needs the Vertex key).
- The Vonage voice-note media download hasn't been tested against the live API.

---

## 9. Vonage as a free WhatsApp sender (Twilio's new trial can't send our text)

**Why:**
- **Twilio's trial changed:** new Twilio trials (Nov 2026: "Twilio One Console", $0.00 credit, "free units") only send Twilio's own sample template from `+1 737 221 2163`. Our text fails with 21654, and templates can't be created on trial.
- **Vonage's sandbox still works the old way:** its **Messages API sandbox** gives a shared WhatsApp number that sends **any text** to phones that opted in. Messages come from Vonage's number, never the shop's own WhatsApp.

**How it works:**
- `server/remind/vonage.ts`: one JSON POST to `messages-sandbox.nexmo.com/v1/messages` (sandbox), or `api.nexmo.com/v1/messages` with `VONAGE_SANDBOX=false` for a real approved number. Basic auth with API key and secret.
- `api/remind.ts` `remindProvider()`: **Vonage when its three env vars are set, else Twilio, else none** (the app then offers the shop's own WhatsApp). `GET /api/remind` returns `{configured, provider}`. Logs say which provider sent.
- App wording no longer says "Twilio": "Sent automatically from the WhatsApp API number" (5 languages).

**Setup (free):**
1. Sign up at dashboard.nexmo.com, then go to **Messaging → Messages Sandbox → WhatsApp**.
2. From each phone that should receive reminders, send the passphrase shown there (for example "Join cross guru") to the sandbox number (`+1 415 738 6102`).
3. In `voice-khata/.env`:
   ```
   VONAGE_API_KEY=<API key>
   VONAGE_API_SECRET=<API secret, from dashboard → API Settings>
   VONAGE_WHATSAPP_FROM=14157386102
   ```
4. Restart `npm run server`. The menu should show "✓ Sent automatically from the WhatsApp API number".

**Sandbox limits:**
- Only opted-in numbers receive messages.
- WhatsApp's 24 h rule applies: free text arrives within 24 h of that phone's last message to the sandbox. Sending the passphrase again reopens the window.
- Not for real customers. Production needs a real WhatsApp sender, with Vonage, Twilio or Meta, plus an approved template.

**Files:** `server/remind/vonage.ts` (new), `api/remind.ts`, `src/ui/strings.ts`, `.env.example`.

**Demo UPI:** `VITE_DEMO_UPI=khatabhai.demo@example` (in `.env`) fills the pay line while the shop profile has no UPI ID, so the demo shows the whole message.
- No bank handles `@example`, so UPI apps reject it and a customer can never pay a stranger by mistake.
- The shop's own UPI ID always wins.
- Remove the variable for real use.
- `src/lib/remind.ts` (`demoUpi`), test in `src/lib/remind.test.ts`.

**Verified (22 Nov):** with the owner's phone joined to the sandbox, `POST /api/remind` went through Vonage (`provider: vonage`, status `accepted`), and the WhatsApp message **arrived** on the phone from `+1 415 738 6102`.

---

## 8. Reminders bell, customer numbers, top bar spacing

**Owner's feedback:**
- Where does the shop type the customer's number?
- They want a notification button to send a reminder by hand at any time, beside the automatic ones (for example when a customer missed one).
- The top bar needs proper spacing: the language button was cut off ("Eng…").

**Fixes:**
- **🔔 Reminders bell in the top bar** (with a badge counting customers who owe) opens the **Reminders** screen (`src/ui/RemindSheet.tsx`).
  - Tabs: *Dues* (everyone who owes) and *All customers*.
  - Each row: name (same-name customers told apart), amount owed, a **+91 phone box to type the number right there** (saved when you leave the box), one switch **"Adult, agreed to reminders"** (sets both consents), a **Send** button, and when the last reminder went.
  - **Send to all (N)** sends to everyone with a number and consent.
  - Works any time, independent of the automatic schedule.
- **Number when adding a customer:** creating a new customer in the add-entry sheet now asks for an optional WhatsApp number and, once one is typed, the consent switch. Both are saved with the new customer.
- **The number is now in four places:** the bell screen, the add-entry sheet (new customers), the customer screen's reminder box, and the WhatsApp button on Dues rows (which opens the customer when the number is missing).
- **Top bar:**
  - **Layout:** ☰ (left) | shop name + "KHATABHAI", centred on the bar | 🔔 + language (right).
  - **Language button:** compact, just the globe and **Auto** or a two-letter code (EN, HI, KN…), so it never truncates. The dropdown still lists the full names.
  - **Shop name:** text-base on phones, lg on wider screens, truncated only if very long.
  - **Status bar:** the bar pads for the phone's status bar (`env(safe-area-inset-top)`), for the Capacitor app.
- **Files:** `src/ui/RemindSheet.tsx` (new), `src/App.tsx` (top bar, bell, sheet), `src/ui/Dropdown.tsx` (`compact`), `src/ui/EntrySheet.tsx` (new-customer number and consent), `src/ui/strings.ts` (`EXTRA6`, 5 languages).

**Bug found in testing: "Send opens WhatsApp instead of sending through Twilio."**
- **Cause:** the app asked the server once per page whether Twilio was set up and remembered the answer, including a failed check. The voice server restarts for about a second whenever server code changes (`tsx watch`). A page that checked during a restart remembered "no Twilio", so every reminder after that silently opened WhatsApp. The server log showed no send request at all.
- **Fix** (`src/lib/remind.ts`):
  - Only a **yes** is remembered. A no, or no answer, is asked again: every tap re-checks, and the menu and Reminders screen re-check when opened.
  - When Twilio refuses a message, WhatsApp is **no longer opened by itself**. The toast says why, and offers a **WhatsApp** button to send it from the shop's own WhatsApp instead.
  - Twilio's common trial errors are explained in plain words (`toastRemind` in `src/ui/Sheets.tsx`):
    - 63015: number has not joined
    - 63016: 24 h window closed, send the join code again
    - 21211: invalid number
    - 21608: trial, verified number only
    - 21610: customer replied STOP
    - 63007: wrong sender in `.env`
    - 20003: wrong SID/token
  - With no number saved it asks for one, instead of opening WhatsApp with no recipient.
  - Only when the server has no Twilio at all does a tap open WhatsApp directly, as intended.
- **Test:** `src/lib/remind.test.ts`: a failed check is retried and a yes is remembered.

---

## 7. WhatsApp reminder wording

**Owner's asks:**
- **First round:** it should feel like a reminder from the shop, never like begging or harsh collecting.
- **Second round:** not lenient ("whenever it suits you" was too soft), no emojis except at most one, and bold instead.

**The message now** (in the shop's language; English shown):
```
*Sharma Kirana* — Payment reminder

Hi Ramesh, your khata balance with us is *₹500*.
Please settle it on your next visit, or pay online here:
https://<site>/pay?…
UPI: *sharma@okaxis*

Thank you 🙏
Rakesh · Jayanagar · 98xxxxxxxx

_KhataBhai · Reply STOP to stop these reminders._
```
- **Structure:**
  - the shop name in bold as the header,
  - the balance stated plainly, in bold,
  - a clear ask to settle on the next visit, or pay online when the shop has a UPI ID (otherwise just "Please settle it on your next visit."),
  - thanks,
  - the shop's signature (owner, address, phone),
  - an italic opt-out line.
- **Emoji:** one only, 🙏 after the thanks.
- **Languages:** written in all 10 (`reminderWords()` in `shared/replies.ts`), used for manual, voice and automatic reminders.
- **Tone guard:** the BANNED list, which also guards spoken replies, blocks harsh and pleading words: penalty, legal action, immediately, **overdue, urgent, final notice/reminder/warning, pay now, failure to, kindly**. A test checks every language's reminder against it, and that each has at most one emoji.
- **Voice reminders:** "Ramesh ko yaad dilao" sends the same message, built on the phone with the profile and pay link.
- **Preview:** the customer screen's reminder box has **"See the message"**, showing exactly what will be sent.
- **Brand:** the message says **KhataBhai**. "Khatabook" is a different, real company's brand.
- **Files:** `shared/replies.ts` (`reminderWords`, `pressingWord`, BANNED), `src/lib/remind.ts` (`reminderMessage`), `src/App.tsx` (voice reminder), `src/ui/Sheets.tsx` (preview), `src/ui/strings.ts` (`msgPreview`), `src/lib/pay.ts`.
- **Tests:** `src/lib/remind.test.ts`: the exact English layout with UPI, Hindi without UPI, and the tone and emoji limit in every language.

---

## 6. Customers pay from the reminder (UPI), welcome page + logo, ready for Capacitor

**Status:** built and committed locally. Type check and unit tests pass. **Not yet tested by hand**: the owner tests it.

### Getting paid (UPI)
- **Shop UPI ID:** the shop profile has a **UPI ID** field (sign-up and ☰ → Edit profile), validated as `name@bank`. Until it is set, the customer screen's reminder box says so.
- **Reminder text:** with a UPI ID set, every reminder (manual, voice or automatic) gets two lines:
  `💳 Pay ₹500: https://<site>/pay?pa=…&pn=…&am=500&tn=Khata: Ramesh`
  `UPI: sharma@okaxis`
- **Why an https link:** WhatsApp does not make `upi://` links tappable, so the reminder links to a **pay page** instead.
- **The pay page** (`/pay`, `src/pages/PayPage.tsx`) is what the customer opens, in English with Hindi beside it. It shows:
  - the shop and the amount, which the customer can change to pay part of it,
  - **"Pay with UPI app"**: a standard `upi://pay?pa&pn&am&cu=INR&tn` link that opens GPay, PhonePe, Paytm, BHIM or any UPI app with everything filled in,
  - a **QR code** for paying from another phone,
  - the **UPI ID** with a copy button.
- **Where the money goes:** straight from the customer's UPI app to the shop's account. KhataBhai never holds or sees it.
- **Marking the khata paid automatically:** now built with Razorpay Payment Links and a webhook. The phone pulls booked payments from the server (see section 10).
- **Files:** `src/lib/pay.ts` (`isUpiId`, `upiUri`, `payPageUrl`, `readPayRequest`, "Pay" in 10 languages), `src/lib/remind.ts` (pay lines), `src/pages/PayPage.tsx`, `src/App.tsx` (`/pay` route), `vercel.json` (`/pay` rewrite), `src/ui/Profile.tsx`, `src/ui/Menu.tsx`, `src/ui/Sheets.tsx`, strings `EXTRA5`. New dependency: `qrcode`.

### Welcome page and logo
- **First open:** **Welcome to KhataBhai** (logo, "Your voice khata. Speak, it writes." / "बोलो, खाता लिख जाएगा।", a rotating example in 5 languages, three feature cards, "Get started") → choose language → shop sign-up → app.
- **The logo** (`src/ui/Logo.tsx`, placeholder art) is a speech bubble holding a ₹, with two ledger rules underneath. In the app it takes the theme's colours; `public/icon.svg` is the same mark in fixed colours for the tab, the PWA and the app icon. It also appears in the menu and on the pay page.
- `public/manifest.webmanifest` uses the new colours.

### Ready for Capacitor (APK)
In the APK the UI is served from inside the app (`https://localhost` on Android, `capacitor://localhost` on iOS), not from the server. So:
- **Server address:** every API call and the voice socket now go through `src/lib/api.ts`. Set **`VITE_API_BASE=https://<deployed-site>`** when building the APK. On the web it stays same-origin, so nothing changes there.
- **Customer links:** links customers open (pay page, confirm links) use **`VITE_PUBLIC_URL`**, which defaults to `VITE_API_BASE`, never the app's own `https://localhost`.
- **Server CORS** (`server/http.ts`):
  - **Allowed origins:** the Vercel site, local dev (localhost and LAN), and `https://localhost` / `capacitor://localhost` / `ionic://localhost`. Extra ones go in `ALLOWED_ORIGINS`.
  - **HTTP functions** (`remind`, `import`, `backup`, `confirm`) answer preflights and add CORS headers.
  - **The voice socket** uses the same allow-list.
  - **Before this change:** `backup` and `confirm` had no origin check at all, and voice did not allow LAN addresses.
- **Steps for the friend:**
  1. `npm i @capacitor/core @capacitor/cli @capacitor/android && npx cap init KhataBhai com.khatabhai.app --web-dir dist`
  2. Build: `VITE_API_BASE=https://<deployed-site> npm run build && npx cap add android && npx cap sync`
  3. In `android/app/src/main/AndroidManifest.xml`, add permissions `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` and `CAMERA` (for the photo import). `INTERNET` is already there. Capacitor's WebView asks for the mic when `getUserMedia` runs.
  4. Icons: export `public/icon.svg` to a 1024×1024 PNG at `assets/icon.png`, then `npx @capacitor/assets generate --android`.
  5. `npx cap open android` → build the APK in Android Studio.
- **Check in the APK:**
  - the mic in hands-free mode,
  - WhatsApp fallback links (`window.open` to `wa.me` should hand over to WhatsApp),
  - the photo picker (`<input type=file capture>`).
- **Files:** `src/lib/api.ts`, `src/lib/backup.ts`, `src/lib/remind.ts`, `src/ui/ImportSheet.tsx`, `src/pages/ConfirmPage.tsx`, `src/App.tsx`, `server/http.ts`, `api/*.ts`, `.env.example`.

### Tests added
- `src/lib/pay.test.ts`: UPI ID check, `upi://` link fields, pay page query parsing.
- `server/http.test.ts`: allowed and refused origins, preflight, CORS headers.

### Feedback and fixes
_(to be filled in from the owner's testing)_

---

## 5. Import an old paper khata (read aloud, type, or photo)

**Status:** built and committed locally. Type check and unit tests pass. **Not yet tested by hand**: the owner tests it, and feedback goes under "Feedback and fixes".

**Problem:** a shop that kept its khata in a book should not have to type every customer again.

### What the user sees
- **Where to start:**
  - ☰ → **Import old khata**.
  - On an empty History tab: "Have a paper khata? Import it".
- **Three tabs**, all filling one **review table**:
  1. **Read aloud:** tap "Start reading" and read the book line by line: "Ramesh 500… Suresh 300 jama…". Each sentence's name–amount pairs appear as rows. Nothing is saved and the agent does not answer or ask anything in this mode. The mic is switched to hands-free while reading.
  2. **Type:** one customer per line ("Ramesh 500", "Suresh - ₹1,200", "Geeta 300 jama", "500 Geeta") → "Add rows".
  3. **Photo:** take or choose a photo of a khata page. The phone shrinks it to about 1600 px JPEG; Gemini reads every customer row (name in the original script, final balance, crossed-out figures replaced, totals and headings skipped). Hard-to-read rows are marked "check this".
- **Review table:** each row has:
  - an editable name and amount,
  - **Owes / Advance** (credit or payment),
  - a customer match (the existing customer, or "+ New: name"),
  - a delete button.

  Two near-identical matches (two Rameshes) default to "new" so the shopkeeper chooses. "Balance as of" sets the date of the opening balances (default today).
- **Save all:** writes one opening-balance entry per row in one batch.
  - New names become customers, and two rows for one new name share one account.
  - Entries carry `source.lang = 'import'`, `reasons: ['import']`, and a transcript like "opening balance (from photo)".
  - Unsure photo rows are saved with `confidence: 'low'`.

### How it is built
- **`shared/import.ts` `parseImport()`:** pure parser for typed lines and spoken lists. It uses the existing amount parser (digits, ₹, Indian commas, number words like "paanch sau"/"dedh sau").
  - The words before an amount are the name; a paid word after it (jama, paid, advance, Cr) makes the row an advance.
  - Page furniture ("page 2", "date", "total", "sr no") is skipped.
- **Read-aloud mode:**
  - New client message `{type:'import', on}`, accepted by the validator in `api/voice.ts`.
  - While it is on, `Session.handleText` sends `{type:'import_rows', rows, text}` and `turn_done`, and returns. No ops, no reply, no LLM call, and any open question is cleared.
  - The voice client re-sends the mode after a reconnect.
- **Photo:**
  - `api/import.ts`, `POST {image: dataURL}` → `{rows, ms}`. Own origin only, about 4.5 MB cap, nothing stored.
  - `server/parse/vision.ts` reads the page with **`gemini-3.5-flash`** (override with `GEMINI_VISION_MODEL`). It uses function calling with a fixed row schema, the same path as the slow-path reader.
  - `cleanRows()` drops rows with no name, a non-positive amount, or an absurd amount.
  - It uses the same 3 Gemini keys: the rotation loop was pulled out of `llm.ts` into `withGeminiKey()`, shared by both readers.
  - `vercel.json` gives `api/import.ts` 60 s. The local server and the Vite proxy serve `/api/import`.
- **UI:** `src/ui/ImportSheet.tsx`, menu entry, empty-state button, 22 new strings in hi/en/kn/ta/te (`EXTRA4`).
- **Privacy:** the "My data" note now says khata photos go to Gemini to be read.

### Tests added
- `shared/import.test.ts`: lines, advance words, a spoken list with number words, amount first, page headings ignored.
- `server/parse/vision.test.ts`: photo-row clean-up.
- `server/session.test.ts`: import mode sends rows and saves nothing; turning it off goes back to normal.

### Feedback and fixes
_(to be filled in from the owner's testing)_

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
  - **Fonts:** Playfair Display for headings and amounts, Manrope for body text (replaced by Inter in round 1, see "Feedback and fixes"). Indian scripts keep the Noto fonts.
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
2. Open **Console → Try it out → Send a WhatsApp message**. Twilio shows the trial sender number and a join code. **Use the number your console shows.**
   - Accounts created in Nov 2026 get `+1 737 221 2163` with `join twilio-trial`.
   - Older sandboxes use `+1 415 523 8886`.
   - This trial sends only to **one verified tester number at a time** (the one selected in "Select your tester"). Swapping the recipient needs a new join.
3. The tester phone sends **`join <your-code>`** on WhatsApp to the trial number (or scans the QR code). Trial limits:
   - **Only joined numbers get messages.** Twilio error 63015 means the number hasn't joined.
   - **The 24-hour window:** free-form text arrives only within 24 h of that phone's last message to the sandbox. Sending "join …" again, or any message, reopens it.
4. Copy **Account SID** and **Auth Token** from Console → Account Info. Add them to `voice-khata/.env`:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_WHATSAPP_FROM=whatsapp:+17372212163   # the trial number your console shows
   ```
5. Restart `npm run server`. In the app: ☰ → WhatsApp reminders should show "✓ Sent from your Twilio WhatsApp number".
6. **Test:**
   - Open a customer who owes money and enter **the tester number** (the joined one).
   - Turn on Adult + Allow reminders.
   - Tap **Send reminder**. The WhatsApp message should arrive within seconds.
**Found in testing (22 Nov): the new trial sender cannot send our text.**
- **The error:** Twilio's newer **"Try out WhatsApp"** trial sender (`+1 737 221 2163`, `join twilio-trial`) only accepts Twilio's own sample template. A message with our text fails with **21654 "ContentSid Required"**.
- **No way around it on trial:** making our own template needs the Content API, which answers *"not available on a Trial account"*.
- **The ways forward:**
  - **(a) The classic WhatsApp Sandbox, free.** In the Console look for **Messaging → Try it out → Send a WhatsApp message**, or **WhatsApp sandbox settings**. Number `+1 415 523 8886`, with your own two-word code like `join bright-river`. The sandbox accepts free-form text within 24 h of the join, so the app works unchanged. Set `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886` and join from the phone.
  - **(b) Upgrade Twilio** (add credit). Then use the sandbox, or create a template (`TWILIO_CONTENT_SID`, variables {{1}} name, {{2}} amount, {{3}} shop) and get it approved.
  - **(c) For the demo:** the toast's **WhatsApp** button sends the exact reminder from the shop's own WhatsApp, to any number.
- The app now explains 21654 in plain words.

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
**Round 1 (owner, 21 Nov):**

| Feedback | Fix |
|---|---|
| "Where do I enter the customer's number to send a reminder?" | **Customer screen:** a **WhatsApp reminder** box now comes right under the balance: phone (with a +91 prefix), Adult, Allow reminders, a **Send reminder** button, and a line saying what is missing ("Add a phone number first", …) or when the last reminder went. **Dues tab:** every row has its own WhatsApp button; if the number or consent is missing, it opens the customer screen and says what to add. **Edit-entry sheet:** the customer's name links to the customer screen, with a WhatsApp button beside it. |
| Font is funky; ₹ and numbers look bad | Playfair Display and Manrope are gone. Everything is **Inter**, which has its own ₹ and tabular figures, so amounts line up and the symbol matches the digits. Heavy weights (extrabold/black) became semibold/bold. |
| Shop name not aligned with the navbar | The header is now a 64 px bar with a bottom border. The menu button (left) and the language dropdown (right) are both 44 px high; the shop name and the small "KHATABHAI" are centred on the bar itself (absolutely positioned), not between unequal neighbours. |
| "Everything looks like a road sign" | The octagon mic and the 12–30 % cuts caused it. Circles and pills (mic, avatars, switches, chips) are round again. Only boxes, cards, buttons and sheets keep a fine bevel, with radii 4–12 px. |
| Better colours, dark themes, palettes | Five new low-saturation palettes, with no traffic-light red/green: **Ivory & Ink** (default: navy, brass, warm paper), **Sage** (forest, sand), **Rosewood** (wine, champagne), **Midnight Gold** (dark, champagne gold), **Graphite Teal** (dark, muted teal). Credit and paid are muted terracotta and sea green. The picker shows a swatch and a one-line description. Old saved theme ids map to the closest new one. The browser bar colour follows the theme. |

Files: `src/index.css` (palettes, Inter, bevel only on box radii), `src/ui/theme.ts`, `src/App.tsx` (header, dues rows, quick remind), `src/ui/Sheets.tsx` (reminder box), `src/ui/EntrySheet.tsx` (customer link), `src/ui/Menu.tsx`, `src/ui/parts.tsx`, `index.html`. Dependencies: `@fontsource-variable/inter` added; Playfair Display and Manrope removed.

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
