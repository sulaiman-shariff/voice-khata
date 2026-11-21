# Task 10 report
Branch task10 (from main 413b3d0). Server: Session.sendReplyExtras sends Reply show/setting/ready; force ClientMsg (handleText 4th param `forced`, bypasses needsLlm gate; agent path must disallow not_for_me when forced); tap yes on a requireTap delete arms it (button = tap). Tools: history/today/top_debtors/search/close views; PendingView.amounts from core.amountChoices. Client: ListSheet, ReadyCard, TextAnswer, erase button, Save anyway, setting/ready events in voice.ts.
Note: ServerMsg 'ready' now has two shapes (region greeting, and kind card); client tells them apart by 'kind' in m.

## Fix round 1
- CRITICAL: removed the tap-arms-erase line; PendingView.armed (from spokenYes); erase button disabled with "say haan first" until armed. Tests: tap alone does not erase; spoken haan arms (armed:true), next tap erases.
- Ready card shows "To: name · phone" or "no number saved" note; cleared on any show, pending or the next final.
- Save anyway restructured as flex row (quote min-w-0 truncate, badge and button shrink-0); seen at 390px with a long line.
- show_history carries cid; ListSheet filters by it. top_debtors carries count; search carries cids/eids (the server's matches). Recent amounts newest first.
- force: clears any open question first, never silent (didNotCatch). Tests: identical text 'bhaiya do kilo cheeni dena' 0 model calls before, 1 after, and the forced turn speaks; a chatter-then-force line writes after the read-back; force during an open question writes the new line.
- Deviation: the model cannot place an amount for the cheeni line (no amount heard), so the "writes the entry" assertion uses a second line where the first model call said chitchat.
- Output: `npx tsc -b` exit 0, no output. `npx vitest run`: 22 files passed, 370 passed, 6 skipped.
- Browser (390x844, fake WebSocket server, not the real voice server): saw Save anyway beside the badge with a long heard line, the WhatsApp card with recipient and note, the erase button disabled with the hint. Not seen: the armed (enabled) erase state, and history/search/top_debtors lists with data.
