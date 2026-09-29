// // Inside simple-editor.tsx or table-toolbar-controls.tsx
// import { BubbleMenu } from '@tiptap/extension-bubble-menu'
// import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// export function TableFloatingMenu() {
//   const { editor } = useTiptapEditor()

//   if (!editor) return null

//   return (
//     <BubbleMenu
//       editor={editor}
//       // 📍 Only show the menu when the cursor is inside a table
//       shouldShow={({ editor }) => editor.isActive('table')}
//       tippyOptions={{ duration: 100, placement: 'top' }}
//     >
//       <div className="flex items-center gap-1 border bg-popover p-1 shadow-md rounded-md">
//         <TableToolbarControls />
//       </div>
//     </BubbleMenu>
//   )
// }