import { diffArrays, diffWordsWithSpace } from 'diff';

// Pure helpers over the stored TipTap JSON. Tracked changes live in the document as
// `trackedInsertion` / `trackedDeletion` marks carrying `changeId` and `authorPartyId`.

type AttrValue = string | number | boolean | null;

export interface DocMark {
  type: string;
  attrs?: Record<string, AttrValue>;
}

export interface DocNode {
  type: string;
  text?: string;
  marks?: DocMark[];
  attrs?: Record<string, AttrValue>;
  content?: DocNode[];
}

export type ChangeKind = 'INSERT' | 'DELETE';

export interface FoundChange {
  type: ChangeKind;
  authorPartyId: string;
  text: string;
}

const KIND: Record<string, ChangeKind> = { trackedInsertion: 'INSERT', trackedDeletion: 'DELETE' };

function changeMarks(node: DocNode): { kind: ChangeKind; changeId: string; authorPartyId: string }[] {
  return (node.marks ?? [])
    .filter((mark) => KIND[mark.type] && typeof mark.attrs?.changeId === 'string')
    .map((mark) => ({
      kind: KIND[mark.type],
      changeId: mark.attrs!.changeId as string,
      authorPartyId: String(mark.attrs!.authorPartyId),
    }));
}

function walkText(node: DocNode, visit: (text: DocNode) => void): void {
  if (node.type === 'text' || node.type === 'hardBreak') visit(node);
  node.content?.forEach((child) => walkText(child, visit));
}

// Changes in document order (Map preserves insertion order), with the text each one covers.
export function collectChanges(doc: DocNode | null): Map<string, FoundChange> {
  const found = new Map<string, FoundChange>();
  if (!doc) return found;
  walkText(doc, (node) => {
    for (const mark of changeMarks(node)) {
      const existing = found.get(mark.changeId);
      const text = node.text ?? '\n';
      if (existing) existing.text += text;
      else found.set(mark.changeId, { type: mark.kind, authorPartyId: mark.authorPartyId, text });
    }
  });
  return found;
}

// The document as it would read with `partyId`'s own pending changes undone, keeping everyone
// else's marks. A save is only legitimate if this is unchanged: the saver may add or drop their
// own tracked changes, and change formatting or paragraph breaks, but nothing else.
export function baseSignature(doc: DocNode, partyId: string): string {
  const runs: [string, string][] = [];
  walkText(doc, (node) => {
    const marks = changeMarks(node);
    if (marks.some((m) => m.kind === 'INSERT' && m.authorPartyId === partyId)) return;
    const tag = marks
      .filter((m) => m.authorPartyId !== partyId)
      .map((m) => `${m.kind}:${m.changeId}`)
      .sort()
      .join(',');
    const text = node.text ?? '\n';
    const last = runs[runs.length - 1];
    if (last && last[1] === tag) last[0] += text;
    else runs.push([text, tag]);
  });
  return JSON.stringify(runs);
}

// Containers that must keep at least one block rather than disappear when emptied.
const KEEP_WHEN_EMPTY = new Set(['doc', 'tableCell', 'tableHeader']);

function sameMarks(a: DocNode, b: DocNode): boolean {
  return JSON.stringify(a.marks ?? []) === JSON.stringify(b.marks ?? []);
}

function hasText(node: DocNode): boolean {
  return node.type === 'text' ? Boolean(node.text) : (node.content ?? []).some(hasText);
}

// Columns whose text was all removed. Tables with merged cells are left alone, since their
// column positions are ambiguous.
function dropEmptiedColumns(before: DocNode, after: DocNode): DocNode {
  const merged = (before.content ?? []).some((row) =>
    (row.content ?? []).some((cell) => Number(cell.attrs?.colspan ?? 1) !== 1 || Number(cell.attrs?.rowspan ?? 1) !== 1),
  );
  if (merged) return after;
  const columnHasText = (table: DocNode, i: number) => (table.content ?? []).some((row) => row.content?.[i] && hasText(row.content[i]));
  const width = Math.max(0, ...(before.content ?? []).map((row) => row.content?.length ?? 0));
  const drop = new Set([...Array(width).keys()].filter((i) => columnHasText(before, i) && !columnHasText(after, i)));
  if (drop.size === 0) return after;
  return { ...after, content: after.content?.map((row) => ({ ...row, content: row.content?.filter((_, i) => !drop.has(i)) })) };
}

