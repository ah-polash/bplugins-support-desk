'use client'
import { useRef, useCallback, useEffect } from 'react'
import { Bold, Italic, Underline, List, ListOrdered, Link, Image as ImageIcon } from 'lucide-react'
import toast from 'react-hot-toast'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
}

function ToolbarBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
    >
      {children}
    </button>
  )
}

export default function RichTextEditor({ value, onChange, placeholder = 'Write your reply...', minHeight = 140 }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isInternalUpdate = useRef(false)

  // Sync external value → editor (only on mount or external change)
  useEffect(() => {
    if (!editorRef.current) return
    if (editorRef.current.innerHTML !== value) {
      isInternalUpdate.current = true
      editorRef.current.innerHTML = value
      isInternalUpdate.current = false
    }
  }, [value])

  const exec = useCallback((cmd: string, val?: string) => {
    document.execCommand(cmd, false, val)
    editorRef.current?.focus()
    if (editorRef.current) onChange(editorRef.current.innerHTML)
  }, [onChange])

  const handleInput = () => {
    if (editorRef.current && !isInternalUpdate.current) {
      onChange(editorRef.current.innerHTML)
    }
  }

  const insertLink = () => {
    const url = prompt('Enter URL:')
    if (url) exec('createLink', url)
  }

  const uploadImage = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error('Upload failed')
      const { url } = await res.json()
      exec('insertImage', url)
    } catch {
      toast.error('Image upload failed')
    }
  }

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadImage(file)
    e.target.value = ''
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) await uploadImage(file)
        return
      }
    }
    // For plain text paste, strip formatting
    const plain = e.clipboardData.getData('text/plain')
    if (plain && !e.clipboardData.getData('text/html')) {
      e.preventDefault()
      document.execCommand('insertText', false, plain)
    }
  }

  return (
    <div className="rounded-lg border border-gray-300 dark:border-gray-600 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-gray-200 dark:border-gray-600 px-2 py-1.5 flex-wrap">
        <ToolbarBtn onClick={() => exec('bold')} title="Bold">
          <Bold className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec('italic')} title="Italic">
          <Italic className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec('underline')} title="Underline">
          <Underline className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <div className="mx-1.5 h-4 w-px bg-gray-300 dark:bg-gray-600" />
        <ToolbarBtn onClick={() => exec('insertUnorderedList')} title="Bullet list">
          <List className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec('insertOrderedList')} title="Numbered list">
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <div className="mx-1.5 h-4 w-px bg-gray-300 dark:bg-gray-600" />
        <ToolbarBtn onClick={insertLink} title="Insert link">
          <Link className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => fileInputRef.current?.click()} title="Insert image">
          <ImageIcon className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={handleInput}
        onPaste={handlePaste}
        className="prose max-w-none px-4 py-3 text-sm text-gray-900 dark:text-gray-100 focus:outline-none"
        style={{ minHeight }}
      />
    </div>
  )
}
