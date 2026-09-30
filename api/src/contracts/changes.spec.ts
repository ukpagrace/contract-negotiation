import { baseSignature, collectChanges, resolveChange, type DocNode } from './changes.js';

const ins = (changeId: string, authorPartyId: string) => ({ type: 'trackedInsertion', attrs: { changeId, authorPartyId } });
const del = (changeId: string, authorPartyId: string) => ({ type: 'trackedDeletion', attrs: { changeId, authorPartyId } });
const doc = (...paragraphs: DocNode[][]): DocNode => ({
  type: 'doc',
  content: paragraphs.map((content) => ({ type: 'paragraph', content })),
});
const text = (value: string, ...marks: ReturnType<typeof ins>[]): DocNode => (marks.length ? { type: 'text', text: value, marks } : { type: 'text', text: value });

// "Payment within [-30][+45] days." with 30→45 proposed by party B.
const sample = doc([text('Payment within '), text('30', del('d1', 'B')), text('45', ins('i1', 'B')), text(' days.')]);

describe('collectChanges', () => {
  it('lists changes in document order with their text', () => {
    expect([...collectChanges(sample)]).toEqual([
      ['d1', { type: 'DELETE', authorPartyId: 'B', text: '30' }],
      ['i1', { type: 'INSERT', authorPartyId: 'B', text: '45' }],
    ]);
  });
});

describe('resolveChange', () => {
  const plain = (d: DocNode) => JSON.stringify(d.content);

  it('accepting both sides of a replacement leaves neutral new text', () => {
    const result = resolveChange(resolveChange(sample, 'd1', true), 'i1', true);
    expect(plain(result)).toBe(plain(doc([text('Payment within 45 days.')])));
  });

  it('rejecting both restores the original text', () => {
    const result = resolveChange(resolveChange(sample, 'd1', false), 'i1', false);
    expect(plain(result)).toBe(plain(doc([text('Payment within 30 days.')])));
  });

  it('accepting a deleted paragraph removes the paragraph', () => {
    const d = doc([text('Keep')], [text('Late fees apply.', del('d2', 'B'))]);
    expect(plain(resolveChange(d, 'd2', true))).toBe(plain(doc([text('Keep')])));
  });

  it('keeps an empty paragraph when the whole document is removed', () => {
    const d = doc([text('Only', ins('i2', 'B'))]);
    expect(resolveChange(d, 'i2', false)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('keeps unrelated marks on text', () => {
    const d = doc([{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }, ins('i3', 'B')] }]);
    expect(plain(resolveChange(d, 'i3', true))).toBe(plain(doc([{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }])));
  });
});

describe('baseSignature', () => {
  it('ignores the saver’s own pending changes', () => {
    const edited = doc([text('Payment within '), text('30', del('d1', 'B')), text('45', ins('i1', 'B')), text(' calendar', ins('i9', 'A')), text(' days.')]);
    expect(baseSignature(edited, 'A')).toBe(baseSignature(sample, 'A'));
  });

  it('ignores formatting and paragraph splits', () => {
    const split = doc([text('Payment '), { type: 'text', text: 'within ', marks: [{ type: 'bold' }] }], [text('30', del('d1', 'B')), text('45', ins('i1', 'B')), text(' days.')]);
    expect(baseSignature(split, 'A')).toBe(baseSignature(sample, 'A'));
  });

  it('detects untracked text edits', () => {
    const edited = doc([text('Payment within '), text('30', del('d1', 'B')), text('45', ins('i1', 'B')), text(' weeks.')]);
    expect(baseSignature(edited, 'A')).not.toBe(baseSignature(sample, 'A'));
  });

  it('detects removing the other side’s change', () => {
    const edited = doc([text('Payment within 45 days.')]);
    expect(baseSignature(edited, 'A')).not.toBe(baseSignature(sample, 'A'));
  });

  it('allows proposing to delete the other side’s insertion', () => {
    const edited = doc([text('Payment within '), text('30', del('d1', 'B')), text('45', ins('i1', 'B'), del('d9', 'A')), text(' days.')]);
    expect(baseSignature(edited, 'A')).toBe(baseSignature(sample, 'A'));
  });
});