// Applies `transform` to every text node; returning null removes it. Blocks emptied by the
// removal are dropped too, so accepting a deleted paragraph removes the paragraph. Table cells
// stay, but a row or column whose text is all removed goes (rows or columns that were already
// empty are kept).
function mapText(node: DocNode, transform: (text: DocNode) => DocNode | null): DocNode | null {
  if (node.type === 'text' || node.type === 'hardBreak') return transform(node);
  if (!node.content) return node;

  const children: DocNode[] = [];
  for (const child of node.content) {
    const next = mapText(child, transform);
    if (!next) continue;
    const last = children[children.length - 1];
    if (next.type === 'text' && last?.type === 'text' && sameMarks(last, next)) {
      children[children.length - 1] = { ...last, text: (last.text ?? '') + (next.text ?? '') };
    } else {
      children.push(next);
    }
  }

  if (children.length === 0 && node.content.length > 0) {
    if (!KEEP_WHEN_EMPTY.has(node.type)) return null;
    return { ...node, content: [{ type: 'paragraph' }] };
  }
  const result = { ...node, content: children };
  if (node.type === 'tableRow' && hasText(node) && !hasText(result)) return null;
  if (node.type === 'table') return dropEmptiedColumns(node, result);
  return result;
}

// accept=true applies the change; accept=false undoes it (used for reject and withdraw).
export function resolveChange(doc: DocNode, changeId: string, accept: boolean): DocNode {
  return (
    mapText(doc, (node) => {
      const mark = (node.marks ?? []).find((m) => KIND[m.type] && m.attrs?.changeId === changeId);
      if (!mark) return node;
      const removeText = (KIND[mark.type] === 'INSERT') !== accept;
      if (removeText) return null;
      const marks = node.marks!.filter((m) => m !== mark);
      const { marks: _dropped, ...rest } = node;
      return marks.length ? { ...rest, marks } : rest;
    }) ?? { type: 'doc', content: [{ type: 'paragraph' }] }
  );
}

// The document's text as comment anchors see it: every block ends with a newline. The web
// editor flattens its document the same way, so a quote taken there can be found here.
export function plainText(node: DocNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === SPOT) return '';
  const inner = (node.content ?? []).map(plainText).join('');
  return node.type === 'doc' ? inner : `${inner}\n`;
}

// Settles every change at once: 'accept' applies it, 'reject' undoes it, null leaves it pending.
export function settleChanges(doc: DocNode, decide: (kind: ChangeKind, authorPartyId: string) => 'accept' | 'reject' | null): DocNode {
  return (
    mapText(doc, (node) => {
      const settled = new Set<string>();
      for (const mark of changeMarks(node)) {
        const decision = decide(mark.kind, mark.authorPartyId);
        if (!decision) continue;
        if ((mark.kind === 'INSERT') !== (decision === 'accept')) return null;
        settled.add(mark.changeId);
      }
      if (settled.size === 0) return node;
      const marks = node.marks!.filter((m) => !(KIND[m.type] && settled.has(m.attrs?.changeId as string)));
      const { marks: _dropped, ...rest } = node;
      return marks.length ? { ...rest, marks } : rest;
    }) ?? { type: 'doc', content: [{ type: 'paragraph' }] }
  );
}

// Signature spots: untracked inline markers, placed by the proposer, showing where each side signs.
// Positions are character offsets into plainText(), where a spot takes no space.

export const SPOT = 'signatureSpot';

export type SpotRole = 'PROPOSER' | 'COUNTERPARTY';

// Also merges text split around a removed spot, so documents differing only by spots compare equal.
export function stripSpots(node: DocNode): DocNode {
  if (!node.content) return node;
  const children: DocNode[] = [];
  for (const child of node.content) {
    if (child.type === SPOT) continue;
    const next = stripSpots(child);
    const last = children[children.length - 1];
    if (next.type === 'text' && last?.type === 'text' && sameMarks(last, next)) {
      children[children.length - 1] = { ...last, text: (last.text ?? '') + (next.text ?? '') };
    } else {
      children.push(next);
    }
  }
  return { ...node, content: children };
}

