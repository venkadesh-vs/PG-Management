/**
 * Homepage FAQ. Kept out of the client component so the page (a server
 * component) can also emit it as FAQPage structured data.
 */
export const FAQS: { q: string; a: string }[] = [
  {
    q: 'How long does it take to set up?',
    a: 'An afternoon. Add your PG, create floors and rooms — bulk-add handles a whole floor at once — then check residents in. Most owners start with one PG and add the next once they are comfortable.',
  },
  {
    q: 'Do my residents have to install an app?',
    a: 'No. The resident app runs in any phone browser. You share their login at check-in and they can add it to their home screen if they want to.',
  },
  {
    q: 'What happens to my old records?',
    a: 'You enter current residents once, with their joining date and rent. From then on the rent schedule, ledger and reports build themselves. You do not need to back-fill years of history.',
  },
  {
    q: 'Can my manager use it without seeing everything?',
    a: 'Yes. Managers run day-to-day operations but cannot change settings, delete a PG or touch the subscription. Workers only ever see their own task list.',
  },
  {
    q: 'How do residents pay rent?',
    a: 'By UPI from the resident app, or in cash which you record in one tap. Online payments are only marked paid after the payment gateway confirms them, so a receipt always means the money arrived.',
  },
  {
    q: 'Are reminders automatic?',
    a: 'Yes. Reminders go out before the due date, on it, and after it. WhatsApp reminders need your WhatsApp Business account connected; until then the app shows exactly what each resident would receive and marks it as not sent.',
  },
  {
    q: 'I run more than one PG. Does that work?',
    a: 'Yes. Each PG has its own rooms, rent configuration and subscription. You switch between them from one selector and can compare them side by side.',
  },
  {
    q: 'Does StayFlow use AI?',
    a: 'Not yet. An AI assistant and a daily brief are on our roadmap and marked “coming soon”. Everything described on this page works today without them.',
  },
  {
    q: 'Is my data safe?',
    a: 'Access is checked on the server for every request, each organization is isolated from every other, and every change is recorded in an activity log.',
  },
]
