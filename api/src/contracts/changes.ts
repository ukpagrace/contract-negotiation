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