export function sameIgnoringSpots(a: DocNode, b: DocNode): boolean {
  return JSON.stringify(stripSpots(a)) === JSON.stringify(stripSpots(b));
}

export function spotRoles(doc: DocNode): SpotRole[] {
  const roles: SpotRole[] = [];
  const walk = (node: DocNode) => {
    if (node.type === SPOT) roles.push(node.attrs?.role as SpotRole);
    node.content?.forEach(walk);
  };
  walk(doc);
  return roles;
}

// Replaces any spots with ones at the given offsets. Offsets must fall inside a text block.
export function placeSpots(doc: DocNode, offsets: Record<SpotRole, number>): DocNode {
  const pending = (Object.entries(offsets) as [SpotRole, number][]).sort((a, b) => a[1] - b[1]);
  let pos = 0;
  const spot = (role: SpotRole): DocNode => ({ type: SPOT, attrs: { role } });
  const place = (node: DocNode): DocNode => {
    if (!TEXTBLOCKS.has(node.type)) {
      const result = node.content ? { ...node, content: node.content.map(place) } : node;
      if (node.type !== 'doc') pos += 1;
      return result;
    }
    const out: DocNode[] = [];
    const dropAt = (at: number) => {
      while (pending.length && pending[0][1] === at) out.push(spot(pending.shift()![0]));
    };
    for (const child of node.content ?? []) {
      dropAt(pos);
      if (child.type !== 'text') {
        out.push(child);
        pos += 1;
        continue;
      }
      const text = child.text ?? '';
      let start = 0;
      // Offsets equal to `pos` were placed by dropAt, so anything left here falls inside this text.
      while (pending.length && pending[0][1] >= pos + start && pending[0][1] < pos + text.length) {
        const cut = pending[0][1] - pos;
        if (cut > start) out.push({ ...child, text: text.slice(start, cut) });
        out.push(spot(pending.shift()![0]));
        start = cut;
      }
      out.push({ ...child, text: text.slice(start) });
      pos += text.length;
    }
    dropAt(pos);
    pos += 1;
    return { ...node, content: out };
  };
  const result = place(stripSpots(doc));
  if (pending.length) throw new Error('Spot offset is outside the text.');
  return result;
}

// Upload comparison (spec section 4). Paragraph-level blocks are matched first, leftovers are
// paired by shared words, and paired blocks are compared word by word.

export const SIMILARITY_THRESHOLD = 0.5;

const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);

// Curly and straight quotes count as the same; one character each, so offsets still line up.
const normalizeQuotes = (text: string) => text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

function blockText(block: DocNode): string {
  return (block.content ?? []).map((node) => (node.type === 'text' ? (node.text ?? '') : node.type === 'hardBreak' ? '\n' : '\uFFFC')).join('');
}

const LIST_ITEMS = new Set(['listItem', 'taskItem']);

// A text block with the list item or table row it sits in, so a removed one can be shown in its
// own bullet or row.
interface Located {
  block: DocNode;
  item?: DocNode;
  list?: DocNode;
  row?: DocNode;
  table?: DocNode;
}

function collectBlocks(node: DocNode, out: Located[] = [], context: Omit<Located, 'block'> = {}): Located[] {
  if (TEXTBLOCKS.has(node.type)) {
    out.push({ block: node, ...context });
    return out;
  }
  for (const child of node.content ?? []) {
    const inner = { ...context };
    if (LIST_ITEMS.has(child.type)) Object.assign(inner, { item: child, list: node });
    if (child.type === 'tableRow') Object.assign(inner, { row: child, table: node });
    collectBlocks(child, out, inner);
  }
  return out;
}

const countBlocks = (node: DocNode): number => (TEXTBLOCKS.has(node.type) ? 1 : (node.content ?? []).reduce((n, c) => n + countBlocks(c), 0));

const matchKey = (block: DocNode) => normalizeQuotes(blockText(block)).replace(/\s+/g, ' ').trim();

