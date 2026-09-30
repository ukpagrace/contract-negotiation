import { baseSignature, collectChanges, diffDocs, plainText, resolveChange, settleChanges, similarity, type DocNode } from './changes.js';

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

describe('plainText', () => {
  it('ends every block with a newline', () => {
    expect(plainText(doc([text('One '), text('two', ins('i1', 'B'))], [text('Three')]))).toBe('One two\nThree\n');
  });
});

// Blocks joined by " / ", with [-deleted] and [+inserted] text.
function show(d: DocNode): string {
  const blocks: string[] = [];
  const walk = (node: DocNode) => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      blocks.push(
        (node.content ?? [])
          .map((t) => {
            const kind = t.marks?.find((m) => m.type.startsWith('tracked'))?.type;
            return kind === 'trackedInsertion' ? `[+${t.text}]` : kind === 'trackedDeletion' ? `[-${t.text}]` : t.text;
          })
          .join(''),
      );
    } else node.content?.forEach(walk);
  };
  walk(d);
  return blocks.join(' / ');
}
const paras = (...texts: string[]) => doc(...texts.map((t) => [text(t)]));
const diff = (from: DocNode, to: DocNode) => {
  let n = 0;
  return diffDocs(from, to, 'P', () => `c${++n}`);
};

describe('similarity', () => {
  it('scores by shared words', () => {
    expect(similarity('Payment is due within 30 days of invoice.', 'Payment is due within 45 days of invoice.')).toBeCloseTo(0.875);
    expect(similarity('The Supplier shall deliver the goods within 14 days.', 'Delivery must occur no later than two weeks after the order date.')).toBeLessThan(0.2);
  });
});

describe('diffDocs (spec 4.5 examples)', () => {
  it('small edit: word-level redline', () => {
    expect(show(diff(paras('Payment is due within 30 days of invoice.'), paras('Payment is due within 45 days of invoice.')))).toBe(
      'Payment is due within [-30][+45] days of invoice.',
    );
  });

  it('paragraph added: others unchanged though shifted', () => {
    expect(show(diff(paras('Definitions', 'Payment', 'Termination'), paras('Definitions', 'Confidentiality', 'Payment', 'Termination')))).toBe(
      'Definitions / [+Confidentiality] / Payment / Termination',
    );
  });

  it('paragraph removed', () => {
    expect(show(diff(paras('Definitions', 'Late fees', 'Termination'), paras('Definitions', 'Termination')))).toBe(
      'Definitions / [-Late fees] / Termination',
    );
  });

  it('heavy rewrite: full delete + insert', () => {
    expect(
      show(diff(paras('The Supplier shall deliver the goods within 14 days.'), paras('Delivery must occur no later than two weeks after the order date.'))),
    ).toBe('[-The Supplier shall deliver the goods within 14 days.] / [+Delivery must occur no later than two weeks after the order date.]');
  });

  it('edit + add in the same gap', () => {
    expect(
      show(diff(paras('Alpha clause.', 'Beta clause has five words here.', 'Delta clause.'), paras('Alpha clause.', 'Beta clause has six words here.', 'Extra clause text.', 'Delta clause.'))),
    ).toBe('Alpha clause. / Beta clause has [-five][+six] words here. / [+Extra clause text.] / Delta clause.');
  });

  it('moved paragraph: removed then added', () => {
    expect(show(diff(paras('Alpha one.', 'Bravo two.', 'Charlie three.'), paras('Alpha one.', 'Charlie three.', 'Bravo two.')))).toBe(
      'Alpha one. / [-Bravo two.] / Charlie three. / [+Bravo two.]',
    );
  });

  it('formatting only: unchanged, new formatting kept', () => {
    const bold = doc([{ type: 'text', text: 'Governing law: Nigeria.', marks: [{ type: 'bold' }] }]);
    const result = diff(paras('Governing law: Nigeria.'), bold);
    expect(result).toEqual(bold);
  });

  it('curly and straight quotes match', () => {
    expect(show(diff(paras('The “Goods” are listed.'), paras('The "Goods" are listed.')))).toBe('The "Goods" are listed.');
  });

  it('removed block at the end goes last', () => {
    expect(show(diff(paras('Keep.', 'Gone at the end.'), paras('Keep.')))).toBe('Keep. / [-Gone at the end.]');
  });

  it('keeps formatting of both sides in a modified paragraph', () => {
    const before = doc([text('Pay '), { type: 'text', text: 'thirty', marks: [{ type: 'bold' }] }, text(' days now.')]);
    const after = doc([text('Pay '), { type: 'text', text: 'forty', marks: [{ type: 'italic' }] }, text(' days now.')]);
    const [p] = diff(before, after).content!;
    expect(p.content!.map((n) => [n.text, n.marks?.map((m) => m.type).join(',')])).toEqual([
      ['Pay ', undefined],
      ['thirty', 'bold,trackedDeletion'],
      ['forty', 'italic,trackedInsertion'],
      [' days now.', undefined],
    ]);
  });
});

describe('settleChanges', () => {
  it('undoes one side and keeps the other pending', () => {
    const settled = settleChanges(sample, (_kind, party) => (party === 'B' ? 'reject' : null));
    expect(show(settled)).toBe('Payment within 30 days.');
  });
});
