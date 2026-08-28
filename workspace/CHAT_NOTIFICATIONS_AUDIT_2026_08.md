# Chat notifications — audit & fixes (Aug 2026)

Scope: every hop a chat notification takes — creation (`ChatView`, `PortalChatView`),
the browser choke point (`useMutation('notifications')`), the server delivery path
(`/api/send-notification-email` → `api/_push.ts`), the FCM service worker, and the
three surfaces that alert the user (bell, Sidebar, ChatView).

Nine bugs were found. All nine are fixed; the table records what the fix was and what
still needs a deploy.

| # | Bug | Status |
|---|---|---|
| 1 | Web push deep-link lost — two racing `notificationclick` handlers | ✅ fixed |
| 2 | Group-channel messages produced NO notification at all | ✅ fixed |
| 3 | `soundEnabled` / DND / category mute ignored by the chat surfaces | ✅ fixed |
| 4 | `@mention` did not check channel membership (leak + dead link) | ✅ fixed |
| 5 | Push fired even while the recipient was looking at that conversation | ✅ fixed |
| 6 | Every single DM sent its own email | ✅ fixed |
| 7 | `limit(200)` with no `orderBy` → arbitrary 200 unread, bell never cleared | ✅ fixed |
| 8 | `staff_message` deep-link dropped the project channel | ✅ fixed |
| 9 | Deleted/edited message left a stale notification | ✅ fixed |

---

## 1. Web push deep-link lost — two racing `notificationclick` handlers

`api/_push.ts` always sends a `notification` block, so **the Firebase SDK displays the
notification itself** and registers its OWN `notificationclick` listener (it navigates
to `webpush.fcmOptions.link`). That listener is installed by `firebase.messaging(app)`
— i.e. BEFORE ours, which sits at the bottom of the file.

An SDK-displayed notification carries its payload under the `FCM_MSG` key, so
`event.notification.data.url` is `undefined` and our handler fell through to its `'/'`
fallback. Two navigations then raced: the deep-link and the dashboard. With no window
open, BOTH handlers called `openWindow` → two tabs.

**Fix** (`sw/firebase-messaging-sw.js`): our handler returns immediately when
`data.FCM_MSG` is present or `data.url` is missing. It now owns only the data-only
notifications it displays itself.

## 2. Group-channel messages produced NO notification

In `ChatView.handleSendMessage` the `targetMode === 'channel'` branch only notified
(a) `mentions` and (b) the portal client of a `client-*` channel. `CHANNELS` is empty
— every non-client channel is a **group** (`channels.isGroup` + `members[]`) — so a
message in a group reached nobody: no bell, no push, no email. `Sidebar`'s badge did
not count it either (it counts DMs and `senderType === 'client'` only), so the whole
thing was invisible the moment the chat page was closed.

**Fix**: a new registered type `channel_message` goes to `channel.members` minus the
sender (capped at `MAX_CHANNEL_NOTIFY = 25`; anyone already notified by a mention is
excluded so nobody gets two rows for one message), and `Sidebar` now counts unread
group messages via `readBy`.

**The fan-out is ONE server call, not one per member** — a documented exception to the
"browser writes the notification, the choke point relays it" rule, and the reason for
it is the rate limiter. That relay fires once per notification DOCUMENT and is capped
per CALLER at 300/hour, so a chatty 25-person channel would have burned a user's whole
budget and then silently dropped their task/invoice notifications too. So
`channelFanout` in `api/_send-notification-email.ts` writes every document itself via
`notifyUser()` and counts as a single unit. It is also the stricter half: **the channel
document is the authority** — the caller must be a member, every target is intersected
with `members`, and `businessId`/`teamId` come from the channel, never from the request
body.

## 3. `soundEnabled` / DND / category mute ignored by the chat surfaces

`ChatView.playBirdChirp` and `Sidebar.playNotificationSound` never read
`userPreferences` at all — the "Tingull" switch in Cilësimet did nothing for chat and
both rang inside a DND window.

The mirror image also existed: `NotificationsCenter` deliberately skipped its chime for
chat types ("the chat UI does it"), but the Sidebar chime only covers DMs and client
messages — so an **`@mention` made no sound anywhere** unless the chat page happened to
be open.

