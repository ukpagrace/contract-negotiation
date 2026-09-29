import { useState } from 'react'
import { SimpleEditor } from '@/components/tiptap-templates/simple/simple-editor'
import './editor.css'
function editor() {
  return (
        <>
            <SimpleEditor content={{ type: "doc", content: [] }} editable />
        </>
  )
}

export default editor