// Share of words in common (Dice coefficient): "due within 30 days" vs "due within 45 days" is 0.75.
export function similarity(a: string, b: string): number {
  const words = (text: string) => normalizeQuotes(text).toLowerCase().match(/\S+/g) ?? [];
  const left = words(a);
  const right = words(b);
  if (left.length + right.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const word of left) counts.set(word, (counts.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of right) {
    const n = counts.get(word) ?? 0;
    if (n > 0) {
      shared++;
      counts.set(word, n - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

// The inline nodes covering characters [from, to) of a block, hard breaks and atoms counting as one.
function sliceInline(content: DocNode[], from: number, to: number): DocNode[] {
  const out: DocNode[] = [];
  let pos = 0;
  for (const node of content) {
    const length = node.type === 'text' ? (node.text ?? '').length : 1;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + length);
    if (start < end) {
      out.push(node.type === 'text' ? { ...node, text: node.text!.slice(start - pos, end - pos) } : node);
    }
    pos += length;
  }
  return out;
}

function tracked(nodes: DocNode[], type: 'trackedInsertion' | 'trackedDeletion', changeId: string, authorPartyId: string): DocNode[] {
  return nodes.map((node) => ({ ...node, marks: [...(node.marks ?? []), { type, attrs: { changeId, authorPartyId } }] }));
}

function trackedDeep(node: DocNode, changeId: string, authorPartyId: string): DocNode {
  if (TEXTBLOCKS.has(node.type)) return { ...node, content: tracked(node.content ?? [], 'trackedDeletion', changeId, authorPartyId) };
  return node.content ? { ...node, content: node.content.map((child) => trackedDeep(child, changeId, authorPartyId)) } : node;
}

// A removed block, ready to go back in: `item` fits among list items or rows of the same kind,
// `block` anywhere a paragraph can go.
interface Removed {
  item?: DocNode;
  block: DocNode;
  // The list or table it came from, so neighbours from the same one are shown together.
  source?: DocNode;
}

function asBlocks(entries: Removed[]): DocNode[] {
  const out: { source?: DocNode; node: DocNode }[] = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (entry.source && last?.source === entry.source) last.node = { ...last.node, content: [...(last.node.content ?? []), entry.item!] };
    else out.push({ source: entry.source, node: entry.block });
  }
  return out.map((e) => e.node);
}

// Differences between `base` and `next` as `partyId`'s tracked changes, laid out on `next`'s
// structure. Formatting-only differences keep the new formatting untracked (spec 4.4).
export function diffDocs(base: DocNode, next: DocNode, partyId: string, newId: () => string): DocNode {
  const oldLocated = collectBlocks(base);
  const oldBlocks = oldLocated.map((located) => located.block);
  const newBlocks = collectBlocks(next).map((located) => located.block);
  const replacement = new Map<number, DocNode>();
  // Old block index → the new block it is shown just before (newBlocks.length = the end).
  const removals: [number, number][] = [];
  const removeBefore = (newIndex: number, oldIndex: number) => removals.push([oldIndex, newIndex]);

  const modify = (oldBlock: DocNode, newBlock: DocNode, newIndex: number) => {
    const oldContent = oldBlock.content ?? [];
    const newContent = newBlock.content ?? [];
    const content: DocNode[] = [];
    let oldPos = 0;
    let newPos = 0;
    for (const part of diffWordsWithSpace(normalizeQuotes(blockText(oldBlock)), normalizeQuotes(blockText(newBlock)))) {
      const length = part.value.length;
      if (part.removed) {
        content.push(...tracked(sliceInline(oldContent, oldPos, oldPos + length), 'trackedDeletion', newId(), partyId));
        oldPos += length;
      } else if (part.added) {
        content.push(...tracked(sliceInline(newContent, newPos, newPos + length), 'trackedInsertion', newId(), partyId));
        newPos += length;
      } else {
        content.push(...sliceInline(newContent, newPos, newPos + length));
        oldPos += length;
        newPos += length;
      }
    }
    replacement.set(newIndex, { ...newBlock, content });
  };

  const add = (newBlock: DocNode, newIndex: number) => {
    if (newBlock.content?.length) {
      replacement.set(newIndex, { ...newBlock, content: tracked(newBlock.content, 'trackedInsertion', newId(), partyId) });
    }
  };

  // Leftovers between two matched blocks: pair each new block with the most similar old one at or
  // above the threshold, keeping document order; the rest are added or removed.
  const settleGap = (oldGap: number[], newGap: number[], nextNewIndex: number) => {
    let lastPaired = -1;
    // Old blocks left over at the end are shown before whatever was added in their place.
    let firstAdded: number | undefined;
    for (const newIndex of newGap) {
      let best = -1;
      let bestScore = SIMILARITY_THRESHOLD;
      for (let k = lastPaired + 1; k < oldGap.length; k++) {
        const score = similarity(blockText(oldBlocks[oldGap[k]]), blockText(newBlocks[newIndex]));
        if (score >= bestScore) {
          best = k;
          bestScore = score;
        }
      }
      if (best === -1) {
        add(newBlocks[newIndex], newIndex);
        firstAdded ??= newIndex;
        continue;
      }
      firstAdded = undefined;
      for (let k = lastPaired + 1; k < best; k++) removeBefore(newIndex, oldGap[k]);
      modify(oldBlocks[oldGap[best]], newBlocks[newIndex], newIndex);
      lastPaired = best;
    }
    for (let k = lastPaired + 1; k < oldGap.length; k++) removeBefore(firstAdded ?? nextNewIndex, oldGap[k]);
  };

  let oldIndex = 0;
  let newIndex = 0;
  let oldGap: number[] = [];
  let newGap: number[] = [];
  for (const part of diffArrays(oldBlocks.map(matchKey), newBlocks.map(matchKey))) {
    const count = part.count ?? part.value.length;
    if (part.removed) {
      for (let i = 0; i < count; i++) oldGap.push(oldIndex++);
    } else if (part.added) {
      for (let i = 0; i < count; i++) newGap.push(newIndex++);
    } else {
      settleGap(oldGap, newGap, newIndex);
      oldGap = [];
      newGap = [];
      oldIndex += count;
      newIndex += count;
    }
  }
  settleGap(oldGap, newGap, newBlocks.length);

  // A table row whose text was all removed goes back as a whole row; anything else as its own
  // list item or paragraph.
  const removedIndexes = new Set(removals.map(([oldIndex]) => oldIndex));
  const removedBefore = new Map<number, Removed[]>();
  const rowsDone = new Set<DocNode>();
  for (const [oldIndex, newIndex] of removals) {
    const { block, item, list, row, table } = oldLocated[oldIndex];
    let removed: Removed | undefined;
    const wholeRow =
      row && oldLocated.every((other, i) => other.row !== row || removedIndexes.has(i) || !other.block.content?.length);
    if (row && table && wholeRow) {
      if (rowsDone.has(row)) continue;
      rowsDone.add(row);
      const deleted = trackedDeep(row, newId(), partyId);
      removed = { item: deleted, block: { ...table, content: [deleted] }, source: table };
    } else if (block.content?.length) {
      const deleted = trackedDeep(block, newId(), partyId);
      const asItem = item && { ...item, content: [deleted] };
      removed = asItem && list ? { item: asItem, block: { ...list, content: [asItem] }, source: list } : { block: deleted };
    }
    if (removed) removedBefore.set(newIndex, [...(removedBefore.get(newIndex) ?? []), removed]);
  }

  // Removed list items and rows go before the matching item or row that holds the block they
  // were anchored to; the rest before the block itself.
  let counter = 0;
  const takeItems = (type: string, from: number, to: number): DocNode[] => {
    const taken: DocNode[] = [];
    for (let i = from; i < to; i++) {
      const entries = removedBefore.get(i) ?? [];
      taken.push(...entries.filter((e) => e.item?.type === type).map((e) => e.item!));
      removedBefore.set(i, entries.filter((e) => e.item?.type !== type));
    }
    return taken;
  };
  const rebuild = (node: DocNode): DocNode[] => {
    if (TEXTBLOCKS.has(node.type)) {
      const index = counter++;
      return [...asBlocks(removedBefore.get(index) ?? []), replacement.get(index) ?? node];
    }
    const before = LIST_ITEMS.has(node.type) || node.type === 'tableRow' ? takeItems(node.type, counter, counter + countBlocks(node)) : [];
    return [...before, node.content ? { ...node, content: node.content.flatMap(rebuild) } : node];
  };
  const [doc] = rebuild(next);
  return { ...doc, content: [...(doc.content ?? []), ...asBlocks(removedBefore.get(newBlocks.length) ?? [])] };
}