**Fix**: `useNotificationPrefs()` (`src/hooks/useNotificationPrefs.ts`) is now the one
gate — live `userPreferences` + `isInDndWindow` + `isTypeMutedByPrefs` — used by
ChatView, Sidebar and the bell. Ownership of the sound is explicit: on `/app/chat` the
ChatView chirp owns it; anywhere else the bell chime does. That is why the suppression
is keyed on the ROUTE now, not on the notification type.

## 4. `@mention` did not check channel membership

`mentionCandidates` was built from `otherMembers` (the whole business) and the notifier
only filtered out the sender. You could mention a non-member of a private group: they
got a push with 100 characters of the message and a `linkTo` pointing at a channel the
Firestore rules forbid them to read.

**Fix**: `channelMemberIds()` resolves the audience of the active channel (group →
`members`, client channel → staff), the mention picker offers only those, and the
notifier intersects `mentions` with it before writing anything.

## 5. Push fired while the recipient was in the conversation

The notification was written by the sender with no presence check. The bell entry was
auto-dismissed on open, but the push had already buzzed the recipient's phone while
they were typing a reply in the web app.

**Fix**: the ChatView heartbeat stamps `activeConversationKey` +
`activeConversationAt` onto `userPreferences/{uid}` — **the same document the delivery
path already reads**, so this costs no extra read. Every chat notification carries a
`conversationKey`; `api/_push.ts` `isViewingConversation()` skips push + email (never
the bell document) when the key matches and the stamp is younger than
`PRESENCE_FRESH_MS` (2 min). Fail-open: no stamp → deliver.

## 6. Every single DM sent its own email

`emailEnabled` is all-or-nothing and category mute silences push too, so a 30-message
conversation meant 30 emails — and it burned the 300/hour relay budget, after which
notifications were dropped with only a `console.warn`.

**Fix**: `shouldThrottleCategoryEmail()` in `api/_push.ts` throttles EMAIL only (bell +
push are untouched) for the `messages` category to one per `MESSAGES_EMAIL_THROTTLE_MS`
(15 min) per recipient, keyed in `notificationThrottle/{uid}`. A missing/failed read
fails OPEN (email sent). Both delivery paths — the browser relay and `notifyUser()` —
share it.

## 7. `limit(200)` with no `orderBy`

The auto-dismiss query in ChatView and PortalChatView was `userId + isRead` with
`limit: 200` and **no `orderBy`** — Firestore then returns 200 docs by `__name__`, i.e.
an arbitrary subset. Past 200 unread rows, opening a conversation no longer cleared its
bell entry.

**Fix**: each now uses exactly the shape its own bell already uses — `userId` +
`orderBy createdAt desc`, `limit 100` in ChatView (NotificationsCenter) and `limit 50`
in PortalChatView (PortalNotificationsBell) — and filters `isRead` client-side. Same existing
index `notifications(userId ASC, createdAt DESC)`, and — because the module-level
listener cache keys on the query shape — it **shares the bell's listener instead of
opening a second one**.

## 8. `staff_message` deep-link dropped the project channel

The notification carried the right `linkTo` (`client-<cust>-project-<proj>`) but a
generic `actionUrl: '/portal/chat'`, and the choke point prefers `actionUrl` — so a
push about a project thread opened the portal's default conversation.

**Fix**: `actionUrl` now carries `?project=<projId>`, and PortalChatView selects that
project on arrival (then strips the param so a reload does not re-trigger).
`PortalNotificationsBell` keeps the channel too.

## 9. Deleted/edited message left a stale notification

The Firestore rules let only the RECIPIENT touch a notification (`isRead`/`readAt`), so
the sender structurally cannot clean up after `handleDeleteMessage`. The bell kept
showing the text of a message that no longer exists.

**Fix**: chat notifications now carry `messageId`, and the recipient's ChatView dismiss
pass also clears any unread chat notification whose `messageId` refers to a message it
can see as `deletedAt`. Editing is covered by the same field for future readers.
Related: the client-channel notification used `effectiveText` instead of `finalText`,
so a `/me` action was sent verbatim — it now uses the rendered text like every other
path.

---

## Deploy / follow-up

- **No index deploy.** #7 deliberately reuses the existing
  `notifications(userId, createdAt DESC)` index — that is why it matched the bell's
  query shape instead of adding `isRead` to an orderBy.
