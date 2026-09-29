import { useCallback } from "react"
import { type Editor } from "@tiptap/react"
import { Table as TableIcon } from "lucide-react"

export interface UseTableConfig {
  editor?: Editor | null
  rows?: number
  cols?: number
  withHeaderRow?: boolean
}

export function useTable({
  editor,
  rows = 3,
  cols = 3,
  withHeaderRow = true,
}: UseTableConfig = {}) {
  const isAlreadyInTable = editor?.isActive("table") ?? false  
  const canInsert = (editor?.can().insertTable() ?? false) && !isAlreadyInTable
  const isActive = editor?.isActive("table") ?? false

  const handleInsertTable = useCallback(() => {
    if (!editor) return
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow })
      .run()
  }, [editor, rows, cols, withHeaderRow])

  return {
    canInsert,
    isActive,
    handleInsertTable,
    label: "Insert Table",
    Icon: TableIcon,
  }
}