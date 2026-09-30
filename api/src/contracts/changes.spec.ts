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

const cell = (...nodes: DocNode[]): DocNode => ({ type: 'tableCell', content: [{ type: 'paragraph', content: nodes.length ? nodes : undefined }] });
const row = (...cells: DocNode[]): DocNode => ({ type: 'tableRow', content: cells });
const table = (...rows: DocNode[]): DocNode => ({ type: 'doc', content: [{ type: 'table', content: rows }] });
const item = (value: string): DocNode => ({ type: 'listItem', content: [{ type: 'paragraph', content: [text(value)] }] });
const list = (...values: string[]): DocNode => ({ type: 'bulletList', content: values.map(item) });
// Rows as "a|b" joined by " / ".
const grid = (d: DocNode) =>
  (d.content?.[0]?.content ?? []).map((r) => (r.content ?? []).map((c) => show({ type: 'doc', content: c.content })).join('|')).join(' / ');

describe('tables when resolving', () => {
  it('accepting a deletion of a whole row removes the row', () => {
    const d = table(row(cell(text('Item')), cell(text('Price'))), row(cell(text('Laptop', del('d1', 'B'))), cell(text('900', del('d1', 'B')))));
    expect(grid(resolveChange(d, 'd1', true))).toBe('Item|Price');
  });

  it('accepting part of a row leaves the cell empty', () => {
    const d = table(row(cell(text('Item')), cell(text('Price'))), row(cell(text('Laptop', del('d1', 'B'))), cell(text('900'))));
    expect(grid(resolveChange(d, 'd1', true))).toBe('Item|Price / |900');
  });

  it('rejecting an inserted row removes it', () => {
    const d = table(row(cell(text('A')), cell(text('B'))), row(cell(text('New', ins('i1', 'B'))), cell(text('Row', ins('i1', 'B')))));
    expect(grid(resolveChange(d, 'i1', false))).toBe('A|B');
  });

  it('accepting a deletion of a whole column removes the column', () => {
    const d = table(row(cell(text('Item')), cell(text('Notes', del('d1', 'B')))), row(cell(text('Laptop')), cell(text('Bulk', del('d1', 'B')))));
    expect(grid(resolveChange(d, 'd1', true))).toBe('Item / Laptop');
  });

  it('keeps rows and columns that were already empty', () => {
    const d = table(row(cell(text('A')), cell()), row(cell(), cell()), row(cell(text('x', del('d1', 'B'))), cell(text('C'))));
    expect(grid(resolveChange(d, 'd1', true))).toBe('A| / | / |C');
  });

  it('leaves tables with merged cells to empty cells only', () => {
    const merged: DocNode = { type: 'tableCell', attrs: { colspan: 2 }, content: [{ type: 'paragraph', content: [text('Header')] }] };
    const d = table(row(merged), row(cell(text('a')), cell(text('b', del('d1', 'B')))));
    expect(grid(resolveChange(d, 'd1', true))).toBe('Header / a|');
  });
});

describe('diffDocs containers', () => {
  it('a removed list item comes back as its own bullet', () => {
    const result = diff({ type: 'doc', content: [list('Delivery', 'Payment', 'Late fees')] }, { type: 'doc', content: [list('Delivery', 'Late fees')] });
    const items = result.content![0].content!;
    expect(items.map((i) => show({ type: 'doc', content: i.content }))).toEqual(['Delivery', '[-Payment]', 'Late fees']);
  });

  it('removed items at the end stay one list', () => {
    const result = diff({ type: 'doc', content: [list('Keep', 'Gone one', 'Gone two')] }, { type: 'doc', content: [list('Keep')] });
    expect(result.content!.map((n) => n.type)).toEqual(['bulletList', 'bulletList']);
    expect(result.content![1].content!.length).toBe(2);
  });

  it('a removed table row comes back as its own row, and accepting it removes it', () => {
    const before = table(row(cell(text('Item')), cell(text('Price'))), row(cell(text('Laptops')), cell(text('$900'))), row(cell(text('Monitors')), cell(text('$200'))));
    const after = table(row(cell(text('Item')), cell(text('Price'))), row(cell(text('Monitors')), cell(text('$200'))));
    const result = diff(before, after);
    expect(grid(result)).toBe('Item|Price / [-Laptops]|[-$900] / Monitors|$200');
    const id = [...collectChanges(result).keys()][0];
    expect(grid(resolveChange(result, id, true))).toBe('Item|Price / Monitors|$200');
  });
});

describe('restore rule', () => {
  it("keeps the restorer's proposals and undoes the other side's", () => {
    const d = doc([text('Pay in '), text('30', del('d1', 'A')), text('45', ins('i1', 'A')), text(' days'), text(' now', ins('i2', 'B'))]);
    expect(show(settleChanges(d, (_k, author) => (author === 'A' ? 'accept' : 'reject')))).toBe('Pay in 45 days');
  });
});
