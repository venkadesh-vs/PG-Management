'use client'

import {
  BedDouble,
  Inbox,
  IndianRupee,
  LineChart,
  MessageSquareWarning,
  Smartphone,
  Sparkles,
  Users,
  UtensilsCrossed,
} from 'lucide-react'
import { FeatureSection } from './kit'
import { BedsVisual, EnquiriesVisual, RentVisual, ResidentsVisual } from './visuals-a'
import { ComplaintsVisual, FoodVisual, ResidentAppVisual, RevenueVisual } from './visuals-b'

export { SectionHeading } from './kit'

/**
 * The homepage's product sections, in PRD order. Each follows the same
 * shape — problem, solution, product visual, benefits, CTA — via
 * <FeatureSection>.
 */

export function BedsSection() {
  return (
    <FeatureSection
      id="beds"
      eyebrow="Bed management"
      icon={BedDouble}
      title="Every bed, every floor, at a glance."
      problem="You find out a bed is empty when someone asks. Reservations live in your head and maintenance beds get forgotten."
      solution="A live floor map shows every bed as Available, Reserved, Occupied, Maintenance or Blocked — and it updates itself as people book, check in and leave."
      benefits={['Colour-coded live bed map', 'Bulk-add a whole floor at once', 'Sharing type and rent per bed', 'Upcoming vacancies before they happen']}
      visual={<BedsVisual />}
    />
  )
}

export function ResidentsSection() {
  return (
    <FeatureSection
      id="residents"
      eyebrow="Residents"
      icon={Users}
      reverse
      className="bg-slate-50/70"
      title="Every resident’s story in one profile."
      problem="ID copies in a drawer, phone numbers in your contacts, rent history in a notebook nobody else can read."
      solution="Check residents in with a guided flow — documents, deposit, bed and rent in one go. Their profile keeps payments, complaints and history together."
      benefits={['Guided check-in and exit', 'KYC documents stored securely', 'Deposit and dues tracked', 'Search by name, room or phone']}
      visual={<ResidentsVisual />}
    />
  )
}

export function RentSection() {
  return (
    <FeatureSection
      id="rent"
      eyebrow="Rent"
      icon={IndianRupee}
      title="Rent that generates, reminds and reconciles itself."
      problem="The first week of every month goes into calling, reminding and cross-checking UPI screenshots against a notebook."
      solution="StayFlow raises each resident’s rent on their due date, sends reminders, accepts UPI and marks it paid only when the payment is verified."
      benefits={['Automatic monthly invoices', 'Reminders before and after the due date', 'UPI in the resident app, cash in one tap', 'Receipts sent automatically']}
      visual={<RentVisual />}
    />
  )
}

export function EnquiriesSection() {
  return (
    <FeatureSection
      id="enquiries"
      eyebrow="Enquiries & bookings"
      icon={Inbox}
      title="Turn every enquiry into a booked bed."
      problem="Enquiries come by phone, WhatsApp and walk-in. Half are never followed up, and nobody knows which bed was promised to whom."
      solution="Every enquiry lands on one board. Move it from new to visit to booked, take the advance, and the bed is reserved for the joining date."
      benefits={['One board for every enquiry', 'Follow-up reminders', 'Advance recorded with the booking', 'Booking reserves the exact bed']}
      visual={<EnquiriesVisual />}
    />
  )
}

export function FoodSection() {
  return (
    <FeatureSection
      id="food"
      eyebrow="Food"
      icon={UtensilsCrossed}
      reverse
      className="bg-slate-50/70"
      title="Cook for the people who will actually eat."
      problem="The kitchen cooks for everyone, half skip dinner, and groceries run out mid-week without warning."
      solution="Plan the weekly menu, see live meal counts as residents opt in or out, and keep grocery stock with low-stock alerts and purchase lists."
      benefits={['Weekly menu residents can see', 'Live meal counts per meal', 'Grocery stock and purchases', 'Less food wasted every day']}
      visual={<FoodVisual />}
    />
  )
}

export function ComplaintsSection() {
  return (
    <FeatureSection
      id="complaints"
      eyebrow="Complaints"
      icon={MessageSquareWarning}
      title="Every complaint has an owner — and an ending."
      problem="“The fan is still not fixed” — and you have no idea who was told, when, or whether anyone went."
      solution="Residents raise complaints from their app. You assign a worker, they see it in their own app, and the resident sees it move from Open to Resolved."
      benefits={['Raised from the resident app', 'Assigned to the right worker', 'Status residents can track', 'Resolution time you can see']}
      visual={<ComplaintsVisual />}
    />
  )
}

export function RevenueSection() {
  return (
    <FeatureSection
      id="reports"
      eyebrow="Revenue intelligence"
      icon={LineChart}
      reverse
      className="bg-slate-50/70"
      title="See the money you’re losing to empty beds."
      problem="An empty bed doesn’t feel like a loss until the month ends. Profit is a guess made from three different books."
      solution="StayFlow turns vacancy into a rupee figure, floor by floor, and puts collections, expenses and profit for each PG on one screen."
      benefits={['Vacancy loss in rupees', 'Collections vs expenses', 'Profit per PG', 'Compare PGs side by side']}
      visual={<RevenueVisual />}
      note={
        <p className="inline-flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-blue-600" strokeWidth={1.75} aria-hidden />
          <span>
            <strong className="font-semibold">Coming soon:</strong> an AI assistant and a daily brief that tells you what needs
            your attention each morning.
          </span>
        </p>
      }
    />
  )
}

export function ResidentAppSection() {
  return (
    <FeatureSection
      id="resident-app"
      eyebrow="Resident app"
      icon={Smartphone}
      title="Give every resident their own PG app."
      problem="Residents message you at 11 PM for the menu, the Wi-Fi password, their rent amount and a receipt."
      solution="Residents get an app in their phone browser — no install needed. They pay rent, raise complaints, see the menu and read notices themselves."
      benefits={['Pay rent by UPI', 'Raise and track complaints', 'Menu and notices', 'Receipts on demand']}
      visual={<ResidentAppVisual />}
    />
  )
}
