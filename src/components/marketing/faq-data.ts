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
    q: 'Can residents pay rent automatically?',
    a: 'Yes, with AutoPay. A resident approves UPI AutoPay, a bank eMandate or a card once and picks their own debit date, such as the day after salary, within the days you allow (for example 1 to 10). Every month StayFlow debits the exact invoice amount, rent plus electricity and charges and never more than the limit they approved, into your own Razorpay account. They get a reminder the day before, their date is also their due date so no late fee lands first, and they can change the date or cancel at any time.',
  },
  {
    q: 'I run more than one PG. Does that work?',
    a: 'Yes. Each PG has its own rooms and rent card, and you switch between them from one selector. You get one StayFlow bill a month for all of them, due on the day you pick between the 1st and the 10th.',
  },
  {
    q: 'Is there a referral offer?',
    a: 'Yes. Every PG owner gets a referral code. When an owner you refer pays their first month, half of what they paid comes off your next bill: they pay ₹14,000, you get ₹7,000 credit. Credit takes up to half off each bill, and anything left carries to the next one. Each code works for up to 5 new owners.',
  },
  {
    q: 'Is my data safe?',
    a: 'Access is checked on the server for every request, each organization is isolated from every other, and every change is recorded in an activity log.',
  },
]
