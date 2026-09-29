import { TableButton } from "./table-button"
import { 
  Rows, 
  Columns, 
  Trash2, 
  Plus, 
  Combine, 
  Split,
  Heading1,
  Paintbrush
} from "lucide-react"
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { Button } from "@/components/tiptap-ui-primitive/button"


export function TableToolbarControls() {
    const { editor } = useTiptapEditor()
    const isInTable = editor?.isActive("table")
  return (
    <div className="flex items-center gap-1">
  {isInTable && (
    <>
      <div className="h-4 w-[1px] bg-gray-300 mx-1" /> {/* Divider line */}

      {/* --- CELL MERGING & SPLITTING --- */}
      <Button
        type="button"
        variant="ghost"
        disabled={!editor?.can().mergeCells()}
        onClick={() => editor.chain().focus().mergeCells().run()}
        tooltip="Merge Selected Cells"
      >
        <Combine className="h-4 w-4" />
      </Button>

      <Button
        type="button"
        variant="ghost"
        disabled={!editor?.can().splitCell()}
        onClick={() => editor.chain().focus().splitCell().run()}
        tooltip="Split Cell"
      >
        <Split className="h-4 w-4" />
      </Button>

      <div className="h-4 w-[1px] bg-gray-200 mx-1" />

      {/* --- CELL STYLING & HEADERS --- */}
      <Button
        type="button"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
        tooltip="Toggle Header Row"
      >
        <Heading1 className="h-4 w-4" />
      </Button>

      {/* Highlight Cell (Yellow Shading) */}
      <Button
        type="button"
        variant="ghost"
        onClick={() => editor.chain().focus().setCellAttribute("backgroundColor", "#fef08a").run()}
        tooltip="Highlight Cell (Yellow)"
      >
        <Paintbrush className="h-4 w-4 text-yellow-600" />
      </Button>

      {/* Clear Cell Shading */}
      <Button
        type="button"
        variant="ghost"
        onClick={() => editor.chain().focus().setCellAttribute("backgroundColor", "").run()}
        tooltip="Clear Highlight"
      >
        <Paintbrush className="h-4 w-4 text-gray-400" />
      </Button>

      <div className="h-4 w-[1px] bg-gray-200 mx-1" />

      {/* --- ROWS & COLUMNS --- */}
      <Button
        type="button"
        variant="ghost"
        onClick={() => editor.chain().focus().addRowAfter().run()}
        tooltip="Add Row Below"
      >
        <Rows className="h-4 w-4" />
      </Button>

      <Button
        type="button"
        variant="ghost"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        tooltip="Add Column Right"
      >
        <Columns className="h-4 w-4" />
      </Button>

      {/* --- DELETE TABLE --- */}
      <Button
        type="button"
        variant="ghost"
        onClick={() => editor.chain().focus().deleteTable().run()}
        tooltip="Delete Table"
      >
        <Trash2 className="h-4 w-4 text-red-500" />
      </Button>
    </>
  )}
</div>
    

  )
}