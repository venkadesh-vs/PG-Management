'use client'

import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, ChevronLeft, ChevronRight, ImagePlus, Loader2, X } from 'lucide-react'
import { ApiError } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

/**
 * Camera-friendly photo picker. Photos are downscaled in the browser (max
 * 1600px, JPEG — which also strips EXIF such as GPS) and uploaded to
 * POST /api/uploads one by one with progress; `value` holds the resulting
 * `/api/uploads/<id>` URLs.
 */

export type UploadPurpose = 'COMPLAINT' | 'TASK_PROOF' | 'KYC' | 'OTHER'

const MAX_EDGE = 1600
const MAX_BYTES = 5 * 1024 * 1024

async function downscale(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  let bitmap: ImageBitmap | HTMLImageElement
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Older Safari: fall back to an <img>.
    try {
      bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = URL.createObjectURL(file)
      })
    } catch {
      return file // Unknown format (e.g. HEIC) — let the server decide.
    }
  }
  const w = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width
  const h = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  if ('close' in bitmap) bitmap.close()
  else URL.revokeObjectURL(bitmap.src)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  return blob ?? file
}

function uploadWithProgress(
  blob: Blob,
  fields: Record<string, string>,
  onProgress: (fraction: number) => void,
): Promise<{ id: string; url: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/uploads')
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onerror = () =>
      reject(
        new ApiError(
          navigator.onLine
            ? 'We could not reach StayFlow. Check your connection and try again.'
            : 'You are offline. Check your internet connection and try again.',
          0,
        ),
      )
    xhr.onload = () => {
      let payload: { id?: string; url?: string; error?: string } | null = null
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        payload = null
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload?.url && payload.id) {
        resolve({ id: payload.id, url: payload.url })
      } else {
        reject(
          new ApiError(
            payload?.error ??
              (xhr.status === 413 ? 'That photo is too large.' : 'The photo could not be uploaded. Please try again.'),
            xhr.status,
          ),
        )
      }
    }
    const form = new FormData()
    form.append('file', blob, blob instanceof File ? blob.name : 'photo.jpg')
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    xhr.send(form)
  })
}

type Pending = { tempId: string; preview: string; progress: number }

export function PhotoUpload({
  value,
  onChange,
  purpose,
  residentId,
  max = 3,
  label = 'Add photo',
  hint,
  disabled,
  onBusyChange,
  className,
}: {
  value: string[]
  onChange: (urls: string[]) => void
  purpose: UploadPurpose
  residentId?: string
  max?: number
  label?: string
  hint?: string
  disabled?: boolean
  /** True while any photo is still uploading — disable submit meanwhile. */
  onBusyChange?: (busy: boolean) => void
  className?: string
}) {
  const toast = useToast()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState<Pending[]>([])
  const valueRef = React.useRef(value)
  valueRef.current = value

  React.useEffect(() => {
    onBusyChange?.(pending.length > 0)
  }, [pending.length, onBusyChange])

  const remaining = max - value.length - pending.length

  async function handleFiles(list: FileList | null) {
    if (!list?.length) return
    const files = Array.from(list).slice(0, Math.max(0, remaining))
    if (list.length > files.length) {
      toast.info(`Up to ${max} photos`, `Only the first ${files.length || 'few'} were added.`)
    }
    for (const file of files) {
      const tempId = Math.random().toString(36).slice(2)
      const preview = URL.createObjectURL(file)
      setPending((p) => [...p, { tempId, preview, progress: 0 }])
      try {
        const blob = await downscale(file)
        if (blob.size > MAX_BYTES) throw new ApiError('That photo is larger than 5 MB even after shrinking it.', 413)
        const fields: Record<string, string> = { purpose }
        if (residentId) fields.residentId = residentId
        const res = await uploadWithProgress(blob, fields, (progress) =>
          setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, progress } : x))),
        )
        onChange([...valueRef.current, res.url])
      } catch (error) {
        toast.fromError(error, 'upload the photo')
      } finally {
        URL.revokeObjectURL(preview)
        setPending((p) => p.filter((x) => x.tempId !== tempId))
      }
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap gap-2">
        <AnimatePresence initial={false}>
          {value.map((url) => (
            <motion.div
              key={url}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative size-20 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked URL */}
              <img src={url} alt="Uploaded photo" className="size-full object-cover" />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((u) => u !== url))}
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-slate-900/70 text-white hover:bg-slate-900"
                  aria-label="Remove photo"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </motion.div>
          ))}
          {pending.map((p) => (
            <motion.div
              key={p.tempId}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative size-20 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              <img src={p.preview} alt="" className="size-full object-cover opacity-50" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-700">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-[11px] font-semibold">{Math.round(p.progress * 100)}%</span>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-slate-200">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${p.progress * 100}%` }} />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {remaining > 0 && !disabled && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex size-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 transition hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-600"
          >
            {value.length + pending.length === 0 ? <Camera className="size-5" /> : <ImagePlus className="size-5" />}
            <span className="px-1 text-center text-[11px] font-medium leading-tight">{label}</span>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={max - value.length > 1}
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <p className="text-xs text-slate-500">
        {hint ?? `Up to ${max} ${max === 1 ? 'photo' : 'photos'}. Take one with your camera or pick from your gallery.`}
      </p>
    </div>
  )
}

/** Thumbnail grid that opens a full-screen lightbox. */
export function PhotoGallery({
  urls,
  className,
  size = 'md',
}: {
  urls: string[]
  className?: string
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = React.useState<number | null>(null)
  const count = urls.length

  React.useEffect(() => {
    if (open === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(null)
      if (e.key === 'ArrowRight') setOpen((i) => (i === null ? i : (i + 1) % count))
      if (e.key === 'ArrowLeft') setOpen((i) => (i === null ? i : (i - 1 + count) % count))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, count])

  if (!count) return null
  return (
    <>
      <div className={cn('flex flex-wrap gap-2', className)}>
        {urls.map((url, i) => (
          <button
            key={url + i}
            type="button"
            onClick={() => setOpen(i)}
            className={cn(
              'overflow-hidden rounded-xl border border-slate-200 bg-slate-100 transition hover:-translate-y-px hover:shadow-md',
              size === 'sm' ? 'size-14' : 'size-24',
            )}
            aria-label={`Open photo ${i + 1}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked URL */}
            <img src={url} alt={`Photo ${i + 1}`} loading="lazy" className="size-full object-cover" />
          </button>
        ))}
      </div>
      <AnimatePresence>
        {open !== null && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Photo viewer"
          >
            <motion.img
              key={open}
              src={urls[open]}
              alt={`Photo ${open + 1} of ${count}`}
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              onClick={() => setOpen(null)}
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
            {count > 1 && (
              <>
                <button
                  type="button"
                  className="absolute left-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpen((open - 1 + count) % count)
                  }}
                  aria-label="Previous photo"
                >
                  <ChevronLeft className="size-5" />
                </button>
                <button
                  type="button"
                  className="absolute right-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpen((open + 1) % count)
                  }}
                  aria-label="Next photo"
                >
                  <ChevronRight className="size-5" />
                </button>
                <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/80">
                  {open + 1} / {count}
                </p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
