# Contract Negotiation Platform: Build Progress

30 September 2026. **Phases 1–7 complete. Phases 8–9 remaining.**

1. [Summary](#1-summary)
2. [Decisions log](#2-decisions-log)
3. [Completed phases](#3-completed-phases)
4. [Remaining phases](#4-remaining-phases)
5. [Known limits and follow-ups](#5-known-limits-and-follow-ups)
6. [Running it locally](#6-running-it-locally)

---

## 1. Summary

The platform lets two organisations draft and negotiate a contract together, taking turns to mark it up until every change is resolved, then sign it.

| Phase | What it covers | Status |
|---|---|---|
| 1 | Database, login, email | Done |
| 2 | Contracts, invites, organisation names | Done |
| 3 | Editor, edit lock, Word upload | Done |
| 4 | Send, turns, versions, history | Done |
| 5 | Tracked changes, accept/reject, server checks | Done (as 5a + 5b) |
| 6 | Comments, chat, live updates | Done |
| 7 | Upload diffing, version restore | Done |
| 8 | AI questions and explanations | Not started |
| 9 | Ready to sign, e-signature, export | Not started |

### Technology in use

| Part | Technology |
|---|---|
| API | NestJS 12, TypeScript, Prisma 7.10, PostgreSQL 17, Redis 7 |
| Web | React 19, Vite, Tailwind 4, TipTap 3, Radix UI |
| Word conversion | Python 3 with python-docx (`converter/`) |
| File storage | Cloudflare R2 (S3-compatible) |
| Email | Console log in development, Resend in production |

---

## 2. Decisions log

Every question raised during the build and the answer given, in order.

| # | Area | Question | Decision |
|---|---|---|---|
| 1 | Setup | Which database: the MongoDB code already in `api/`, or the spec's PostgreSQL + Prisma? | PostgreSQL + Prisma. Old Mongo schemas and auth code deleted to start clean. |
| 2 | Setup | Keep the separate git repo inside `api/`? | Removed (moved to a backup); one repo for everything. |
| 3 | Spec gaps | How long before an idle editor loses the edit lock? | 1 minute of inactivity. |
| 4 | Spec gaps | What is the real-time connection for, and which technology? | Pushes chat, comments, lock status and turn changes to open pages. Chosen: Server-Sent Events (SSE), one stream per side. |
| 5 | Spec gaps | Recall: can the sender pull a contract back? | Recall removed entirely. |
| 6 | Spec gaps | Add "Ready to sign" and "Signed" emails? | Yes, to both sides. |
| 7 | Spec gaps | Which e-signature provider? | Not decided. No provider code until one is chosen. |
| 8 | Spec | Update the spec .docx with these decisions? | Done. |
| 9 | Phase 2 | If the inviter types a teammate's name, is that person still asked "What's your name?" on first login? | No. The inviter's name is kept; anyone can edit their own name by clicking it in the header. |
| 10 | Design | Which visual direction? | "Paper document": cool grey desk, white paper sheets, Newsreader serif, dark blue actions, red/green redlines as the one bold element. |
| 11 | Phase 3 | Where are uploaded Word files stored? | Cloudflare R2, bucket `contract-negotiation`. Token needs Object Read & Write on that bucket. |
| 12 | Phase 3 | Is a Python program OK for Word conversion? | Yes: small Python service using python-docx. |
| 13 | Layout | How should the contract workspace be arranged? | Sidebar on the **right** (overrides spec's "left"). Tabs Changes · Comments · Chat · AI, one at a time, default Changes. **People** opens a window (internal + external people) with an **Invite** window. **History** and **View** are dropdowns. |
| 14 | Phase 4 | Does the counterparty get an invite email when the contract is created? | No. Only teammates get invites when added. The counterparty's first email is the send email; its link signs them in with an email code. |
| 15 | Phase 4 | Restore an old version now or later? | Later (Phase 7), since it needs the comparison engine to show redlines. |
| 16 | Phase 5 | When can someone accept/reject the other side's changes? | Only on their own turn. (Answered "A", taken as option 1; confirm if option 2 was meant.) |
| 17 | Phase 5 | Build Phase 5 in one go or split? | Split into 5a (tracking, views) and 5b (accept/reject, list, server checks). |
| 18 | Process | How should work proceed after a plan? | Always wait for explicit go-ahead. Ask in plain words with short numbered choices. |
| 19 | Phase 6 | Can people edit/delete their own comments and messages? | Yes, any time. Edited shows "(edited)". Deleted leaves a "Message deleted" note (author and time kept, text gone). |
| 20 | Phase 6 | Who can resolve a comment thread? | Anyone who can see it: either side for Shared, only the owning side for Internal. Shows who resolved it and when; anyone who can see it can reopen. |
| 21 | Spec | Add decisions 19–20 to the spec .docx? | Done (§8.1 and data model). |
| 22 | Phase 6 | How are text comments anchored? (Spec's comment mark in the document would reveal internal comments to the other side, and be wiped when the other side saves.) | Stored separately: quoted text + a little context either side; the page finds and highlights it; not found → Outdated. Spec updated. |
| 23 | Phase 6 | Comment while editing? Delete from reading mode? | Reading: highlight shows **Comment \| Edit** on your turn (Edit keeps the highlight so Delete works), **Comment \| Alice is editing** if a teammate edits, **Comment** only otherwise. Editing: no popup; **Comment** in the toolbar + Ctrl/Cmd+Alt+M; only saved text ("Save your edits first…" otherwise). |
| 24 | Phase 7 | Similarity threshold for "same paragraph, edited"? | 50% of words shared, to be tuned on real contracts. |
| 25 | Phase 7 | What does restoring a version bring back? | Your own side's proposals in that version applied, the other side's undone. |
| 26 | Phase 7 | Tables: what happens on accept? | Deleted text in a cell → cell left empty. All text in a row deleted → accepting removes the row; same for a column. Already-empty rows/columns kept; merged-cell tables only empty cells. |
| 27 | Phase 7 | Removed list items / table rows in an upload? | Shown in their own bullet / row. Removed table columns in an upload: later (full table matching). |

### Technical choices made along the way

| Topic | Choice |
|---|---|
| Login session | httpOnly cookie, because the browser's SSE connection can't send custom headers. |
| Who sees the working draft | Only the side whose turn it is. The other side sees the last sent version (nothing before the first send). Fixed a leak found in Phase 3. |
| Sending while someone edits | Blocked ("Save or cancel your edits" / "Carol is editing. Ask them to save first."). |
| Where accept/reject happens | On the server, directly on the saved document data (no shared editor code between web and API). |
| Checking saves after first send | Saved doc must equal the previous one once the saver's own pending changes are undone. Formatting and paragraph breaks allowed; anything else refused. |
| Upload after first send | Compared with the agreed text: the current draft with the uploader's own pending changes undone. (The spec says "last sent version", but that still holds the other side's since-resolved marks.) Blocked while the other side has unresolved changes. Replaces the uploader's earlier pending changes. |
| Restore | Takes the version with your side's proposals applied and the other side's undone (decision 25), then works like an upload. Your turn only, nobody editing, other side's changes resolved first. Logged as VERSION_RESTORED; restoredFromVersionId not set yet. |
| Upload before first send | Replaces the draft. On "Start a contract" the name comes from the document if left blank. |
| Word tracked changes/comments in uploads | Insertions kept, deletions dropped; comments dropped with a notice. |
| Routing & packages | Few lines of routing in `App.tsx`, no router package. New packages only where needed: Prisma, pg adapter, @nestjs/config, redis, AWS S3 client, python-docx. |
| Email | Existing mail module kept: "log" prints emails to console in dev; Resend for real sending. |
| Limits | 25 MB per Word file; 5 MB per saved document. |
| Shared comments on unsent text | Refused ("The other side can't see this yet"): a shared thread may only quote text or changes in the last sent version, so it can't leak the draft. Internal is always allowed. |
| Live update messages | Carry only what to reload (contract, document, lock, comments, chat); the page refetches through the filtered API. Internal activity is only pushed to its own side. |
| Outdated | Worked out by the page, not stored: text threads whose quote is gone, change threads whose change is no longer pending. |

---

## 3. Completed phases

### Phase 1: Foundation
**Goal:** database, data model, passwordless login, email.

- **Database:** PostgreSQL via Prisma 7.10. Every table from spec section 13, plus `Session`. `docker-compose.yml` runs Postgres (later Redis).
- **Passwordless login:**
  - `POST /auth/request-code` emails a 6-digit code (hashed with scrypt, 10-min expiry, 5 wrong tries max, 5 codes/hour).
  - `POST /auth/verify-code` creates the user on first login and sets an httpOnly session cookie.
  - Also `/auth/logout`, `GET /auth/me`, `PATCH /auth/me` (set name).
- **Wiring:** config, Prisma, mail modules; CORS for the web app with cookies.

**Checked:** API tests for wrong/reused code, logout, attempt limit, hourly limit.

### Phase 2: Contracts and invites
**Goal:** create a contract, invite people, manage organisation names.

- **Start a contract:** title, both org names, counterparty email, optional teammates (email required, name optional). Starts as Draft, proposer's turn.
- **Invite links:** token hashed, bound to one contract + email, 7-day expiry, reusable. Link alone never logs anyone in. `GET /invites/:token` (public), `POST /invites/:token/accept` (email must match).
- **Team invites** per side; an email already on the other side is refused.
- **Counterparty rename** of its own org, logged in the activity log.
- **Contracts list/detail**, visible only to people on the contract (others get 404).
- **Security fix:** titles and names escaped in email HTML.
- **Web:** homepage, login (email → code → name), contracts list, start-contract form, invite page (not signed in / wrong account / right account).
- **Name editing:** click your name in the header.

**Checked:** API tests + two-user browser test.

### Design pass: "paper document"
- Grey desk background, white paper sheets, underlined fill-in fields, Newsreader serif, dark blue buttons.
- Homepage opens with a clause being redlined (30 struck red, 45 green) and three steps: Draft or upload, Take turns, Sign.
- Removed leftover Vite starter styles overriding the fonts.

**Checked:** screenshots at desktop and phone width.

### Phase 3: Editor before the first send
**Goal:** edit and save the draft, one editor per side, Word upload.

- **Editor:** existing TipTap editor now takes contract content, read-only mode, change callback. Edit → Save.
- **Edit lock (Redis):**
  - 1-minute expiry, renewed every 20 s while the person is active.
  - Teammates see "Alice is editing" + **Take over**; the person taken over gets "Carol is editing. Your unsaved changes were discarded."
  - Freed on Save, Cancel or inactivity.
- **Word upload:** `converter/app.py` handles headings, bold/italic/underline, alignment, nested lists, tables; accepts Word insertions, drops deletions, detects comments. Originals stored in R2 under `uploads/`.
- **Start from a Word file**, name taken from the document.
- **Clear errors** for storage failures and unreadable files.

**Checked:** converter on sample + spec doc; lock API tests; browser test of edit/save/take over/upload; real R2 upload confirmed.

### Workspace layout
- Top bar: title, status, whose turn, People, History, View (later Send).
- Document in the middle; sidebar on the right with Changes · Comments · Chat · AI.
- People window (your side / other side, pending invites) with Invite window and counterparty rename.
- Contract page code split into `web/src/pages/contract/`.

**Checked:** browser test of tabs, dropdowns, windows, phone layout.

### Phase 4: Turns and versions
**Goal:** send back and forth with a saved version each time.

- **Send button** + confirm window. One transaction: numbered version, hand over turn, status (Draft → With counterparty ⇄ With proposer), activity log. Two simultaneous sends can't both succeed.
- **Send email:** joined people get a direct link; not-yet-joined people (counterparty on first send) get a sign-in link.
- **Top bar:** "Your turn" / "Waiting for Beta to respond". Pages check every 15 s until live updates arrive.
- **History:** real versions ("Version 2, sent by Beta on 30 Sep 2026"), read-only view with Back to current.
- **People:** counterparty shows "Gets it when you send" before first send.

**Checked:** API tests (blocked/simultaneous sends, emails, versions) + two-user browser test.

### Phase 5a: Tracked changes while editing
- Typed/pasted text → green insertion. Deleted text → red strikethrough (Backspace, Delete, typing over a selection). Deleting your own green text removes it.
- Consecutive edits by one side form one change; each mark carries a change id + author side.
- **View dropdown:**
  - *Both sides' changes:* everything red/green.
  - *Other party's changes only:* your additions plain with dotted underline, your deletions hidden behind a small red tick.

**Checked:** browser tests of every keystroke case, save/reload, both views, other side's edits. Two bugs found and fixed.

### Phase 5b: Resolving changes and server checks
- **Changes tab:** pending changes in document order with author and text; click item → scrolls to it; click change in document → selects it in list.
- **Accept / Reject** (other side's changes, your turn) and **Withdraw** (your own), applied by the server. Accepting a deleted paragraph removes the paragraph.
- Blocked while anyone on your side is editing.
- **Server checks on save:** untracked edits, removing/altering the other side's changes, forged marks all refused. Changes table kept in step with the document.
- **Privacy:** the other side sees neither your changes nor their list until you send.

**Checked:** 11 unit tests, API tamper tests, two-user browser test.

### Phase 6: Comments, chat, live updates
- **Comment threads:** select text → **Comment** button by the selection; or **Comment** on a Changes tab item. Shared or Internal (default Internal). Highlighted in yellow; click the highlight to open the thread. Reply, Resolve/Reopen ("Resolved by Bob · 30 Sep"), Resolved list.
- **Anchoring (decision 22):** the thread stores the quote + ~30 characters either side, not a mark in the document. Saves can't wipe a comment, and internal ones leave no trace. Text gone → **Outdated**. Change threads survive a withdraw.
- **Chat tab:** one timeline; internal messages tagged and tinted; composer shows Internal/Shared with "Message your team" / "Message both parties".
- **Edit/delete own** comments and messages: "(edited)"; delete leaves "Message deleted" (inline confirm, no browser popup).
- **Server filter:** visibility = Shared OR party = viewer's party on every list and action; the other side gets 404 for internal threads/messages.
- **Live updates (SSE):** `GET /contracts/:id/events`, one stream per viewer filtered to their side. Turn, document, lock, people, comments and chat update without reload. Replaced the 10 s lock and 15 s turn polling. A take-over now kicks the editor immediately.
- **API:** `threads`, `threads/:id/comments`, `PATCH threads/:id` (status), `comments/:id` (PATCH/DELETE), `chat`, `chat/:id` (PATCH/DELETE). Migration `comments_chat` (anchor fields, resolvedBy/At, editedAt, deletedAt).

- **Follow-ups:** reading-mode popup **Comment | Edit** / **Comment | Alice is editing**; Comment button + Ctrl/Cmd+Alt+M while editing (saved text only); bigger Internal/Shared switch with "Only your team will see this."; toolbar scroll arrows; document width 896px.

**Checked:** unit test for the shared text format; API tests (visibility, per-side events, leak guard, edit/delete/resolve rules, withdraw keeps thread); two-user browser test (26 checks, no page errors).

### Phase 7: Upload diffing and restore
- **Upload after first send** (while editing): the Word file is compared with the agreed text and the differences become your tracked changes, word by word inside edited paragraphs. Notice: "Uploaded. Differences from the current text are shown as your tracked changes."
- **How it compares** (`diffDocs` in `api/src/contracts/changes.ts`, spec §4): identical paragraphs matched with jsdiff `diffArrays` (quotes and spacing ignored); leftovers paired at ≥50% shared words; paired ones compared with `diffWordsWithSpace`; unpaired = added/removed. New formatting kept untracked. Removed paragraphs shown before whatever replaced them.
- **Blocked** while the other side has unresolved changes ("Accept or reject the other side's changes first.").
- **Restore:** History → a version → **Restore this version** (your turn only) → confirm. Brings back what your side was proposing in it; differences from the agreed text become your tracked changes.
- **Lists and tables:** a removed bullet or table row comes back in its own bullet/row. Accepting (or rejecting) that empties a whole row or column removes it (decision 26).
- New package: `diff` (jsdiff 9), as named in the spec.

**Checked:** 22 new unit tests (all spec §4.5 examples plus quotes, end removals, mixed formatting); API tests with real .docx uploads (redlines, re-upload, blocks, turn/lock rules, restore both ways, 404); browser test of upload and restore.

---

## 4. Remaining phases

### Phase 8: AI
**To do:**
- **Ask AI** about the document; sees only document content and changes, never internal comments/chat.
- **AI explanation** tab: plain-language summary of changes, generated on demand (not stored in v1).

**Open questions:**
- Which AI model/provider, and any cost limits?

### Phase 9: Signing and export
**To do:**
- **Ready to sign** automatically when no changes are pending; email both sides.
- E-signature and export blocked while any change is unresolved.
- **E-signature** via a third-party provider (identity, timestamps, audit trail); contract locked after signing, signed document hash stored; "Signed" email to both sides.
- **Export** of the agreed contract.

**Open questions:**
- E-signature provider (still undecided).
- Export format: PDF, Word, or both?

---

## 5. Known limits and follow-ups

- Joining two paragraphs (Backspace at start of a paragraph) is undone while tracking; deleting the text itself works.
- Undo while tracking not tested.
- Live updates are in memory, so they assume a single API process (move to Redis pub/sub if scaled out).
- A lock that expires from inactivity sends no event; teammates re-check every 30 s while someone else holds it.
- New comments/messages don't send emails.
- Upload comparison v1 limits: formatting-only changes untracked; moved paragraph = removed + added; heavy rewrite = full delete + insert; a table column removed in an upload shows struck out inside the neighbouring cells (needs full table matching).
- Heavy edits right around commented text can mark its thread Outdated sooner.
- Web has 21 existing TypeScript errors in older prototype files (table toolbar, tracked-change popover) + a deprecated `baseUrl` setting; new code has none.
- Editor toolbar still has buttons contracts don't need (code block, task list, highlight); trimming suggested, not done.
- No automated end-to-end tests in the repo; browser tests were run from a scratch folder.
- On send, pending invites on the receiving side get a new link, so an older invite link for that person stops working.

---

## 6. Running it locally

```bash
cd api && docker compose up -d            # Postgres + Redis
cd api && npx prisma migrate dev          # first time
cd api && npm run start:dev               # API on :3000

cd converter && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # first time
cd converter && .venv/bin/python app.py   # Word converter on :8001

cd web && npm run dev                     # web on :5173, /api forwarded to the API
```

`api/.env` needs `DATABASE_URL`, the R2 keys and bucket. `MAIL_PROVIDER=log` prints emails and login codes to the API console.
