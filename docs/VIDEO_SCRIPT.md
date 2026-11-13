# Voice Khata: 2:30 demo video script

Rule for this video: the narration describes only what is on screen at that moment. If a line mentions a feature, that feature is visible during the line. Spoken lines in quotes are what the shopkeeper says to the phone; keep the shop noise audible under them.

Target length 2:30. Narrator speaks at a calm pace, about 2.3 words per second. Numbers in the narration are the measured ones in the README; do not round them up.

## Shot table

| Time | On screen | Narration |
|---|---|---|
| 0:00 - 0:10 | Real kirana counter, handheld, customers talking, a paper khata notebook open next to the till. Cut to a close shot of the notebook with crossed-out figures. | "In a kirana shop, credit lives in a notebook. The owner is serving someone, hands busy, and the amount gets written late or wrong." |
| 0:10 - 0:22 | Phone on the counter, screen on the language tile page. Finger taps the Hindi tile, then the mic. The first-run screen shows the AI disclosure text while the voice speaks. Shop noise audible. | "This is Voice Khata. You pick your language once and tap the mic. The first thing it says is that it is an AI, and that the ledger stays on this phone." |
| 0:22 - 0:34 | Same phone. Owner says "Ramesh ka 340 udhaar." Live transcript appears word by word at the top, then a card for Ramesh with 340 in large numerals and a toast with an Undo button. Chime plays. | "Ramesh ka 340 udhaar. The words appear as he speaks. The entry is saved as credit for Ramesh, 340 rupees, and it reads it back. There is an undo button on screen." |
| 0:34 - 0:44 | Owner says "Anil ne 150 diye." Anil card appears with a payment entry of 150, balance shown. | "Anil ne 150 diye. The word 'ne' marks a payment, so this is recorded as money received, not credit." |
| 0:44 - 0:54 | Owner says "Nahi, 430." The Ramesh card changes from 340 to 430. The audit list under the card shows the original 340 entry kept and a new amended entry. | "Nahi, 430. The last entry is corrected to 430. The old value stays in the audit trail, so nothing is silently overwritten." |
| 0:54 - 1:07 | Owner says "Suresh ne saath diye." Screen shows a confirm card with two big buttons, 60 and 7, while the voice asks "60 ya 7?". Owner answers "Sixty." Card resolves to a payment of 60 for Suresh. | "Saath can mean 60 or 7, and in a noisy shop they sound the same. So it asks: sixty or seven? He answers sixty, and only then is it saved." |
| 1:07 - 1:17 | Owner says "Ramesh ka total?" The Ramesh card is highlighted with 430. The voice answers aloud. A stopwatch overlay starts at the end of the owner's sentence and stops at the first audio. | "Ramesh ka total? The answer starts in under a second. On production the median from end of speech to first audio was 729 milliseconds." |
| 1:17 - 1:27 | Full-screen zoom on the latency waterfall for that turn: bars for speech end, commit, final transcript, parse, first audio. Labels visible. | "This bar chart is that same turn. The app sends Gnani's commit signal about 280 milliseconds after the pause, instead of waiting for the silence timer. Parsing runs on the live partial text." |
| 1:27 - 1:37 | Owner taps "Aaj ka hisaab" (or says it); the voice starts a long summary. Owner talks over it with "Suresh ne 100 diye." Audio meter shows volume ducking, then playback stops, and the new entry card appears. | "Barge-in. While it reads the day's summary, the owner talks over it. The voice ducks, then stops, and the new entry is taken straight away." |
| 1:37 - 1:49 | Owner opens language selection, taps Kannada tile. Mic on. Owner says a Kannada entry (for example "ರಮೇಶ್ ಅವರಿಗೆ 200 ರೂಪಾಯಿ ಉಧಾರ"). Transcript shows Kannada script, card shows 200, and the voice replies in Kannada. | "Switching to Kannada. Same flow: the transcript is in Kannada, the amount is 200, and the reply is spoken in Kannada. There are 10 languages in total." |
| 1:49 - 2:00 | Owner opens the "Mera data" privacy panel. It shows: stored on this phone, encrypted; a per-customer key list; the audit chain with a "verified" status; a "forget this customer" button. Owner taps forget on one customer; the entries vanish and the chain still shows verified. | "The ledger is stored on the phone, encrypted, with a separate key for each customer. Forgetting a customer deletes their key. Their entries become unreadable and the audit chain still verifies." |
| 2:00 - 2:10 | Customer detail for Ramesh, with the "reminders allowed" toggle turned on and an adult confirmation. Owner taps Remind. The WhatsApp share sheet opens with a polite message that names the shop and the amount. | "Reminders are opt-in. Only when a customer has agreed, and is an adult, can the owner send a polite message. It opens as a WhatsApp share. Nothing is sent automatically." |
| 2:10 - 2:30 | Static slide on a plain background with a small table from the README, built from measured results only: 7 of 7 correct turns on production; first audio p50 729 ms, max 774 ms; exact amount 12/12 at 15, 10, 5 and 0 dB for street, cafeteria and square noise; Hindi four-talker babble 12/12 at 10 and 5 dB, 9/12 at 0 dB; 298 unit tests. Last frame: repo and hosted URL, team names, Atria Institute of Technology. | "We tested it. On production, a Hindi conversation was seven for seven. Amounts were exact at 15 down to 0 decibels of street, cafeteria and public-square noise. With four people talking, it was exact at 10 and 5 decibels and 9 of 12 at 0. Below that we say so, and the app asks before saving. Voice Khata: a ledger that listens, and stays on the owner's phone." |

