/**
 * The how-it-works videos: one per main module, each in English, Tamil,
 * Hindi and Telugu. Files live in the private Backblaze bucket under
 * videos/<id>.<lang>.mp4 and play through /api/videos/<file>.
 */

export const VIDEO_LANGS = [
  { code: 'en', label: 'English' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'te', label: 'తెలుగు' },
] as const

export type VideoLang = (typeof VIDEO_LANGS)[number]['code']

export type HelpVideo = {
  id: string
  /** Title per language. */
  title: Record<VideoLang, string>
  /** Desktop (16:9) or phone (portrait) recording. */
  format: 'desktop' | 'phone'
  area: 'owner' | 'resident' | 'staff'
  /** Pages this video explains (path prefixes; '/app' alone is exact). */
  routes: string[]
}

export const HELP_VIDEOS: HelpVideo[] = [
  {
    id: 'setup',
    title: { en: 'Set up your PG', ta: 'உங்கள் PG-ஐ அமைக்கலாம்', hi: 'अपना PG सेट करें', te: 'మీ PG ని సెటప్ చేయండి' },
    format: 'desktop',
    area: 'owner',
    routes: ['/app/setup', '/app/properties/new'],
  },
  {
    id: 'dashboard',
    title: { en: 'Your dashboard', ta: 'உங்கள் டாஷ்போர்டு', hi: 'आपका डैशबोर्ड', te: 'మీ డ్యాష్‌బోర్డ్' },
    format: 'desktop',
    area: 'owner',
    routes: ['/app'],
  },
  {
    id: 'rooms',
    title: { en: 'Rooms, beds and rent card', ta: 'அறைகள், படுக்கைகள், வாடகை அட்டை', hi: 'कमरे, बेड और रेंट कार्ड', te: 'గదులు, బెడ్లు, రెంట్ కార్డ్' },
    format: 'desktop',
    area: 'owner',
    routes: ['/app/beds', '/app/properties', '/app/vacancy'],
  },
  {
    id: 'checkin',
    title: { en: 'Check in a resident', ta: 'குடியிருப்பாளரைச் சேர்ப்பது', hi: 'रेज़िडेंट को चेक-इन करें', te: 'రెసిడెంట్‌ని చెక్-ఇన్ చేయండి' },
    format: 'desktop',
    area: 'owner',
    routes: ['/app/residents', '/app/bookings', '/app/leads', '/app/import'],
  },
  {
    id: 'rent',
    title: { en: 'Rent and payments', ta: 'வாடகை மற்றும் பணம்', hi: 'किराया और पेमेंट', te: 'అద్దె మరియు పేమెంట్లు' },
    format: 'desktop',
    area: 'owner',
    routes: ['/app/rent', '/app/payments'],
  },
  {
    id: 'electricity',
    title: { en: 'Electricity by room meter', ta: 'அறை மீட்டர் மூலம் மின்சாரம்', hi: 'कमरे के मीटर से बिजली', te: 'గది మీటర్ ద్వారా కరెంట్' },
    format: 'desktop',
    area: 'owner',
    routes: ['/app/electricity'],
  },
  {
    id: 'food',
    title: { en: 'Food and the kitchen', ta: 'சாப்பாடு மற்றும் சமையலறை', hi: 'खाना और किचन', te: 'భోజనం మరియు వంటగది' },
    format: 'desktop',
    area: 'owner',
    routes: ['/app/food', '/app/grocery'],
  },
  {
    id: 'staff',
    title: { en: 'Your staff and their app', ta: 'உங்கள் ஊழியர்களும் அவர்களின் ஆப்பும்', hi: 'आपका स्टाफ और उनका ऐप', te: 'మీ సిబ్బంది మరియు వారి యాప్' },
    format: 'desktop',
    area: 'owner',
    routes: ['/app/staff', '/app/visitors', '/app/inventory'],
  },
  {
    id: 'complaints',
    title: { en: 'Complaints, solved on time', ta: 'புகார்கள், நேரத்தில் தீர்வு', hi: 'शिकायतें, समय पर हल', te: 'ఫిర్యాదులు, సమయానికి పరిష్కారం' },
    format: 'desktop',
    area: 'owner',
    routes: ['/app/complaints', '/app/requests', '/app/announcements', '/app/messages'],
  },
  {
    id: 'expenses',
    title: { en: 'Expenses', ta: 'செலவுகள்', hi: 'खर्च', te: 'ఖర్చులు' },
    format: 'desktop',
    area: 'owner',
    routes: ['/app/expenses'],
  },
  {
    id: 'reports',
    title: { en: 'Profit and reports', ta: 'லாபம் மற்றும் அறிக்கைகள்', hi: 'मुनाफ़ा और रिपोर्ट', te: 'లాభం మరియు రిపోర్టులు' },
    format: 'desktop',
    area: 'owner',
    routes: ['/app/reports', '/app/activity'],
  },
  {
    id: 'residentApp',
    title: { en: 'The resident app', ta: 'குடியிருப்பாளர் ஆப்', hi: 'रेज़िडेंट ऐप', te: 'రెసిడెంట్ యాప్' },
    format: 'phone',
    area: 'resident',
    routes: ['/tenant'],
  },
  {
    id: 'staffApp',
    title: { en: 'The staff app', ta: 'ஊழியர் ஆப்', hi: 'स्टाफ ऐप', te: 'స్టాఫ్ యాప్' },
    format: 'phone',
    area: 'staff',
    routes: ['/worker'],
  },
]

/** The video that explains this page, if any. The longest matching route wins. */
export function videoForPath(pathname: string): HelpVideo | null {
  let best: { video: HelpVideo; length: number } | null = null
  for (const video of HELP_VIDEOS) {
    for (const route of video.routes) {
      const match = route === '/app' ? pathname === '/app' : pathname === route || pathname.startsWith(route + '/')
      if (match && (!best || route.length > best.length)) best = { video, length: route.length }
    }
  }
  return best?.video ?? null
}

/** "residentApp" → "resident-app": how files are named in the bucket. */
export function videoFileStem(id: string) {
  return id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

export function videoUrl(id: string, lang: VideoLang) {
  return `/api/videos/${videoFileStem(id)}.${lang}.mp4`
}

export function posterUrl(id: string, lang: VideoLang) {
  return videoUrl(id, lang).replace(/\.mp4$/, '.jpg')
}
