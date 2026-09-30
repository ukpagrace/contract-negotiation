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

// Applies `transform` to every text node; returning null removes it. Blocks emptied by the
// removal are dropped too, so accepting a deleted paragraph removes the paragraph.
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
  return { ...node, content: children };
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

// Upload comparison (spec section 4). Paragraph-level blocks are matched first, leftovers are
// paired by shared words, and paired blocks are compared word by word.

export const SIMILARITY_THRESHOLD = 0.5;

const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);

// Curly and straight quotes count as the same; one character each, so offsets still line up.
const normalizeQuotes = (text: string) => text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

function blockText(block: DocNode): string {
  return (block.content ?? []).map((node) => (node.type === 'text' ? (node.text ?? '') : node.type === 'hardBreak' ? '\n' : '\uFFFC')).join('');
}

function collectBlocks(node: DocNode, out: DocNode[] = []): DocNode[] {
  if (TEXTBLOCKS.has(node.type)) out.push(node);
  else node.content?.forEach((child) => collectBlocks(child, out));
  return out;
}

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

// Differences between `base` and `next` as `partyId`'s tracked changes, laid out on `next`'s
// structure. Formatting-only differences keep the new formatting untracked (spec 4.4).
export function diffDocs(base: DocNode, next: DocNode, partyId: string, newId: () => string): DocNode {
  const oldBlocks = collectBlocks(base);
  const newBlocks = collectBlocks(next);
  const replacement = new Map<number, DocNode>();
  // Removed old blocks, shown just before the new block with this index (or at the end).
  const removedBefore = new Map<number, DocNode[]>();
  const removeBefore = (newIndex: number, block: DocNode) => {
    if (!block.content?.length) return;
    const content = tracked(block.content ?? [], 'trackedDeletion', newId(), partyId);
    removedBefore.set(newIndex, [...(removedBefore.get(newIndex) ?? []), { ...block, content }]);
  };

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
      for (let k = lastPaired + 1; k < best; k++) removeBefore(newIndex, oldBlocks[oldGap[k]]);
      modify(oldBlocks[oldGap[best]], newBlocks[newIndex], newIndex);
      lastPaired = best;
    }
    for (let k = lastPaired + 1; k < oldGap.length; k++) removeBefore(firstAdded ?? nextNewIndex, oldBlocks[oldGap[k]]);
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

  let counter = 0;
  const rebuild = (node: DocNode): DocNode[] => {
    if (TEXTBLOCKS.has(node.type)) {
      const index = counter++;
      return [...(removedBefore.get(index) ?? []), replacement.get(index) ?? node];
    }
    return [node.content ? { ...node, content: node.content.flatMap(rebuild) } : node];
  };
  const [doc] = rebuild(next);
  return { ...doc, content: [...(doc.content ?? []), ...(removedBefore.get(newBlocks.length) ?? [])] };
}