## Notes for the editor

- In the 0:54 - 1:07 shot the owner says "Suresh ne saath diye", the agent asks "60 ya 7?", and the owner answers "Sixty" in English so the answer cannot be confused again. Rehearse this once with the real noise loop and keep the narration "He answers sixty".
- Do not add any claim that is not in the README evaluation section. The full multilingual noisy end-to-end table is still a TODO there; leave it out of the video until it is filled.
- Narration at 1:07 uses the measured production median. If the recorded take shows a different number on the waterfall, say the number on screen.
- No music over the narration. A quiet shop ambience bed at low volume is fine.

## Recording checklist and shot list

Before recording
- [ ] Production build at https://voice-khata-delta.vercel.app, not localhost.
- [ ] Phone charged, do-not-disturb on, screen brightness high, screen recording enabled (with audio from the phone speaker captured by a second device, or a clean capture of system audio).
- [ ] Fresh install or cleared site data so the first-run AI disclosure plays on camera.
- [ ] Ledger empty, except what the script needs. No real customer names or numbers; use Ramesh, Anil, Suresh, or other made-up names.
- [ ] Play a real shop-noise loop (street or cafeteria, low) from a speaker near the phone so the noise is real, not added in the edit.
- [ ] Mic permission already granted; test the mic once.
- [ ] The latency waterfall setting is visible and legible at phone width; check the zoom shot is sharp.
- [ ] Rehearse each spoken line three times; each demo line must work on the first take on camera, or cut to the clean take.

Shots to capture (each as a separate clip so it can be matched to its narration)
1. Kirana counter b-roll with paper notebook (10 s).
2. Language tiles, tap Hindi, tap mic, AI disclosure voice and text.
3. "Ramesh ka 340 udhaar": live transcript, card, toast with Undo, chime.
4. "Anil ne 150 diye": payment card.
5. "Nahi, 430": card change and audit list with the original entry still present.
6. "Suresh ne saath diye": confirm card with 60 and 7 buttons, spoken question, the answer, saved entry.
7. "Ramesh ka total?": answer audio with a stopwatch overlay added in the edit.
8. Waterfall full-screen for the same turn (screenshot or a screen recording freeze-frame of that turn).
9. Barge-in: long summary, interruption, ducking, stop, new entry.
10. Kannada: language switch, Kannada entry, Kannada voice reply.
11. Privacy panel: encrypted, per-customer keys, chain verified, forget customer, chain still verified.
12. Reminder: opt-in toggle, Remind tap, WhatsApp share sheet with the polite text.
13. Closing results slide and end card (URL, repo, team).

After recording
- [ ] Watch the cut once with the sound off: every on-screen feature should be obvious without narration.
- [ ] Watch once with only narration: every claim should be something you saw on screen in that second.
- [ ] Total length between 2:20 and 2:30. Export 1080p, MP4.
- [ ] No API keys, `.env` contents or browser tabs with private data visible.
