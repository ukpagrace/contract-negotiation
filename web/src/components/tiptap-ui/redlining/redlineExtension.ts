import { Extension } from '@tiptap/core'
import { Fragment, Slice, type Mark, type MarkType, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Mapping, ReplaceStep } from '@tiptap/pm/transform'
import { TrackedDeletion, TrackedInsertion } from './trackedMarks'

export interface RedlineOptions {
  enabled: boolean
  partyId: string
}

// Transactions carrying this meta are not tracked (our own fix-ups, and later accept/reject).
export const SKIP_TRACKING = 'redlineSkip'

function ownChangeId(node: PMNode | null | undefined, type: MarkType, partyId: string): string | null {
  const mark = node?.marks.find((m: Mark) => m.type === type && m.attrs.authorPartyId === partyId)
  return mark ? (mark.attrs.changeId as string) : null
}

export const RedlineExtension = Extension.create<RedlineOptions>({
  name: 'redlineExtension',

  addOptions() {
    return { enabled: false, partyId: '' }
  },

  addExtensions() {
    return [TrackedInsertion, TrackedDeletion]
  },

  addProseMirrorPlugins() {
    const { enabled, partyId } = this.options
    let lastKey = ''

    return [
      new Plugin({
        key: new PluginKey('redline'),
        props: {
          handleKeyDown(_view, event) {
            lastKey = event.key
            return false
          },
        },
        // Every edit is rewritten after the fact: deleted text is put back with a deletion mark
        // (unless it was our own pending insertion) and inserted text gets an insertion mark.
        appendTransaction(transactions, _oldState, newState) {
          if (!enabled) return null
          const ins = newState.schema.marks.trackedInsertion
          const del = newState.schema.marks.trackedDeletion

          const all = new Mapping()
          const replaced: { step: ReplaceStep; doc: PMNode; index: number }[] = []
          for (const transaction of transactions) {
            const track = transaction.docChanged && !transaction.getMeta(SKIP_TRACKING) && !transaction.getMeta('history$')
            transaction.steps.forEach((step, i) => {
              if (track && step instanceof ReplaceStep) {
                replaced.push({ step, doc: transaction.docs[i], index: all.maps.length })
              }
              all.appendMap(transaction.mapping.maps[i])
            })
          }
          if (replaced.length === 0) return null

          const tr = newState.tr
          for (const { step, doc, index } of replaced) {
            const after = all.slice(index + 1)
            const pos = tr.mapping.map(after.map(step.from, -1), -1)
            const end = tr.mapping.map(after.map(step.from + step.slice.size, 1), 1)

            const $pos = tr.doc.resolve(pos)
            const deletionId =
              ownChangeId($pos.nodeBefore, del, partyId) ?? ownChangeId($pos.nodeAfter, del, partyId) ?? crypto.randomUUID()
            const deletionMark = del.create({ changeId: deletionId, authorPartyId: partyId })

            const restore = (fragment: Fragment): Fragment => {
              const nodes: PMNode[] = []
              fragment.forEach((node) => {
                if (!node.isText) nodes.push(node.copy(restore(node.content)))
                else if (ownChangeId(node, ins, partyId)) return
                else if (del.isInSet(node.marks)) nodes.push(node)
                else nodes.push(node.mark(deletionMark.addToSet(node.marks)))
              })
              return Fragment.fromArray(nodes)
            }

            let restoredSize = 0
            if (step.to > step.from) {
              const deleted = doc.slice(step.from, step.to)
              const sizeBefore = tr.doc.content.size
              tr.replace(pos, pos, new Slice(restore(deleted.content), deleted.openStart, deleted.openEnd))
              restoredSize = tr.doc.content.size - sizeBefore
            }

            const insStart = pos + restoredSize
            const insEnd = end + restoredSize
            if (insEnd > insStart) {
              tr.removeMark(insStart, insEnd, ins).removeMark(insStart, insEnd, del)
              const insertionId =
                ownChangeId(tr.doc.resolve(insStart).nodeBefore, ins, partyId) ??
                ownChangeId(tr.doc.resolve(insEnd).nodeAfter, ins, partyId) ??
                crypto.randomUUID()
              tr.addMark(insStart, insEnd, ins.create({ changeId: insertionId, authorPartyId: partyId }))
            }

            // Backspace should step over the text it just marked, so the next press reaches the previous character.
            // The key is used rather than the old selection, which can lag behind a click.
            if (restoredSize > 0 && lastKey === 'Backspace' && step.slice.size === 0 && replaced.length === 1) {
              tr.setSelection(TextSelection.create(tr.doc, pos))
            }
          }

          return tr.docChanged ? tr.setMeta(SKIP_TRACKING, true) : null
        },
      }),
    ]
  },
})
