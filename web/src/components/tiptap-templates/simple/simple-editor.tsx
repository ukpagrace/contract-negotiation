"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { EditorContent, EditorContext, useEditor, useEditorState, type JSONContent } from "@tiptap/react"

// --- Tiptap Core Extensions ---
import { StarterKit } from "@tiptap/starter-kit"
import { Image } from "@tiptap/extension-image"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TextAlign } from "@tiptap/extension-text-align"
import { Typography } from "@tiptap/extension-typography"
import {Color} from '@tiptap/extension-color'
import {Table} from '@tiptap/extension-table'
import {TableRow} from '@tiptap/extension-table-row'
import {TableCell} from '@tiptap/extension-table-cell'
import {TableHeader} from '@tiptap/extension-table-header'
import {CharacterCount} from '@tiptap/extension-character-count'
import { Highlight } from "@tiptap/extension-highlight"
import { Subscript } from "@tiptap/extension-subscript"
import { Superscript } from "@tiptap/extension-superscript"
import { FindAndReplace } from "@tiptap/extension-find-and-replace"
import { Selection } from "@tiptap/extensions"
import {TextStyle} from '@tiptap/extension-text-style'
// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"
import { Spacer } from "@/components/tiptap-ui-primitive/spacer"
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/tiptap-ui-primitive/toolbar"

import {
  BubbleMenu, // <--- Add this line here!
} from '@tiptap/react/menus'
import { ChevronLeft, ChevronRight } from "lucide-react"

// --- Tiptap Node ---
import { ImageUploadNode } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension"
import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension"
import "@/components/tiptap-node/blockquote-node/blockquote-node.scss"
import "@/components/tiptap-node/code-block-node/code-block-node.scss"
import "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss"
import "@/components/tiptap-node/list-node/list-node.scss"
import "@/components/tiptap-node/image-node/image-node.scss"
import "@/components/tiptap-node/heading-node/heading-node.scss"
import "@/components/tiptap-node/paragraph-node/paragraph-node.scss"