- **Rules: optional.** `firestore.rules` gained an explicit
  `match /notificationThrottle/{userId} { allow read, write: if false; }`. Firestore
  already denies an unmatched collection, so behaviour is identical without the
  deploy — the rule is there to state the intent (Admin SDK only) next to the others.
  It rides along with the next `firebase deploy --only firestore:rules`.
- `npm run android:sync` after this lands (standing rule — keeps the Android bundle
  current), and the service-worker fix (#1) only takes effect for web clients after a
  new build, since `/firebase-messaging-sw.js` is generated by `vite build`.
- Not done (deliberate): batching several chat notifications into ONE bell row, and a
  digest email for the `messages` category. #6 throttles instead, which keeps every
  push while cutting the email storm.

---

# Second pass — after the nine fixes shipped

Re-audited the same path once the fixes were live. One regression the fixes
themselves introduced, and one older bug they exposed.

| # | Bug | Status |
|---|---|---|
| 10 | Two chimes for one DM — the fixes created a second sound owner | ✅ fixed |
| 11 | A group channel's unread badge is wrong for everyone but the first reader | ⬜ OPEN |
| 12 | `/api/notify-staff` does not pass `conversationKey` | ⬜ open (minor) |

## 10. Two chimes for one DM (regression from fix #3)

Fix #3 had to stop the bell from suppressing chat types — an `@mention` made no
sound anywhere while the chat page was closed. But `Sidebar` still chimed on every
increase of `unreadChatCount`, so off `/app/chat` a DM or client message fired BOTH
chimes, from the same Firestore snapshot burst, in near-identical two-tone voices.

**Fix**: the Sidebar chime is gone; the badge stays. Sound now has exactly one owner
per route — the ChatView chirp on `/app/chat`, the bell everywhere else. The bell is
the better trigger anyway: it fires on the notification DOCUMENT, which the server has
already filtered through `pushEnabled`/DND/mutes and the presence check. A badge with
no notification behind it is exactly the case where the system chose not to interrupt.

The bell's chime gate also moved to LIVE preferences (`useNotificationPrefs`); its
`localPrefs` is a one-time `getDoc` that backs the preferences panel, so as the sole
sound owner a `soundEnabled` toggled in Cilësimet would not have taken effect until a
reload.

## 11. A group channel's unread badge is wrong for everyone but the first reader — OPEN

`markAsRead` writes `{ isRead: true }` unconditionally for a channel message, and
`readBy: arrayUnion(uid)` only in addition to it (`ChatView`, the channel branch). But
`isRead` is a SINGLE shared flag on a document read by many people, so the first member
to open a group channel flips it for everyone — and the row then leaves the
`isRead == false` query that every badge is built on:

- `channelUnreadMap` (ChatView, pre-existing) — counts `allUnreadTeamMsgs` without
  looking at `readBy` at all, so it both loses rows this way AND counts rows the user
  has already read.
- the Sidebar group count added in fix #2 — filters on `readBy` correctly, but cannot
  see a row the query has already dropped.

So `channel_message` notifications now arrive correctly (fix #2) while the badge beside
them can read 0. Two candidate fixes, and the choice is a real trade-off:

- **Cheap**: stop writing `isRead` for group channels (`readBy` becomes the only read
  state) and teach `channelUnreadMap` to filter on `readBy`. Correct per member, but
  those rows then stay `isRead == false` forever, and the badge queries are capped at
  the 200 newest unread — in a busy tenant, already-read group messages would crowd out
  DM and client rows and under-count those badges instead.
- **Correct**: per-user `lastReadAt` per channel (a `channelReads/{uid}_{channelId}`
  doc), counting messages newer than it. No shared flag, no cap problem, and it is the
  model the read-receipt UI already implies — but it is a data-model change with its own
  migration and touches every unread reader.

Not chosen unilaterally: the cheap fix trades one wrong badge for another, and the
correct one is a design decision.

## 12. `/api/notify-staff` does not pass `conversationKey` — open (minor)

The client → staff path (`api/_notify-staff.ts`) calls `notifyUser()` with `linkTo` but
no `conversationKey`, so fix #5's presence check cannot apply: a staff member reading a
portal conversation still gets pushed for the client's next message. The key is
`ch:<channelId>` and the endpoint already has the channel id — a one-line change, left
out here only because it is a different endpoint from the ones this pass touched.
