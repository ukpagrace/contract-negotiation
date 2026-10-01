import { Node } from '@tiptap/core'
import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { PartyRole } from '@/lib/api'

// Untracked marker showing where a side signs. Only placing mode may add, move or remove one;
// every other edit that would change them is refused.
const PLACING = 'signatureSpotPlacing'

export const SignatureSpot = Node.create<{ labels: Record<PartyRole, string> }>({
  name: 'signatureSpot',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addOptions() {
    return { labels: { PROPOSER: 'Proposer signs here', COUNTERPARTY: 'Counterparty signs here' } }
  },

  addAttributes() {
    return { role: { default: 'PROPOSER', parseHTML: (el: HTMLElement) => el.getAttribute('data-signature-spot') } }
  },

  parseHTML() {
    return [{ tag: 'span[data-signature-spot]' }]
  },

  renderHTML({ node }) {
    const role = node.attrs.role as PartyRole
    return ['span', { 'data-signature-spot': role, class: 'signature-spot', contenteditable: 'false' }, `✍ ${this.options.labels[role]}`]
  },

  addProseMirrorPlugins() {
    const count = (doc: PMNode) => {
      let n = 0
      doc.descendants((node) => {
        if (node.type.name === 'signatureSpot') n++
      })
      return n
    }
    return [
      new Plugin({
        key: new PluginKey('signatureSpotGuard'),
        filterTransaction: (tr, state) => !tr.docChanged || Boolean(tr.getMeta(PLACING)) || count(tr.doc) === count(state.doc),
      }),
    ]
  },
})

// Puts `role`'s spot at `pos` (inside text), replacing any it had.
export function placeSpot(editor: Editor, role: PartyRole, pos: number): boolean {
  if (!editor.state.doc.resolve(pos).parent.inlineContent) return false
  const tr = editor.state.tr
  removeFrom(tr.doc, role).forEach((at) => tr.delete(at, at + 1))
  tr.insert(tr.mapping.map(pos), editor.schema.nodes.signatureSpot.create({ role }))
  editor.view.dispatch(tr.setMeta(PLACING, true))
  return true
}

export function removeSpot(editor: Editor, role: PartyRole): void {
  const tr = editor.state.tr
  removeFrom(tr.doc, role).forEach((at) => tr.delete(at, at + 1))
  editor.view.dispatch(tr.setMeta(PLACING, true))
}

// Positions of `role`'s spots, last first so deleting one doesn't shift the rest.
function removeFrom(doc: PMNode, role: PartyRole): number[] {
  const found: number[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'signatureSpot' && node.attrs.role === role) found.unshift(pos)
  })
  return found
}

// Each spot's offset in the document's plain text (see plainTextOf), where a spot takes no space.
export function spotOffsets(doc: JSONContent): Partial<Record<PartyRole, number>> {
  const offsets: Partial<Record<PartyRole, number>> = {}
  let pos = 0
  const walk = (node: JSONContent) => {
    if (node.type === 'text') pos += node.text?.length ?? 0
    else if (node.type === 'signatureSpot') offsets[node.attrs?.role as PartyRole] = pos
    else if (!node.content) pos += 1
    else {
      node.content.forEach(walk)
      if (node.type !== 'doc') pos += 1
    }
  }
  walk(doc)
  return offsets
}
