import { Mark, mergeAttributes } from '@tiptap/core'

// Shared by both marks. Not inclusive, so text typed at the edge of someone else's
// change doesn't silently become part of it.
const changeAttributes = () => ({
  changeId: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-change-id') },
  authorPartyId: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-author-party') },
})

const render = (flag: string, title: string) =>
  ({ HTMLAttributes }: { HTMLAttributes: Record<string, string | null> }) =>
    [
      'span',
      mergeAttributes({
        [flag]: '',
        'data-change-id': HTMLAttributes.changeId,
        'data-author-party': HTMLAttributes.authorPartyId,
        title,
      }),
      0,
    ] as const

export const TrackedInsertion = Mark.create({
  name: 'trackedInsertion',
  inclusive: false,
  addAttributes: changeAttributes,
  parseHTML() {
    return [{ tag: 'span[data-tracked-insertion]' }]
  },
  renderHTML: render('data-tracked-insertion', 'Added, pending'),
})

export const TrackedDeletion = Mark.create({
  name: 'trackedDeletion',
  inclusive: false,
  addAttributes: changeAttributes,
  parseHTML() {
    return [{ tag: 'span[data-tracked-deletion]' }]
  },
  renderHTML: render('data-tracked-deletion', 'Removed, pending'),
})
