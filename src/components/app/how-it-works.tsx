'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { Clapperboard, PlayCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  HELP_VIDEOS,
  posterUrl,
  VIDEO_LANGS,
  videoForPath,
  videoUrl,
  type HelpVideo,
  type VideoLang,
} from '@/lib/help-videos'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const LANG_KEY = 'sf-video-lang'

function initialLang(): VideoLang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved && VIDEO_LANGS.some((l) => l.code === saved)) return saved as VideoLang
  } catch {
    // storage may be blocked; fall through to the browser language
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en'
  return (VIDEO_LANGS.find((l) => l.code === nav)?.code ?? 'en') as VideoLang
}

/**
 * "How it works": plays the video for the page you are on, in English,
 * Tamil, Hindi or Telugu (remembered), with the other videos one tap away.
 */
export function HowItWorks({
  area,
  className,
  videoId,
  label = 'How it works',
  trigger,
}: {
  area: HelpVideo['area']
  className?: string
  /** Play just this video (e.g. the setup video on the homepage). */
  videoId?: string
  label?: string
  /** A custom opener instead of the small header button. */
  trigger?: (open: () => void) => React.ReactNode
}) {
  const pathname = usePathname()
  const videos = React.useMemo(
    () => HELP_VIDEOS.filter((v) => v.area === area && (!videoId || v.id === videoId)),
    [area, videoId],
  )
  const forPage = videoForPath(pathname)
  const [open, setOpen] = React.useState(false)
  const [lang, setLang] = React.useState<VideoLang>('en')
  const [current, setCurrent] = React.useState<HelpVideo | null>(null)
  const [failed, setFailed] = React.useState(false)

  function show() {
    setLang(initialLang())
    setCurrent(forPage && forPage.area === area ? forPage : (videos[0] ?? null))
    setFailed(false)
    setOpen(true)
  }

  function pickLang(code: VideoLang) {
    setLang(code)
    setFailed(false)
    try {
      localStorage.setItem(LANG_KEY, code)
    } catch {
      // not remembered; still plays
    }
  }

  if (!videos.length) return null
  const video = current ?? videos[0]
  const phone = video.format === 'phone'

  return (
    <>
      {trigger ? trigger(show) : (
      <button
        type="button"
        onClick={show}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-xl border border-marigold-300/60 bg-gradient-to-b from-marigold-50 to-white px-2.5 text-xs font-semibold text-marigold-800 shadow-xs transition hover:border-marigold-400 hover:shadow-sm sm:px-3',
          className,
        )}
        aria-label="Watch how this page works"
      >
        <PlayCircle className="size-4 text-marigold-600" />
        <span className="hidden sm:inline">{label}</span>
      </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl" className="max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clapperboard className="size-4 text-marigold-600" />
              {video.title[lang]}
            </DialogTitle>
            <DialogDescription>Short video guide · voice and captions in your language</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Video language">
            {VIDEO_LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                role="radio"
                aria-checked={lang === l.code}
                onClick={() => pickLang(l.code)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-semibold transition',
                  lang === l.code ? 'border-ink-950 bg-ink-950 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300',
                )}
              >
                {l.label}
              </button>
            ))}
          </div>

          <div className={cn('mt-3 grid gap-4', videos.length > 1 && 'lg:grid-cols-[1fr_15rem]')}>
            <div className="min-w-0">
              <div
                className={cn(
                  'relative mx-auto overflow-hidden rounded-2xl bg-ink-950 ring-1 ring-black/5',
                  phone ? 'aspect-[390/844] max-h-[68dvh] w-auto' : 'aspect-video w-full',
                )}
              >
                {failed ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-white">
                    <PlayCircle className="size-10 text-marigold-300" />
                    <p className="text-sm font-semibold">This video is coming soon in this language.</p>
                    <p className="text-xs text-white/60">Try another language above.</p>
                  </div>
                ) : (
                  <video
                    key={`${video.id}-${lang}`}
                    className="h-full w-full object-contain"
                    src={videoUrl(video.id, lang)}
                    poster={posterUrl(video.id, lang)}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                    onError={() => setFailed(true)}
                  />
                )}
              </div>
            </div>

            {videos.length > 1 && (
              <ol className="max-h-[60dvh] space-y-1 overflow-y-auto pr-1 scrollbar-slim">
                {videos.map((v, i) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setCurrent(v)
                        setFailed(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition',
                        v.id === video.id ? 'bg-blue-50 font-semibold text-blue-800 ring-1 ring-blue-200' : 'text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold',
                          v.id === video.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500',
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 truncate">{v.title[lang]}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
