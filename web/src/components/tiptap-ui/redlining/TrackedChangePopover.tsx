import React from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useTrackedChangeSelection } from './useTrackedChangeSelection'
import { useTiptapEditor } from '@/hooks/use-tiptap-editor';

interface TrackedChangePopoverProps {
//   onOpenComment?: (change: { from: number; to: number; text: string }) => void
}


export const TrackedChangePopover: React.FC<TrackedChangePopoverProps> = ({
//   onOpenComment,
}) => {

  const { editor } = useTiptapEditor()
  const activeChange = useTrackedChangeSelection(editor)

  if (!activeChange) return null

  // 1. Accept Handler
  const handleAccept = () => {
    const { type, from, to } = activeChange

    if (type === 'insertion') {
      // Keep text, remove green mark
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .unsetMark('trackedInsertion')
        .run()
    } else {
      // Actually erase the red text
      editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .run()
    }
  }

//   // 2. Reject Handler
  const handleReject = () => {
    const { type, from, to } = activeChange

    if (type === 'insertion') {
      // Discard newly inserted text
      editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .run()
    } else {
      // Restore deleted text back to normal
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .unsetMark('trackedDeletion')
        .run()
    }
  }

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({editor, state}) => {
        if (!editor.isFocused) return false

        if (state.selection.empty) return false
        // 2. Check if the current cursor or highlighted area is inside an active tracked change.
        // Replace 'suggestion', 'insertion', or 'deletion' with the exact names your extension uses.
        const isInsideInsertion = editor.isActive('trackedInsertion') 
        const isInsideDeletion = editor.isActive('trackedDeletion')

        // 3. Only return true if the cursor sits on one of these states
        return isInsideInsertion || isInsideDeletion
      }
      }
    >
      <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white shadow-xl">
        {/* Author & Change Type Metadata */}
        <div className="flex flex-col border-r border-slate-700 pr-3">
          <span className="font-semibold">{activeChange.author}</span>
          <span className={activeChange.type === 'insertion' ? 'text-green-400' : 'text-red-400'}>
            {activeChange.type === 'insertion' ? 'Proposed Addition' : 'Proposed Deletion'}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {/* Accept Button */}
          <button
            onClick={handleAccept}
            className="flex items-center gap-1 rounded bg-green-600/20 px-2 py-1 font-medium text-green-400 hover:bg-green-600/30 transition-colors"
            title="Accept Change"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Accept
          </button>

          {/* Reject Button */}
          <button
            onClick={handleReject}
            className="flex items-center gap-1 rounded bg-red-600/20 px-2 py-1 font-medium text-red-400 hover:bg-red-600/30 transition-colors"
            title="Reject Change"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Reject
          </button>

          {/* Comment Button */}
          <button
            // onClick={() => onOpenComment?.({ from: activeChange.from, to: activeChange.to, text: activeChange.text })}
            className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 font-medium text-slate-300 hover:bg-slate-700 transition-colors"
            title="Add Comment"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Reply
          </button>
        </div>
      </div>
    </BubbleMenu>
  )
}