// --- Tiptap UI ---
import { HeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu"
import { ListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu"
import { BlockquoteButton } from "@/components/tiptap-ui/blockquote-button"
import { CodeBlockButton } from "@/components/tiptap-ui/code-block-button"
import {
  ColorHighlightPopover,
  ColorHighlightPopoverContent,
  ColorHighlightPopoverButton,
} from "@/components/tiptap-ui/color-highlight-popover"
import {
  LinkPopover,
  LinkContent,
  LinkButton,
} from "@/components/tiptap-ui/link-popover"
import { MarkButton } from "@/components/tiptap-ui/mark-button"
import { TextAlignButton } from "@/components/tiptap-ui/text-align-button"
import { UndoRedoButton } from "@/components/tiptap-ui/undo-redo-button"
import {
  SearchAndReplace,
  SearchAndReplaceButton,
} from "@/components/tiptap-ui/search-and-replace"

// --- Icons ---
import { ArrowLeftIcon } from "@/components/tiptap-icons/arrow-left-icon"
import { HighlighterIcon } from "@/components/tiptap-icons/highlighter-icon"
import { LinkIcon } from "@/components/tiptap-icons/link-icon"

// --- Hooks ---
import { useIsBreakpoint } from "@/hooks/use-is-breakpoint"
import { useWindowSize } from "@/hooks/use-window-size"
import { useCursorVisibility } from "@/hooks/use-cursor-visibility"

// --- Components ---

// --- Lib ---
import { handleImageUpload, MAX_FILE_SIZE } from "@/lib/tiptap-utils"

// --- Styles ---
import "@/components/tiptap-templates/simple/simple-editor.scss"

import { TableButton } from "@/components/tiptap-ui/table-button/table-button"
// import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { TableToolbarControls } from "@/components/tiptap-ui/table-button"
// import type { ListStylePreset } from "@/components/tiptap-ui/list-style/list-style"
import { RedlineExtension } from "@/components/tiptap-ui/redlining/redlineExtension"
import {
  anchorFromSelection,
  CommentAnchors,
  commentAnchorsKey,
  type AnchoredThread,
} from "@/components/tiptap-ui/redlining/commentAnchors"
import { placeSpot, removeSpot, SignatureSpot } from "@/components/tiptap-ui/redlining/signatureSpot"
import type { Anchor, PartyRole } from "@/lib/api"

import { type ViewMode } from "@/components/tiptap-ui/redlining/RedlineToolbar"
// import BubbleMenu from "@tiptap/extension-bubble-menu"




const SEARCH_AND_REPLACE_SCROLL_OPTIONS: ScrollIntoViewOptions = {
  block: "center",
}

const viewClassMap = {
  'full-redline': '',
  'counterparty-only': 'tiptap-view-counterparty',
  'final': 'tiptap-view-final',
}

const MainToolbarContent = ({
  onHighlighterClick,
  onLinkClick,
  onSearchAndReplaceClick,
  isSearchAndReplaceOpen,
  searchAndReplaceButtonRef,
  isMobile,
  onComment,
  canComment,
}: {
  onHighlighterClick: () => void
  onLinkClick: () => void
  onSearchAndReplaceClick: () => void
  isSearchAndReplaceOpen: boolean
  searchAndReplaceButtonRef: React.RefObject<HTMLButtonElement | null>
  isMobile: boolean
  onComment?: () => void
  canComment: boolean
}) => {

  // const { editor } = useTiptapEditor()
  return (
    <>
      <Spacer />

      {onComment && (
        <ToolbarGroup>
          <Button
            type="button"
            variant="ghost"
            disabled={!canComment}
            onClick={onComment}
            tooltip="Comment on selected text"
            shortcutKeys="mod+alt+m"
          >
            Comment
          </Button>
        </ToolbarGroup>
      )}

      {onComment && <ToolbarSeparator />}

      <ToolbarGroup>
        <UndoRedoButton action="undo" />
        <UndoRedoButton action="redo" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <HeadingDropdownMenu modal={false} levels={[1, 2, 3, 4]} />
        <ListDropdownMenu
          modal={false}
          types={["bulletList", "orderedList", "taskList"]}
        />
        {/* <ListStylePicker
          currentStyle={activeListStyle}
          onSelectStyle={(style) => setActiveListStyle(style)}
        /> */}
        <BlockquoteButton />
        <CodeBlockButton />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="bold" />
        <MarkButton type="italic" />
        <MarkButton type="strike" />
        <MarkButton type="code" />
        <MarkButton type="underline" />
        {!isMobile ? (
          <ColorHighlightPopover />
        ) : (
          <ColorHighlightPopoverButton onClick={onHighlighterClick} />
        )}
        {!isMobile ? <LinkPopover /> : <LinkButton onClick={onLinkClick} />}
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="superscript" />
        <MarkButton type="subscript" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <TextAlignButton align="left" />
        <TextAlignButton align="center" />
        <TextAlignButton align="right" />
        <TextAlignButton align="justify" />
      </ToolbarGroup>

      <ToolbarSeparator />
      <TableButton/>
      <TableToolbarControls/>


      <Spacer />

      {isMobile && <ToolbarSeparator />}

      <ToolbarGroup>
        <SearchAndReplaceButton
          ref={searchAndReplaceButtonRef}
          aria-expanded={isSearchAndReplaceOpen}
          data-active-state={isSearchAndReplaceOpen ? "on" : "off"}
          onClick={onSearchAndReplaceClick}
        />
      </ToolbarGroup>
    </>
  )
}

const MobileToolbarContent = ({
  type,
  onBack,
}: {
  type: "highlighter" | "link"
  onBack: () => void
}) => (
  <>
    <ToolbarGroup>
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeftIcon className="tiptap-button-icon" />
        {type === "highlighter" ? (
          <HighlighterIcon className="tiptap-button-icon" />
        ) : (
          <LinkIcon className="tiptap-button-icon" />
        )}
      </Button>
    </ToolbarGroup>

    <ToolbarSeparator />

    {type === "highlighter" ? (
      <ColorHighlightPopoverContent />
    ) : (
      <LinkContent />
    )}
  </>
)

interface SimpleEditorProps {
  content: JSONContent
  editable: boolean
  onChange?: (content: JSONContent) => void
  // Set once the contract has been sent: edits become tracked changes attributed to this side.
  trackAsPartyId?: string
  // Comment threads to highlight; onAnchorsFound reports which ones were found in the text.
  anchors?: AnchoredThread[]
  onAnchorsFound?: (threadIds: string[]) => void
  // When set, comments can be started from selected text: a popup while reading, the toolbar
  // or Ctrl/Cmd+Alt+M while editing.
  onComment?: (anchor: Anchor) => void
  // Shown in the reading popup after Comment.
  readingAction?: ReactNode
  // Chip text for each side's signature spot.
  spotLabels?: Record<PartyRole, string>
  // Placing mode: a click in the text puts this side's spot there; clicking a spot picks it up.
  placingRole?: PartyRole | null
  onSpotPicked?: (role: PartyRole) => void
}

export function SimpleEditor({ content, editable, onChange, trackAsPartyId, anchors, onAnchorsFound, onComment, readingAction, spotLabels, placingRole, onSpotPicked }: SimpleEditorProps) {
  const isMobile = useIsBreakpoint()
  const { height } = useWindowSize()
  const [mobileView, setMobileView] = useState<"main" | "highlighter" | "link">(
    "main"
  )
  const [isSearchAndReplaceOpen, setIsSearchAndReplaceOpen] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const searchAndReplaceButtonRef = useRef<HTMLButtonElement>(null)

  const [viewMode] = useState<ViewMode>('full-redline')
  // The editor is created once, so it calls the latest callback through a ref.
  const onAnchorsFoundRef = useRef(onAnchorsFound)
  onAnchorsFoundRef.current = onAnchorsFound
  const commentRef = useRef<() => void>(() => undefined)

  const editor = useEditor({
    immediatelyRender: false,
    editorProps: {
      attributes: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        "aria-label": "Main content area, start typing to enter text.",
        class: "simple-editor",
      },
    },
    extensions: [
      StarterKit.configure({
        horizontalRule: false,
        link: {
          openOnClick: false,
          enableClickSelection: true,
        },
      }),
      RedlineExtension.configure({
        enabled: Boolean(trackAsPartyId),
        partyId: trackAsPartyId ?? "",
      }),
      CommentAnchors.configure({
        onFound: (ids) => onAnchorsFoundRef.current?.(ids),
        onShortcut: () => commentRef.current(),
      }),
      ...(spotLabels ? [SignatureSpot.configure({ labels: spotLabels })] : [SignatureSpot]),
      TextStyle,
      Color, 
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      CharacterCount,
      HorizontalRule,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Image,
      Typography,
      Superscript,
      Subscript,
      Selection,
      FindAndReplace.configure({
        searchDebounceMs: 500,
        injectCSS: false,
      }),
      ImageUploadNode.configure({
        accept: "image/*",
        maxSize: MAX_FILE_SIZE,
        limit: 3,
        upload: handleImageUpload,
        onError: (error) => console.error("Upload failed:", error),
      }),
    ],
    content,
    editable,
    onUpdate: ({ editor }) => onChange?.(editor.getJSON()),
  })

  useEffect(() => {
    editor?.setEditable(editable)
    // Keeps whatever was selected while reading, so Edit from the popup can go straight to Delete.
    if (editable) editor?.commands.focus()
  }, [editor, editable])

  // The toolbar scrolls sideways with a hidden scrollbar, so show which sides have more buttons.
  const [overflow, setOverflow] = useState({ left: false, right: false })
  useEffect(() => {
    const bar = toolbarRef.current
    if (!editable || !bar) return
    const update = () =>
      setOverflow({ left: bar.scrollLeft > 1, right: bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1 })
    update()
    bar.addEventListener("scroll", update)
    const observer = new ResizeObserver(update)
    observer.observe(bar)
    return () => {
      bar.removeEventListener("scroll", update)
      observer.disconnect()
    }
  }, [editable, mobileView])

  const hasSelection = useEditorState({ editor, selector: ({ editor }) => Boolean(editor && !editor.state.selection.empty) }) ?? false

  commentRef.current = () => {
    if (!editor || !onComment) return
    const anchor = anchorFromSelection(editor.state)
    editor.commands.setTextSelection(editor.state.selection.to)
    if (anchor) onComment(anchor)
  }

  useEffect(() => {
    if (editor && anchors) editor.view.dispatch(editor.state.tr.setMeta(commentAnchorsKey, anchors))
  }, [editor, anchors])

  const rect = useCursorVisibility({
    editor,
    overlayHeight: toolbarRef.current?.getBoundingClientRect().height ?? 0,
  })

  useEffect(() => {
    if (!isMobile && mobileView !== "main") {
      setMobileView("main")
    }
  }, [isMobile, mobileView])

  const openSearchAndReplace = useCallback(() => {
    setMobileView("main")
    setIsSearchAndReplaceOpen(true)
  }, [])

  const closeSearchAndReplace = useCallback(() => {
    setIsSearchAndReplaceOpen(false)
    searchAndReplaceButtonRef.current?.focus()
  }, [])

  const toggleSearchAndReplace = useCallback(() => {
    if (isSearchAndReplaceOpen) {
      closeSearchAndReplace()
      return
    }

    openSearchAndReplace()
  }, [closeSearchAndReplace, isSearchAndReplaceOpen, openSearchAndReplace])

  // const [activeListStyle, setActiveListStyle] = useState<ListStylePreset>("standard")
  return (
    <div className="simple-editor-wrapper">
      <EditorContext.Provider value={{ editor }}>
        {editable && <Toolbar
          ref={toolbarRef}
          style={{
            ...(isMobile
              ? {
                  bottom: `calc(100% - ${height - rect.y}px)`,
                }
              : {}),
          }}
        >
          {overflow.left && (
            <div
              aria-hidden
              className="toolbar-scroll-hint"
              data-side="left"
              onClick={() => toolbarRef.current?.scrollBy({ left: -240, behavior: "smooth" })}
            >
              <ChevronLeft size={18} />
            </div>
          )}
          {mobileView === "main" ? (
            <MainToolbarContent
              onHighlighterClick={() => setMobileView("highlighter")}
              onLinkClick={() => setMobileView("link")}
              onSearchAndReplaceClick={toggleSearchAndReplace}
              isSearchAndReplaceOpen={isSearchAndReplaceOpen}
              searchAndReplaceButtonRef={searchAndReplaceButtonRef}
              isMobile={isMobile}
              onComment={onComment && (() => commentRef.current())}
              canComment={hasSelection}
            />
          ) : (
            <MobileToolbarContent
              type={mobileView === "highlighter" ? "highlighter" : "link"}
              onBack={() => setMobileView("main")}
            />
          )}
          {overflow.right && (
            <div
              aria-hidden
              className="toolbar-scroll-hint"
              data-side="right"
              onClick={() => toolbarRef.current?.scrollBy({ left: 240, behavior: "smooth" })}
            >
              <ChevronRight size={18} />
            </div>
          )}
        </Toolbar>}

        <SearchAndReplace
          className="simple-editor-search-and-replace"
          open={isSearchAndReplaceOpen}
          onOpen={openSearchAndReplace}
          onClose={closeSearchAndReplace}
          scrollIntoViewOptions={SEARCH_AND_REPLACE_SCROLL_OPTIONS}
        />

        {editor && onComment && !editable && (
          <BubbleMenu editor={editor} shouldShow={({ state }) => !state.selection.empty}>
            {/* preventDefault keeps the text selected while clicking. */}
            <div className="comment-bubble" onMouseDown={(event) => event.preventDefault()}>
              <button type="button" onClick={() => commentRef.current()}>Comment</button>
              {readingAction}
            </div>
          </BubbleMenu>
        )}

        <div
          className={`${viewClassMap[viewMode]} ${placingRole !== undefined ? "placing-spots" : ""}`}
          onClick={(event) => {
            if (!editor || placingRole === undefined) return
            const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-signature-spot]")
            if (chip) {
              const role = chip.dataset.signatureSpot as PartyRole
              removeSpot(editor, role)
              onSpotPicked?.(role)
              return
            }
            const hit = placingRole && editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (hit) placeSpot(editor, placingRole, hit.pos)
          }}
        >
          <EditorContent
            editor={editor}
            role="presentation"
            className="simple-editor-content" 
            // data-list-style={activeListStyle}
          />
        </div>

      </EditorContext.Provider>
    </div>
  )
}
