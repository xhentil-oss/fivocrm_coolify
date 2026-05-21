# Chat → Enterprise Roadmap (May 2026)

Targeti: ta çojmë `ChatView` në nivel Slack/Linear, përshtatur për agjensi marketingu.

Legjenda: ✅ done · 🟡 partial · ⬜ pending

## Wave 1 — Siguria & Performanca

| # | Item | Status |
|---|---|---|
| 33 | Firestore rules: DM lexohet vetëm nga sender/receiver | ⬜ |
| 32 | Batched read receipts me `writeBatch()` | ✅ |
| 27 | Virtual scrolling (react-virtual) | ⬜ |
| 28 | Cursor pagination me `startAfter()` | 🟡 |
| 31 | Split `ChatView.tsx` në `<MessageList>`, `<Composer>`, etc. | ⬜ |

## Wave 2 — Workflow Wins (high impact, low risk)

| # | Item | Status |
|---|---|---|
| 7 | Drafts auto-save per conversation (localStorage) | ✅ |
| 6 | Saved replies / Snippets | ✅ |
| 8 | Bookmarks / Save for later | ✅ |
| 5 | Snooze / Remind me | ✅ |
| 3 | Message → Task në një klik | ✅ |
| 2 | Slash commands `/task` `/quote` `/remind` `/invoice` | ✅ |
| 4 | Scheduled messages | ✅ |
| 1 | Threads | ⬜ |
| 13 | `@@Customer` mention → lidh me Customer360 | ✅ |

## Wave 3 — Marketing Agency Magic

| # | Item | Status |
|---|---|---|
| 9 | Client channels me Guest role | ⬜ |
| 10 | Brief/Approval flow inline (Aprovo / Ndrysho) | ⬜ |
| 11 | Asset preview (Figma/Drive/Canva/Loom OG cards) | ⬜ |
| 12 | Campaign tagging `#fushata-X` + filter | ⬜ |
| 50 | WhatsApp unified inbox (Meta + Baileys) | 🟡 |

## Wave 4 — AI Edge

| # | Item | Status |
|---|---|---|
| 19 | AI summary i bisedës (OpenAI) | ✅ |
| 24 | Action extraction → propozim Task | ✅ |
| 21 | Smart Reply suggestions | ✅ |
| 25 | Daily digest mëngjesi (cron) | ⬜ |
| 23 | Tone polish ("më formal / më miqësor") | ✅ |
| 22 | Auto-translate sq ↔ en ↔ it | ✅ |

## Wave 5 — Polish & Enterprise

| # | Item | Status |
|---|---|---|
| 17 | Search filters (from:, in:, has:link, date) | ✅ (basic) |
| 39 | Keyboard nav + `Cmd+K` channel switcher | ✅ |
| 35 | Audit log (delete/edit) | ⬜ |
| 37 | PDF export i bisedës me klient | ⬜ |
| 36 | Retention policy (auto-delete DM >90d) | ⬜ |
| 38 | Permission roles në kanal (Owner/Admin/Member/Guest) | ⬜ |
| 18 | Pinned per-customer (3-5 fakte) | 🟡 |
| 20 | Knowledge base nga pinned messages | ⬜ |
| 26 | Sentiment alert për Account Manager | ⬜ |
| 29 | Optimistic UI në send | 🟡 |
| 30 | Offline queue | ⬜ |
| 40 | Drag & drop kudo në dritare | ⬜ |
| 41 | Multi-file paste (screenshots) | 🟡 |
| 42 | Inline edit me histori versionesh | ✅ |
| 43 | Reaction shortcuts | ✅ |
| 44 | Compact mode | ✅ |
| 45 | Status custom (OOO, In meeting) | ✅ |
| 46 | Huddles / Quick voice (WebRTC) | ⬜ |
| 47 | Meta Ads alerts në kanal | ⬜ |
| 48 | Google Analytics weekly digest | ⬜ |
| 49 | Calendar sync nga mesazhi | ⬜ |
| 34 | Encryption-at-rest për fusha të ndjeshme | ⬜ |
