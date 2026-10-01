import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { inputClass } from '../Login'
import { Modal } from './PeopleDialog'

type Method = 'DRAWN' | 'TYPED' | 'UPLOADED'

const tabs: { method: Method; label: string }[] = [
  { method: 'DRAWN', label: 'Draw' },
  { method: 'TYPED', label: 'Type' },
  { method: 'UPLOADED', label: 'Upload' },
]

const WIDTH = 600
const HEIGHT = 200
const INK = '#1d3f8f'

// The signature cropped to its ink, so it sits at a sensible size in the PDF.
function trimmed(canvas: HTMLCanvasElement): string | null {
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
  let [left, top, right, bottom] = [canvas.width, canvas.height, -1, -1]
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > 0) {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
  }
  if (right < 0) return null
  const out = document.createElement('canvas')
  out.width = right - left + 9
  out.height = bottom - top + 9
  out.getContext('2d')!.drawImage(canvas, left, top, out.width - 8, out.height - 8, 4, 4, out.width - 8, out.height - 8)
  return out.toDataURL('image/png')
}

interface SignDialogProps {
  contractId: string
  orgName: string
  defaultName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onReopenInstead: () => void
}

export function SignDialog({ contractId, orgName, defaultName, open, onOpenChange, onReopenInstead }: SignDialogProps) {
  const [method, setMethod] = useState<Method>('DRAWN')
  const [typed, setTyped] = useState(defaultName)
  const [hasInk, setHasInk] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  const context = () => canvas.current?.getContext('2d') ?? null
  const clear = () => {
    context()?.clearRect(0, 0, WIDTH, HEIGHT)
    setHasInk(false)
  }

  // The dialog's content mounts on open, so the canvas exists from then on.
  useEffect(() => {
    if (!open) return
    setError('')
    setAgreed(false)
    clear()
  }, [open, method])

  useEffect(() => {
    if (!open || method !== 'TYPED') return
    const font = '72px Caveat'
    void document.fonts.load(font).then(() => {
      const ctx = context()
      if (!ctx) return
      ctx.clearRect(0, 0, WIDTH, HEIGHT)
      ctx.font = font
      ctx.fillStyle = INK
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(typed, WIDTH / 2, HEIGHT / 2, WIDTH - 20)
      setHasInk(typed.trim() !== '')
    })
  }, [open, method, typed])

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return [((event.clientX - rect.left) / rect.width) * WIDTH, ((event.clientY - rect.top) / rect.height) * HEIGHT] as const
  }

  function upload(file: File) {
    setError('')
    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Choose a PNG or JPG image under 2 MB.')
      return
    }
    const image = new Image()
    image.onload = () => {
      const ctx = context()!
      ctx.clearRect(0, 0, WIDTH, HEIGHT)
      const scale = Math.min(WIDTH / image.width, HEIGHT / image.height, 1)
      const [w, h] = [image.width * scale, image.height * scale]
      ctx.drawImage(image, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h)
      // A photo or scan of a signature on paper: make the near-white paper see-through.
      const pixels = ctx.getImageData(0, 0, WIDTH, HEIGHT)
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (pixels.data[i] > 200 && pixels.data[i + 1] > 200 && pixels.data[i + 2] > 200) pixels.data[i + 3] = 0
      }
      ctx.putImageData(pixels, 0, 0)
      URL.revokeObjectURL(image.src)
      setHasInk(true)
    }
    image.src = URL.createObjectURL(file)
  }

  async function sign() {
    const image = canvas.current && trimmed(canvas.current)
    if (!image) {
      setError('Add your signature first.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api(`/contracts/${contractId}/sign`, { body: { image, method, agreed } })
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Sign for ${orgName}`} open={open} onOpenChange={onOpenChange}>
      <p className="text-sm leading-relaxed text-ink-muted">
        Read the{' '}
        <a className="text-action underline" href={`/api/contracts/${contractId}/signing/document`} target="_blank" rel="noreferrer">
          document to sign
        </a>{' '}
        first. Your signature goes where it's marked, or on the signature page.
      </p>

      <div className="mt-6 flex gap-1 border-b border-rule" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.method}
            type="button"
            role="tab"
            aria-selected={method === tab.method}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${method === tab.method ? 'border-action text-ink' : 'border-transparent text-ink-muted'}`}
            onClick={() => setMethod(tab.method)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {method === 'TYPED' && (
        <input className={`${inputClass} mt-4`} value={typed} maxLength={80} aria-label="Your name" onChange={(e) => setTyped(e.target.value)} />
      )}
      {method === 'UPLOADED' && (
        <input className="mt-4 block text-sm" type="file" accept="image/png,image/jpeg" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      )}
      <canvas
        ref={canvas}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Signature"
        className={`mt-4 w-full touch-none rounded-sm border border-dashed border-rule bg-paper ${method === 'DRAWN' ? 'cursor-crosshair' : ''}`}
        onPointerDown={(event) => {
          if (method !== 'DRAWN') return
          drawing.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          const ctx = context()!
          ctx.beginPath()
          ctx.moveTo(...point(event))
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return
          const ctx = context()!
          ctx.lineWidth = 3
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.strokeStyle = INK
          ctx.lineTo(...point(event))
          ctx.stroke()
          setHasInk(true)
        }}
        onPointerUp={() => {
          drawing.current = false
        }}
      />
      {method === 'DRAWN' && (
        <div className="mt-1 flex justify-between text-xs text-ink-muted">
          <span>Draw with your mouse or finger.</span>
          <button type="button" className="underline" onClick={clear}>Clear</button>
        </div>
      )}

      <label className="mt-6 flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        I agree this is my signature and that I'm signing this contract for {orgName}.
      </label>
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={busy || !agreed || !hasInk} onClick={() => void sign()}>Sign</Button>
        <Button size="lg" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <button type="button" className="ml-auto text-sm text-ink-muted underline" onClick={onReopenInstead}>
          Don't sign. Reopen instead
        </button>
      </div>
    </Modal>
  )
}
