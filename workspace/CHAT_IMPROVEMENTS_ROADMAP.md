# Chat — improvement roadmap (from the Jul 2026 3-agent total analysis)

Legend: ✅ shipped this pass · 🔒 security mini-cutover (needs emulator test + deploy) ·
🧱 large/architectural (staged — do NOT do blindly on the live 5000-line file).

## ✅ Shipped (safe app-code batch)
UX/a11y/perf quick wins in ChatView + PortalChatView — dead composer emoji button,
portal markdown rendering, real presence dots, jump-to-first-unread, aria-labels,
prefers-reduced-motion, timestamp tooltips, Albanian pluralization, dead-control cleanup,
typing-dot contrast, portal auto-grow textarea, portal batched read-receipts.

## 🔒 Security mini-cutover (chat rules) — same class as the tenant-isolation cutover
These chat-adjacent collections were left out of the first hardening. Do with the emulator
tests + ordered deploy (see SECURITY_RULES_CUTOVER_RUNBOOK.md pattern).
- **messages UPDATE** rule: the react/pin/read field-whitelist branch has NO tenant check →
  any signed-in user can mutate any tenant's message by doc id. Add
  `isBusinessMember(resource.data.businessId) || sender/receiver == uid || canAccessClientChannel(channelId)`.
- **messages CREATE** rule: portal clients can post into any `client-<cid>` channel; staff can
  stamp an arbitrary businessId. Require `canAccessClientChannel(request.resource.data.channelId)`
  (client branch) / `canCreateBusinessDoc()` (staff branch).
- **directMessages** rule block: dead + `isAuth()` → remove (or lock to `false`).
- **channels** + **typingIndicators**: `read/write: if isAuth()` cross-tenant. Needs `businessId`
  stamped (channels are backfilled; typing docs are not) + the ChatView queries scoped by
  businessId BEFORE tightening the rule (a broad query + per-doc deny = whole-query failure).
  Model typing as one doc/channel (`typing/{channelId}` map uid→ts) to cut doc count.

## 🧱 Large / architectural (staged, sequence by dependency)

### 1. Counter-based unread + recency model  ← the highest-leverage change
Root cause behind ~4 issues (group-unread-clears-for-all bug, always-on listeners, >200-msg
badge inaccuracy, racy `lastMessageAt`). Today the sidebar streams raw message docs to count
unread. Replace with:
- per-(conversation, user) read cursor: `channelReads/{channelId}_{uid}.lastReadAt`
- maintained `unreadCount` + `lastMessageAt` + `lastMessagePreview` on the conversation doc,
  written transactionally on send / reset on read (server-side or a trigger/cron).
Then the sidebar reads N small docs instead of streaming hundreds of messages. Drops
`allUnreadTeamMsgs`, `recentClientMsgs`, `bgSentDMs`, `bgReceivedDMs` always-on listeners.
Fixes the group-unread bug correctly (stop overloading `isRead` for groups).

### 2. Scheduled messages — server processor (VPS cron)
`chatScheduledMessages` are dispatched by a client `setInterval` → don't fire when the app is
closed, and double-send across tabs (per-tab `firedScheduledRef`, no atomic claim). Add a VPS
cron job (cron lives on the VPS per memory) that transactionally claims (`sent:false→true`) and
sends due messages. Remove/relegate the client interval to a preview only.

### 3. serverTimestamp ordering
Messages use client-clock `createdAt: Timestamp.now()` → clock skew reorders threads; equal-ms
ties are unstable. Switch to `serverTimestamp()` + a stable secondary sort (doc id), handling
the pending-write null window for optimistic display. Touches every `getTimestampMs` site.

### 4. Optimistic send + failed-send retry
Awaiting `messageMutation.create` before the bubble appears feels laggy; offline `addDoc` hangs
with no feedback. Render an optimistic bubble keyed by a client `clientMsgId` (also stored for
snapshot de-dupe) with sending/sent/failed states + inline retry; use `metadata.hasPendingWrites`.

### 5. Cursor pagination + list virtualization
"Load older" re-reads the whole enlarged window (no `startAfter`); a `renderCap=40` slice caps
the DOM. Add cursor pagination (`getDocs` + `startAfter` for history, live listener only on the
newest page) and virtualize with `@tanstack/react-virtual` (do after MessageBubble is extracted).

### 6. File decomposition of ChatView.tsx (5120 lines, 91 useState)
Extract `MessageList` / `MessageBubble` (React.memo) / `Composer` / `ChatSidebar` +
hooks `useChatMessages` / `useChatUnread` / `useChatPresence` / `useChatDirectory`; lazy-load
`ChatAiPanel` / `ChatRequestsPanel` / `GroupManageDialog`. Extract shared helpers
(`safeAttachmentHref`, markdown, attachment render) to `lib/chat.ts` (dedupe with portal).
Enables memoization (keystrokes stop re-rendering the message list) and shrinks the chunk.
Also kills the 3s `nowTick` whole-component re-render by isolating the typing bar as a leaf.

### 7. Feature backlog (product)
Threads panel (`threadRootId` + reply counts), message forwarding, `@here`/`@channel`, full
emoji picker + skin tones (self-hosted, CSP-safe) / GIFs, link previews (OG endpoint, SSRF-safe),
portal parity (search, drag-drop upload, "new messages" divider, jump-to-bottom FAB).
