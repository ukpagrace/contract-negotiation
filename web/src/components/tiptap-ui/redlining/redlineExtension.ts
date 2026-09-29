import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { TrackedInsertion, TrackedDeletion } from './trackedMarks'

export interface RedlineOptions {
  enabled: boolean
  author: string
}

export const RedlineExtension = Extension.create<RedlineOptions>({
  name: 'redlineExtension',

  addOptions() {
    return {
      enabled: true,
      author: 'User_1',
    }
  },

  // Register the marks we created in Step 1
  addExtensions() {
    return [TrackedInsertion, TrackedDeletion]
  },

  // Transaction Interceptor: Automatically tag newly typed text as Insertion
  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin({
        key: new PluginKey('redlineAutoInsert'),
        appendTransaction(transactions, oldState, newState) {
          if (!extension.options.enabled) return null

          let tr = newState.tr
          let modified = false

          transactions.forEach((transaction) => {
            // Ignore non-document changes or remote updates
            if (!transaction.docChanged || transaction.getMeta('history$')) return

            transaction.steps.forEach((step) => {
              // Inspect range where new text was added
              step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
                if (newEnd > newStart) {
                  // Apply insertion mark over newly inserted range
                  tr.addMark(
                    newStart,
                    newEnd,
                    newState.schema.marks.trackedInsertion.create({
                      author: extension.options.author,
                    })
                  )
                  modified = true
                }
              })
            })
          })

          return modified ? tr : null
        },
      }),
    ]
  },

  // Keyboard Interceptor: Re-route Backspace to mark text as Deleted
//   addKeyboardShortcuts() {
//     return {
//       Backspace: ({ editor }) => {
//         // If redlining is disabled, let default Backspace happen
//         if (!this.options.enabled) return false

//         const { empty, from, to } = editor.state.selection

//         // Determine range to mark: selected text OR single previous character
//         const deleteFrom = empty ? Math.max(0, from - 1) : from
//         const deleteTo = to

//         if (deleteFrom === deleteTo) return false

//         // Apply deletion mark across the target range
//         editor
//           .chain()
//           .focus()
//           .setTextSelection({ from: deleteFrom, to: deleteTo })
//           .setMark('trackedDeletion', { author: this.options.author })
//           .setTextSelection(deleteTo) // Move cursor past the marked deletion
//           .run()

//         return true // Stop default browser deletion
//       },
//     }
//   },

addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        if (!this.options.enabled) return false

        const { empty, $from, from, to } = editor.state.selection

        let deleteFrom = from
        let deleteTo = to

        if (empty) {
          // If at the very start of a block, fallback to default block deletion/merge
          if ($from.parentOffset === 0) {
            return false
          }
          deleteFrom = Math.max(0, from - 1)
        }

        if (deleteFrom === deleteTo) return false

        const insertionMarkType = editor.schema.marks.trackedInsertion
        const deletionMarkType = editor.schema.marks.trackedDeletion

        // 1. Check if the target text was newly typed in this session (has trackedInsertion mark)
        const isNewlyInserted = editor.state.doc.rangeHasMark(
          deleteFrom,
          deleteTo,
          insertionMarkType
        )

        if (isNewlyInserted) {
          // ACTUALLY DELETE IT: User is just backspacing their own typo while typing
          editor.chain().focus().deleteRange({ from: deleteFrom, to: deleteTo }).run()
          return true
        }

        // 2. Check if it's ALREADY marked as deleted
        const isAlreadyDeleted = editor.state.doc.rangeHasMark(
          deleteFrom,
          deleteTo,
          deletionMarkType
        )

        if (isAlreadyDeleted) {
          // Jump cursor past already deleted text
          editor.commands.setTextSelection(deleteFrom)
          return true
        }

        // 3. Otherwise, mark existing text as DELETED (red strikethrough)
        editor
          .chain()
          .focus()
          .setTextSelection({ from: deleteFrom, to: deleteTo })
          .setMark('trackedDeletion', { author: this.options.author })
          .setTextSelection(deleteFrom)
          .run()

        return true
      },
    }
  },
})