// import { useState, useEffect } from 'react'
// import { Editor } from '@tiptap/react'

// export interface ActiveTrackedChange {
//   type: 'insertion' | 'deletion'
//   author: string
//   timestamp?: number
//   from: number
//   to: number
//   text: string
// }

// export function useTrackedChangeSelection(editor: Editor | null) {
//   const [activeChange, setActiveChange] = useState<ActiveTrackedChange | null>(null)

//   useEffect(() => {
//     if (!editor) return

//     const updateSelection = () => {
//       const { selection, doc } = editor.state
//       const { $from } = selection

//       // Find if cursor or selection touches an insertion or deletion mark
//       const marks = $from.marks()
//       const insertionMark = marks.find((m) => m.type.name === 'trackedInsertion')
//       const deletionMark = marks.find((m) => m.type.name === 'trackedDeletion')

//       const activeMark = insertionMark || deletionMark
//       if (!activeMark) {
//         setActiveChange(null)
//         return
//       }

//       const markType = insertionMark ? 'insertion' : 'deletion'

//       // Calculate the start and end boundary of the contiguous mark range
//       let from = $from.pos
//       let to = $from.pos

//       // Scan backwards to find mark start
//       doc.nodesBetween(Math.max(0, $from.pos - 500), $from.pos, (node, pos) => {
//         if (node.isText && node.marks.some((m) => m === activeMark)) {
//           if (from === $from.pos) from = pos
//         }
//       })

//       // Scan forwards to find mark end
//       doc.nodesBetween($from.pos, Math.min(doc.content.size, $from.pos + 500), (node, pos) => {
//         if (node.isText && node.marks.some((m) => m === activeMark)) {
//           to = pos + node.nodeSize
//         }
//       })

//       const text = doc.textBetween(from, to)

//       setActiveChange({
//         type: markType,
//         author: activeMark.attrs.author || 'Anonymous',
//         timestamp: activeMark.attrs.timestamp,
//         from,
//         to,
//         text,
//       })
//     }

//     editor.on('selectionUpdate', updateSelection)
//     editor.on('transaction', updateSelection)

//     return () => {
//       editor.off('selectionUpdate', updateSelection)
//       editor.off('transaction', updateSelection)
//     }
//   }, [editor])

//   return activeChange
// }

import { useState, useEffect, useCallback } from 'react'
import { Editor } from '@tiptap/react'

export interface ActiveTrackedChange {
  type: 'insertion' | 'deletion'
  author: string
  timestamp?: number
  from: number
  to: number
  text: string
}

export function useTrackedChangeSelection(editor: Editor | null) {
  const [activeChange, setActiveChange] = useState<ActiveTrackedChange | null>(null)

  // Helper to extract mark details at a specific document position
  const getChangeAtPos = useCallback(
    (pos: number): ActiveTrackedChange | null => {
      if (!editor || editor.isDestroyed) return null

      const { doc } = editor.state
      const $pos = doc.resolve(Math.min(pos, doc.content.size))
      const marks = $pos.marks()

      const insertionMark = marks.find((m) => m.type.name === 'trackedInsertion')
      const deletionMark = marks.find((m) => m.type.name === 'trackedDeletion')
      const activeMark = insertionMark || deletionMark

      if (!activeMark) return null

      const markType = insertionMark ? 'insertion' : 'deletion'

      // Find boundaries of the contiguous mark
      let from = pos
      let to = pos

      while (from > 0) {
        if (!doc.resolve(from - 1).marks().some((m) => m.type === activeMark.type)) break
        from--
      }

      while (to < doc.content.size) {
        if (!doc.resolve(to + 1).marks().some((m) => m.type === activeMark.type)) break
        to++
      }

      return {
        type: markType,
        author: activeMark.attrs.author || 'Anonymous',
        timestamp: activeMark.attrs.timestamp,
        from,
        to,
        text: doc.textBetween(from, to),
      }
    },
    [editor]
  )

  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    // 1. Handle Selection / Click Events
    const handleSelectionUpdate = () => {
      const { $from } = editor.state.selection
      const change = getChangeAtPos($from.pos)
      if (change) {
        setActiveChange(change)
      }
    }

    // 2. Handle Mouse Hover Events
    const viewDom = editor.view.dom

    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return

      // Check if mouse is hovering over an insertion or deletion span
      const trackedElem = target.closest('[data-tracked-insertion], [data-tracked-deletion]')
      if (trackedElem) {
        // Convert DOM coordinates to ProseMirror document position
        const pos = editor.view.posAtDOM(trackedElem, 0)
        const change = getChangeAtPos(pos)
        if (change) {
          setActiveChange(change)
        }
      }
    }

    const handleMouseLeave = (event: MouseEvent) => {
      // Clear hover state when leaving the editor canvas if selection isn't inside a mark
      const { $from } = editor.state.selection
      const changeOnSelection = getChangeAtPos($from.pos)
      if (!changeOnSelection) {
        setActiveChange(null)
      }
    }

    // Register event listeners
    editor.on('selectionUpdate', handleSelectionUpdate)
    editor.on('transaction', handleSelectionUpdate)
    viewDom.addEventListener('mouseover', handleMouseOver)
    viewDom.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
      editor.off('transaction', handleSelectionUpdate)
      viewDom.removeEventListener('mouseover', handleMouseOver)
      viewDom.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [editor, getChangeAtPos])

  return activeChange
}



