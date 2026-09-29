import { Mark, mergeAttributes } from '@tiptap/core'

// 1. Insertion Mark (Green Text)
export const TrackedInsertion = Mark.create({
  name: 'trackedInsertion',

  // Defines metadata attached to each edit
  addAttributes() {
    return {
      author: { default: 'Anonymous' },
    }
  },

  // Tells Tiptap how to read this from saved HTML
  parseHTML() {
    return [{ tag: 'span[data-tracked-insertion]' }]
  },

  // Tells Tiptap how to render this to the DOM
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-tracked-insertion': '',
        'data-author': HTMLAttributes.author || 'Anonymous',
      }),
      0, // 0 represents the text content nested inside this span
    ]
  },
})

// 2. Deletion Mark (Red Strikethrough Text)
export const TrackedDeletion = Mark.create({
  name: 'trackedDeletion',

  addAttributes() {
    return {
      author: { default: 'Anonymous' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-tracked-deletion]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-tracked-deletion': '',
        'data-author': HTMLAttributes.author || 'Anonymous',
      }),
      0,
    ]
  },
})