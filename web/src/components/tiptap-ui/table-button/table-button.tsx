import React, { forwardRef, useCallback } from "react"
import { Button, type ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { useTable, type UseTableConfig } from "./use-table"
import { type Editor } from "@tiptap/react"

export interface TableButtonProps
  extends Omit<ButtonProps, "type">,
    UseTableConfig {
  text?: string
  action?: (editor: Editor) => void
}
export const TableButton = forwardRef<HTMLButtonElement, TableButtonProps>(
  (
    {
      editor: providedEditor,
      rows = 3,
      cols = 3,
      withHeaderRow = true,
      text,
      action,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { canInsert, isActive, handleInsertTable, label, Icon } = useTable({
      editor,
      rows,
      cols,
      withHeaderRow,
    })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        // handleInsertTable()
        if (action && editor) {
          action(editor)
        } else {
          handleInsertTable()
        }
      },
      [handleInsertTable, onClick]
    )

    return (
      <Button
        type="button"
        disabled={!canInsert}
        variant="ghost"
        data-active-state={isActive ? "on" : "off"}
        data-disabled={!canInsert}
        role="button"
        tabIndex={-1}
        aria-label={label}
        aria-pressed={isActive}
        tooltip={label}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="tiptap-button-icon" />
            {text && <span className="tiptap-button-text">{text}</span>}
          </>
        )}
      </Button>
    )
  }
)

TableButton.displayName = "TableButton"