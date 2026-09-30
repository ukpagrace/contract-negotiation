import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Anchor } from '@/lib/api'

export interface AnchoredThread extends Anchor {
  threadId: string
}

interface Flat {
  text: string
  // Document position of each character; -1 for the newline that ends a block.
  positions: number[]
}

const CONTEXT = 30

// Mirrors plainText() in the API: every block ends with a newline, so quotes match there too.
function flatten(doc: PMNode): Flat {
  const flat: Flat = { text: '', positions: [] }
  const walk = (node: PMNode, pos: number) => {
    if (node.isText) {
      flat.text += node.text
      for (let i = 0; i < node.text!.length; i++) flat.positions.push(pos + i)
      return
    }
    if (node.type.name === 'hardBreak') {
      flat.text += '\n'
      flat.positions.push(pos)
      return
    }
    node.forEach((child, offset) => walk(child, pos + 1 + offset))
    flat.text += '\n'
    flat.positions.push(-1)
  }
  doc.forEach((child, offset) => walk(child, offset))
  return flat
}

export function anchorFromSelection(state: EditorState): Anchor | null {
  const { from, to, empty } = state.selection
  if (empty) return null
  const { text, positions } = flatten(state.doc)
  const inside = positions.flatMap((pos, i) => (pos >= from && pos < to ? [i] : []))
  if (inside.length === 0) return null
  const first = inside[0]
  const last = inside[inside.length - 1]
  const quote = text.slice(first, last + 1)
  if (quote.trim() === '') return null
  return { quote, prefix: text.slice(Math.max(0, first - CONTEXT), first), suffix: text.slice(last + 1, last + 1 + CONTEXT) }
}

function commonLength(a: string, b: string, fromEnd: boolean): number {
  let n = 0
  while (n < a.length && n < b.length && (fromEnd ? a[a.length - 1 - n] === b[b.length - 1 - n] : a[n] === b[n])) n++
  return n
}

// Picks the occurrence of the quote whose surrounding text best matches the saved context.
function locate({ text, positions }: Flat, anchor: Anchor): { from: number; to: number } | null {
  let best = -1
  let bestScore = -1
  for (let i = text.indexOf(anchor.quote); i !== -1; i = text.indexOf(anchor.quote, i + 1)) {
    const score =
      commonLength(text.slice(Math.max(0, i - anchor.prefix.length), i), anchor.prefix, true) +
      commonLength(text.slice(i + anchor.quote.length), anchor.suffix, false)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  if (best === -1) return null
  const inRange = positions.slice(best, best + anchor.quote.length).filter((pos) => pos !== -1)
  if (inRange.length === 0) return null
  return { from: inRange[0], to: inRange[inRange.length - 1] + 1 }
}

interface AnchorState {
  threads: AnchoredThread[]
  decorations: DecorationSet
  found: string[]
}

export const commentAnchorsKey = new PluginKey<AnchorState>('commentAnchors')

function build(doc: PMNode, threads: AnchoredThread[]): AnchorState {
  const flat = flatten(doc)
  const decorations: Decoration[] = []
  const found: string[] = []
  for (const thread of threads) {
    const range = locate(flat, thread)
    if (!range) continue
    found.push(thread.threadId)
    decorations.push(Decoration.inline(range.from, range.to, { class: 'comment-anchor', 'data-thread-id': thread.threadId }))
  }
  return { threads, decorations: DecorationSet.create(doc, decorations), found }
}

export interface CommentAnchorsOptions {
  // Called with the ids of threads whose text is still in the document; the rest are outdated.
  onFound: (threadIds: string[]) => void
}

// Threads are handed in with a transaction meta: tr.setMeta(commentAnchorsKey, threads).
export const CommentAnchors = Extension.create<CommentAnchorsOptions>({
  name: 'commentAnchors',

  addOptions() {
    return { onFound: () => undefined }
  },

  addProseMirrorPlugins() {
    const { onFound } = this.options
    return [
      new Plugin<AnchorState>({
        key: commentAnchorsKey,
        state: {
          init: (_config, state) => build(state.doc, []),
          apply(tr, value, _old, state) {
            const threads = tr.getMeta(commentAnchorsKey) as AnchoredThread[] | undefined
            if (threads) return build(state.doc, threads)
            return tr.docChanged ? build(state.doc, value.threads) : value
          },
        },
        props: {
          decorations: (state) => commentAnchorsKey.getState(state)?.decorations,
        },
        view: () => ({
          update(view, prevState) {
            const next = commentAnchorsKey.getState(view.state)!
            const prev = commentAnchorsKey.getState(prevState)!
            if (next.threads !== prev.threads || next.found.join() !== prev.found.join()) onFound(next.found)
          },
        }),
      }),
    ]
  },
})
