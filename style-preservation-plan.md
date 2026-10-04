# Keeping the Uploaded File's Look: Plan

4 October 2026. Status: **Phase 1 done.**

1. [Goal](#1-goal)
2. [Decisions](#2-decisions)
3. [Phases](#3-phases)
4. [Not doing](#4-not-doing)

---

## 1. Goal

When someone uploads a Word file or imports a Google Doc, most of its look is lost:

- **Editor:** only bold, italic, underline, strike, super/subscript, headings, alignment, lists and tables survive. Fonts, sizes, colours, spacing, indents and numbering styles ("1.1", "(a)") are dropped.
- **Downloads and signed PDFs:** built from a blank Word file, so page size, margins, headers, footers and logos are gone.

Google Docs links are downloaded as .docx and go through the same converter, so every fix covers both.

| Phase | What it covers | Status |
|---|---|---|
| 1 | Downloads and signed PDFs reuse the uploaded file's look | Done |
| 2 | Numbering, fonts, sizes, spacing in the editor | Planned |
| 3 | Editor sheet matches the file's page width and margins (CSS) | Planned |
| 4 | Preview PDF button | Planned |

---

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Show real pages (page breaks, headers, footers) in the editor? | No, for now. Nobody negotiates layout; page breaks wouldn't match Word or the PDF anyway; the only free TipTap 3 option (`tiptap-pagination-plus`) is a one-person project that replaces our table extensions. Revisit if users ask. Paid TipTap Pages ruled out. |
| 2 | After a re-upload mid-negotiation, whose look wins? | The newest upload. |
| 3 | Contracts started from a blank page? | Keep today's plain look (no original file to borrow from). |

---

## 3. Phases

### Phase 1: Downloads and signed PDFs reuse the uploaded file's look
**Goal:** Export (Word, PDF), the document to sign and the signed copy keep the original's page size, margins, headers, footers, header logos and named styles.

- **Converter (`converter/app.py`):**
  - `export()` takes an optional `template` (original .docx). If given, open it instead of `Document()`, remove the body content, keep the final section settings (page size, margins, headers, footers), then fill in the agreed text with `add_blocks` as today.
  - Styles we use by name ("List Number", "List Bullet 2", "Heading 2", "Table Grid") may be missing, e.g. in Google Docs exports. Missing style → plain paragraph / table instead of failing.
  - Template can't be opened → build the plain file as today.
- **API (`api/src/contracts/editor.service.ts`):** `render()` finds the contract's newest `UploadedFile`, reads it from R2 and sends it. No upload → no template.
- No database or web changes.

**Limits:**
- A logo placed in the body (not the header) is removed with the old body.
- Body fonts and numbering still plain until Phase 2.
- Contracts already signed keep their old signed PDF; only new signing rounds get the new look.

**Checks:** export a Word file with header, footer, logo and Letter paper, and a Google Doc (Word + PDF); signing with spots and with a signature page; blank-page contract exports as before; existing unit tests pass.

### Phase 2: Numbering, fonts, sizes, spacing in the editor
**Goal:** the editor shows the document close to Word, and downloads write the same back.

- **Numbering first:** contracts cite "clause 4.2(b)", so the editor must show the same numbers as Word (decimal, multi-level "1.1", letters "(a)", roman "(i)", starting numbers).
- **Text:** font, size, colour, using the editor's existing `TextStyle` / `Color`.
- **Paragraphs:** spacing before/after, line spacing, indents.
- **Tables:** column widths.
- **Converter:** read these on import; write them back on export (with Phase 1's template styles underneath).
- **Server checks:** formatting is already allowed and untracked on save; confirm new attributes pass the save check, diffing and accept/reject.

**Open questions (decide before starting):**
- Show the file's fonts even if the browser doesn't have them (fallback font), or load web fonts?
- Should users be able to change font/size/spacing in the toolbar, or only keep what came in?

### Phase 3: Editor sheet matches the file's page width and margins
**Goal:** lines wrap roughly as in Word, without real pages.

- Store the uploaded file's page width and margins with the contract (from the converter on import).
- The paper sheet in the editor uses them instead of the fixed 896px width. Blank-page contracts keep today's sheet.

### Phase 4: Preview PDF button
**Goal:** see the true pages, headers, footers and page numbers at any time.

- Button opens the PDF of what the viewer can currently see, built the same way as Export (Phase 1 template).
- Question to decide: show redlines in the preview, or only the clean text? Today's PDF export is refused while changes are pending.

---

## 4. Not doing

- Real pages in the editor (decision 1).
- Patching the original Word file in place (rewriting only changed paragraphs): closest match, but fragile with inserted/deleted paragraphs, tables and lists.
- Body images and logos in the editor: redlines only track text, so image changes would go unseen.
