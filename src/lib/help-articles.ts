/**
 * Help centre articles (/app/help). Static and short: each one walks through
 * a real StayFlow flow and links to the page where it happens. Keep them in
 * step with the product when a flow changes.
 */

export type HelpBlock =
  | { type: 'p'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'tip'; text: string }

export type HelpArticle = {
  slug: string
  title: string
  section: HelpSection
  summary: string
  keywords: string
  body: HelpBlock[]
  links: { label: string; href: string }[]
}

export const HELP_SECTIONS = ['Getting started', 'Residents', 'Money', 'Messages', 'Your team', 'Troubleshooting'] as const
export type HelpSection = (typeof HELP_SECTIONS)[number]

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'getting-started',
    title: 'Getting started with StayFlow',
    section: 'Getting started',
    summary: 'The setup wizard, in the order that gets you collecting rent fastest.',
    keywords: 'setup wizard onboarding first steps checklist trial',
    body: [
      { type: 'p', text: 'A new account opens the setup wizard. It saves your progress, so you can stop and come back any time.' },
      {
        type: 'steps',
        items: [
          'Your PG and its address.',
          'Rooms and beds, then the standard rent, deposit and food plan.',
          'Payments and WhatsApp: connect them now or skip and do it later from Settings.',
          'Invite your team, if anyone helps you run the PG.',
          'Add your residents — one by one, or import your register from Excel.',
        ],
      },
      { type: 'tip', text: 'Your dashboard keeps a Getting started checklist until every step is done.' },
    ],
    links: [
      { label: 'Open the setup wizard', href: '/app/setup' },
      { label: 'Import data', href: '/app/import' },
    ],
  },
  {
    slug: 'pgs-rooms-beds',
    title: 'Adding PGs, rooms and beds',
    section: 'Getting started',
    summary: 'Create a PG, then its floors, rooms and beds, with a rent on each bed.',
    keywords: 'property pg building floor room bed rent sharing add edit archive maintenance',
    body: [
      {
        type: 'steps',
        items: [
          'Go to Properties and choose Add PG.',
          'Open the PG and add floors, then rooms on each floor. Choose the sharing (single, double, 3 sharing…) and StayFlow creates the beds.',
          'Set the rent per bed. Each bed can have its own rent if some cost more, for example a window bed or an AC room.',
          'Use Rooms & Beds to see every bed: vacant, occupied, reserved, under maintenance or blocked.',
        ],
      },
      { type: 'tip', text: 'A bed marked under maintenance is not offered at check-in until you mark it available again.' },
    ],
    links: [
      { label: 'Properties', href: '/app/properties' },
      { label: 'Rooms & Beds', href: '/app/beds' },
    ],
  },
  {
    slug: 'check-in',
    title: 'Checking in a resident',
    section: 'Residents',
    summary: 'The six-step check-in: personal details, guardian, KYC, bed, rent and review.',
    keywords: 'check in new resident admission join kyc aadhaar guardian deposit advance bed',
    body: [
      {
        type: 'steps',
        items: [
          'Residents → Check in resident, or Quick action → Add resident on mobile.',
          'Personal: name, mobile number and joining date.',
          'Guardian: an emergency contact.',
          'KYC: ID type and number, and occupation.',
          'Room & bed: pick a vacant bed. Only beds that are free on the joining date are offered.',
          'Rent & food: the monthly rent, deposit, and any food or other charges.',
          'Review and confirm. The first invoice is raised and the bed is marked occupied.',
        ],
      },
      { type: 'tip', text: 'If the resident should use the resident app, choose Create app login on their profile: they get a link to set their own password.' },
    ],
    links: [{ label: 'Check in a resident', href: '/app/residents/new' }],
  },
  {
    slug: 'rent-and-payments',
    title: 'How rent, reminders and payments work',
    section: 'Money',
    summary: 'Invoices are raised automatically every month; payments are applied to the oldest dues first.',
    keywords: 'rent invoice monthly due date late fee reminder payment record cash upi receipt outstanding',
    body: [
      { type: 'p', text: 'Every morning StayFlow raises the month’s rent invoices on your invoice day, sends reminders and adds late fees, following Settings → Billing and Reminders.' },
      {
        type: 'steps',
        items: [
          'Cash, UPI or bank transfer: open the resident and choose Record payment. Add the UTR so it is easy to match with your bank statement.',
          'A payment is applied to the oldest unpaid invoice first. Anything left over is kept as advance.',
          'The resident gets a receipt, in the app and on WhatsApp if it is switched on.',
          'Recorded a payment by mistake? Reverse it from Payments with a reason. Nothing is deleted; the reversal is kept in the activity log.',
        ],
      },
      { type: 'tip', text: 'The daily collection report under Reports shows everything collected on a day, by method, for matching with your cash and bank.' },
    ],
    links: [
      { label: 'Rent & Payments', href: '/app/rent' },
      { label: 'Billing settings', href: '/app/settings?tab=billing' },
      { label: 'Daily collection', href: '/app/reports/daily-collection' },
    ],
  },
  {
    slug: 'razorpay',
    title: 'Collecting rent online with Razorpay',
    section: 'Money',
    summary: 'Connect your own Razorpay account so residents pay by UPI or card and payments are marked automatically.',
    keywords: 'razorpay online payment gateway upi card api key webhook secret connect',
    body: [
      { type: 'p', text: 'Rent goes straight into your own Razorpay account. StayFlow never holds your money.' },
      {
        type: 'steps',
        items: [
          'Sign in at dashboard.razorpay.com and finish KYC so live mode is available.',
          'Account & Settings → API Keys → Generate Key. Copy the Key ID and Key Secret (Razorpay shows the secret only once).',
          'Account & Settings → Webhooks → Add new webhook. Use the URL shown on StayFlow’s Online payments page, choose any strong secret, and tick payment.captured and payment.failed.',
          'In StayFlow, open Settings → Online payments, paste the Key ID, Key Secret and webhook secret, then Verify & save.',
        ],
      },
      { type: 'tip', text: 'Until Razorpay is connected, residents see your UPI ID instead and you mark those payments received by hand.' },
    ],
    links: [{ label: 'Online payments settings', href: '/app/settings/payments' }],
  },
  {
    slug: 'whatsapp',
    title: 'WhatsApp reminders and messages',
    section: 'Messages',
    summary: 'What StayFlow sends on WhatsApp, how to switch types off, and how to test.',
    keywords: 'whatsapp message reminder template test opt out stop number meta business notification',
    body: [
      { type: 'p', text: 'Rent reminders, receipts, complaint updates, announcements, welcome and checkout messages can go out on WhatsApp.' },
      {
        type: 'steps',
        items: [
          'Settings → Notifications: switch each message type on or off, separately for the app and WhatsApp.',
          'Settings → WhatsApp: send yourself a test message and preview each template with sample values.',
          'To send from your own WhatsApp Business number, connect it on the same page with your Meta phone number ID and access token. Otherwise messages use the StayFlow number.',
          'The Message centre shows every message with its status: sent, delivered, read or failed. Failed WhatsApp messages can be retried.',
        ],
      },
      { type: 'tip', text: 'A resident who replies STOP gets no more WhatsApp messages. You can see them, and opt them back in at their request, under Settings → WhatsApp.' },
    ],
    links: [
      { label: 'WhatsApp settings', href: '/app/settings/whatsapp' },
      { label: 'Notification settings', href: '/app/settings/notifications' },
      { label: 'Message centre', href: '/app/messages' },
    ],
  },
  {
    slug: 'import',
    title: 'Importing from Excel or CSV',
    section: 'Getting started',
    summary: 'Move rooms, residents and opening balances from your register or spreadsheet.',
    keywords: 'import excel csv xlsx spreadsheet migrate register rooms residents balances upload mapping',
    body: [
      {
        type: 'steps',
        items: [
          'Go to Import data and choose what you are importing: rooms & beds, residents, or opening balances. Import in that order.',
          'Upload your .xlsx or .csv file (up to 2,000 rows at a time).',
          'Match your columns to StayFlow’s fields. Common names like “Room No” or “Mobile” are matched for you.',
          'Check the preview: every row shows ready, warning or error. Nothing is saved yet.',
          'Import. Rows with errors are skipped; download the error report, fix those rows and import them again.',
        ],
      },
      { type: 'tip', text: 'Importing the same file twice does not create duplicates — rows already in StayFlow are reported and skipped.' },
    ],
    links: [{ label: 'Import data', href: '/app/import' }],
  },
  {
    slug: 'roles',
    title: 'Team, roles and permissions',
    section: 'Your team',
    summary: 'Invite managers and staff, and decide exactly what each role can see and do.',
    keywords: 'team manager staff warden accountant role permission access invite login features modules',
    body: [
      {
        type: 'steps',
        items: [
          'Settings → Roles: start from a template (Manager, Accountant, Warden, Cook, Housekeeping…) or create your own, and tick what the role may do.',
          'Settings → Team → Invite manager, with their name, email and mobile. They get a link to set their own password.',
          'A manager can be limited to some PGs; they then see only those PGs’ residents, rent and complaints.',
          'Staff who use the worker app are added under Staff; choose Create worker login to send them a link.',
          'Settings → Features: switch off modules you do not use, such as Grocery. They disappear for everyone.',
        ],
      },
      { type: 'tip', text: 'As the owner you always have every permission. Changes to roles apply the next time the person opens a page.' },
    ],
    links: [
      { label: 'Roles', href: '/app/settings?tab=roles' },
      { label: 'Team', href: '/app/settings?tab=team' },
      { label: 'Features', href: '/app/settings?tab=features' },
    ],
  },
  {
    slug: 'checkout',
    title: 'Checkout and deposit settlement',
    section: 'Residents',
    summary: 'Notice, room check, settlement and refund — and closing the settlement.',
    keywords: 'checkout check out exit vacate notice deposit refund settlement deduction damage inspection clearance pdf lock transfer move bed',
    body: [
      {
        type: 'steps',
        items: [
          'When a resident gives notice, open their profile → Mark notice period, so the bed shows as soon-to-be vacant.',
          'On the exit day choose Check out & settle (or Quick action → Checkout). Step 1: the exit date.',
          'Room check: tick the inspection and clearance items, and mark any room asset damaged or missing with a deduction.',
          'Settlement: StayFlow works out rent up to the exit date, unpaid dues, charges and deductions against the deposit and advance.',
          'Refund: record how the balance was paid back. The bed becomes vacant.',
          'From the resident’s settlement card, download the settlement PDF and close the settlement. After closing, corrections go through credit or debit notes.',
        ],
      },
      { type: 'tip', text: 'Moving someone to another bed is Move to another bed, not a checkout. You can set a new rent from the move date at the same time.' },
    ],
    links: [{ label: 'Residents', href: '/app/residents' }],
  },
  {
    slug: 'expenses-pnl',
    title: 'Expenses and profit & loss',
    section: 'Money',
    summary: 'Record bills, set up recurring ones, approvals, and how P&L is worked out.',
    keywords: 'expense bill vendor recurring approval void profit loss pnl report electricity salary',
    body: [
      {
        type: 'steps',
        items: [
          'Expenses → Record an expense: PG, category, amount, vendor, bill number and a photo of the bill.',
          'Rent, salaries or internet every month? Switch on Repeats and StayFlow adds it on schedule.',
          'Expenses at or above your approval amount (Settings → Rent & billing) recorded by staff wait for the owner’s approval before they count.',
          'A wrong expense is voided with a reason, not deleted, so your books keep a record.',
          'Profit & loss shows money collected minus approved expenses, by month and by PG. Deposits are not counted as income.',
        ],
      },
    ],
    links: [
      { label: 'Expenses', href: '/app/expenses' },
      { label: 'Profit & loss', href: '/app/reports/pnl' },
    ],
  },
  {
    slug: 'electricity',
    title: 'Electricity meters and bills',
    section: 'Money',
    summary: 'Set up every room’s meter once, then each month type the readings: StayFlow works out each person’s share and adds it to rent.',
    keywords: 'electricity eb meter reading units rate tariff sub-meter split share room bill checkout warden setup all rooms',
    body: [
      { type: 'p', text: 'Part 1 happens once. Part 2 takes a few minutes every month.' },
      { type: 'p', text: 'Part 1 · Set up (once per PG)' },
      {
        type: 'steps',
        items: [
          'Open Electricity and pick the PG. The setup card appears.',
          'Step 1: type your price per unit (what the electricity board charges you) and the month it starts from. Save.',
          'Step 2: every room is listed in one table. Keep the tick on rooms with their own meter, check the meter number (MTR-101 is filled in for you; change it to the number printed on the meter) and type what the meter shows today. Press Enter to jump to the next room. Then Save all meters.',
          'Step 3 explains the monthly routine. Tap Enter this month’s readings when you are ready.',
        ],
      },
      { type: 'p', text: 'Part 2 · Every month' },
      {
        type: 'steps',
        items: [
          'Read every room’s meter (or let your warden do it in the staff app under Meter readings).',
          'Open Electricity. Each room shows its last reading; type this month’s reading. Units and the amount appear as you type. Readings your warden already saved are filled in.',
          'Tap Calculate split. Under each room you see who pays what: only the people who actually stayed, by their days in the room.',
          'Tap Confirm and add to rent. Each person’s share goes on their next rent invoice. Done.',
        ],
      },
      { type: 'p', text: 'Example: last month 1,250, this month 1,340 means 90 units. At ₹13 per unit the room’s bill is ₹1,170. Three people who stayed all month pay ₹390 each; someone who moved in halfway pays about half a share. Empty beds never pay.' },
      { type: 'p', text: 'Changing the price later never changes bills already made. Use Electricity → Rates to set a new price from a month onwards.' },
      { type: 'p', text: 'At checkout, type the room’s meter reading on the exit date. The leaver pays for their days up to that date in their settlement.' },
      { type: 'tip', text: 'Prefer an equal split among the people living there on the reading date, or a separate electricity bill? Change it in Settings → Rent & billing.' },
    ],
    links: [
      { label: 'Electricity', href: '/app/electricity' },
      { label: 'Meters', href: '/app/electricity/meters' },
      { label: 'Rates', href: '/app/electricity/rates' },
    ],
  },
  {
    slug: 'paying-for-stayflow',
    title: 'Paying for StayFlow, the grace period and missed payments',
    section: 'Money',
    summary: 'How your StayFlow subscription is billed, the reminders you get, the grace period with full access, and what happens if a payment is missed.',
    keywords: 'subscription pay stayflow invoice bill grace period overdue paused suspended expired paywall utr upi bank transfer reminder trial',
    body: [
      { type: 'p', text: 'Each PG has one StayFlow subscription: one bed’s rent a month. Your invoices are under Subscription.' },
      { type: 'p', text: 'Reminders you get (default timings)' },
      {
        type: 'steps',
        items: [
          'Before your free trial ends (3 days and 1 day before).',
          'When an invoice is raised, the day before it is due and on the due day.',
          'During the grace period, with 3 days and 1 day left.',
          'When a payment is received.',
        ],
      },
      { type: 'p', text: 'They always appear in the app. On the Subscription page, under Billing reminders, choose whether you also get them on WhatsApp and email.' },
      { type: 'p', text: 'Grace period' },
      { type: 'p', text: 'If an invoice is not paid by its due date, your account stays fully active for the grace period shown on your Subscription page. Nothing is locked and there is no penalty. Owners and managers see a banner with the amount and the last active day.' },
      { type: 'p', text: 'If the grace period ends unpaid' },
      { type: 'p', text: 'The account is paused. Owners and managers see a “Subscription expired” screen with the amount due and ways to pay; residents and staff see that the app is temporarily paused. All your data is kept safe.' },
      { type: 'p', text: 'How to pay' },
      {
        type: 'steps',
        items: [
          'Pay online with Pay now (UPI, card or netbanking). Access returns the moment it succeeds.',
          'Or pay by UPI or bank transfer to the details shown, then tap “I’ve paid” and enter the UTR (and a screenshot if you have one). We verify it and switch your account back on.',
        ],
      },
      { type: 'tip', text: 'Set up AutoPay on the Subscription page and the monthly payment happens by itself — you only hear from us if it fails.' },
    ],
    links: [{ label: 'Open Subscription', href: '/app/subscription' }],
  },
  {
    slug: 'autopay',
    title: 'Rent AutoPay for residents',
    section: 'Money',
    summary: 'Residents approve UPI AutoPay, a bank eMandate or a card once; each month the exact rent is debited on the day they choose, into your Razorpay account.',
    keywords: 'autopay auto pay upi autopay emandate e-mandate nach recurring standing instruction debit salary day due date mandate card',
    body: [
      { type: 'p', text: 'AutoPay runs on your own Razorpay account, so connect Razorpay under Settings → Online payments first.' },
      { type: 'p', text: 'Turn it on (once)' },
      {
        type: 'steps',
        items: [
          'Open Settings → Rent & billing and find AutoPay for residents.',
          'Switch on Offer AutoPay to residents.',
          'Set the days residents may choose, for example 1 to 10. Days after the 28th are not allowed, so every month has the day.',
          'Set the limit (by default 150% of each resident’s usual monthly bill, so electricity and small extras fit) and how many days a failed debit is retried. Save.',
        ],
      },
      { type: 'p', text: 'What residents do' },
      {
        type: 'steps',
        items: [
          'On their Rent page they tap Set up AutoPay, pick UPI AutoPay, bank account or card, and choose their debit day, for example the 7th, right after salary day.',
          'They approve it in their UPI app, bank or card (UPI and cards: a one-time ₹1; bank eMandates take a few days to confirm).',
          'The chosen day also becomes their rent due day from the next invoice, so no late fee or overdue mark can land before the debit.',
        ],
      },
      { type: 'p', text: 'Every month, StayFlow sends a reminder the day before (“₹8,624 will be debited on 7 Nov”), then debits the exact invoice amount: rent, electricity share and any charges, never more than the limit. The receipt appears by itself.' },
      { type: 'p', text: 'If a debit fails it is tried again on the next days you allowed; after that you and the resident are told, and they can pay from the Rent page as usual.' },
      { type: 'p', text: 'Residents can change their day (within your window) or cancel AutoPay at any time. You can change a resident’s day or cancel their AutoPay from their profile → Rent tab. Changes apply from the next invoice; invoices already raised keep their due date.' },
      { type: 'tip', text: 'Narrowing the allowed days later never moves anyone’s date by itself. Rent & Payments shows how many residents have a day outside the window, so you can pick new ones.' },
    ],
    links: [
      { label: 'AutoPay settings', href: '/app/settings?tab=billing' },
      { label: 'Rent & Payments', href: '/app/rent' },
      { label: 'Online payments', href: '/app/settings/payments' },
    ],
  },
  {
    slug: 'troubleshooting',
    title: 'Something is not working',
    section: 'Troubleshooting',
    summary: 'Quick fixes for the most common problems.',
    keywords: 'problem error not working reminder not sent payment not showing login cannot feature off no access suspended',
    body: [
      { type: 'p', text: 'Reminders did not go out: check Settings → Notifications (the type may be off), the Message centre (failed or demo status), and whether the resident replied STOP.' },
      { type: 'p', text: 'An online payment is not showing: open Settings → Online payments and check the connection status and the webhook. The payment appears once Razorpay confirms it.' },
      { type: 'p', text: 'A resident or manager cannot sign in: use Resend login link on their profile, the Staff page or Settings → Team. Old links stop working once used or expired.' },
      { type: 'p', text: '“This feature is switched off”: the owner can switch it on in Settings → Features. “No access”: the person’s role needs that permission.' },
      { type: 'p', text: 'Account paused: pay the pending invoice on the Subscription page; everything comes back straight away.' },
      { type: 'tip', text: 'Still stuck? Open a support ticket with a screenshot. The StayFlow team replies there.' },
    ],
    links: [
      { label: 'Message centre', href: '/app/messages' },
      { label: 'Contact support', href: '/app/support?new=1' },
    ],
  },
]

/** Case-insensitive match on title, summary, keywords and section. */
export function searchHelp(query: string, articles: HelpArticle[] = HELP_ARTICLES): HelpArticle[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return articles
  return articles.filter((a) => {
    const hay = `${a.title} ${a.summary} ${a.keywords} ${a.section}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export const helpArticle = (slug: string) => HELP_ARTICLES.find((a) => a.slug === slug)
