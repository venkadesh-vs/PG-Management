'use client'

import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { usePathname, useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowRight,
  Building2,
  CalendarClock,
  CreditCard,
  MessageCircle,
  Save,
  Timer,
} from 'lucide-react'
import type { z } from 'zod'
import { settingsSchema } from '@/lib/validation'
import { DEFAULT_SLA_HOURS, slaSettingsSchema } from '@/lib/sla'
import { api, ApiError } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/input'
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives'
import { Badge } from '@/components/ui/badge'
import { TeamPanel, type TeamMember } from './team-panel'
import type { ModuleKey } from '@/lib/modules'
import { FeaturesPanel } from '@/components/settings/features-panel'
import { RolesPanel } from '@/components/settings/roles-panel'
import { LookupsPanel } from '@/components/settings/lookups-panel'
import type { RoleRow, SettingsTab } from '@/components/settings/shared'

const formSchema = settingsSchema.merge(slaSettingsSchema)
type Values = z.infer<typeof formSchema>

/** Tabs that belong to the settings form (the others save on their own). */
const FORM_TABS = ['billing', 'reminders']

export function SettingsForm({
  organization,
  settings,
  team,
  properties,
  currentUserId,
  integrations,
  canEdit,
  initialTab,
  access,
  features,
  roles,
}: {
  organization: {
    name: string
    ownerName: string
    contactEmail: string
    contactPhone: string
    city: string | null
    state: string | null
    addressLine: string | null
    status: string
  } | null
  settings: Values | null
  team: TeamMember[]
  properties: { id: string; name: string }[]
  currentUserId: string
  integrations: { whatsapp: string; payments: string }
  canEdit: boolean
  initialTab?: SettingsTab
  /** Which permission-gated tabs this person sees. */
  access: { team: boolean; lookups: boolean }
  features: { disabledModules: string[]; withheld: string[]; enabledModules: ModuleKey[] }
  roles: RoleRow[]
}) {
  const router = useRouter()
  const toast = useToast()

  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: settings ? { ...DEFAULT_SLA_HOURS, ...settings } : {
      rentDueDay: 5,
      rentGenerateDay: 1,
      lateFeeEnabled: true,
      lateFeeGraceDays: 5,
      lateFeeAmount: 250,
      lateFeePerDay: 0,
      reminderDaysBefore: 3,
      reminderOnDueDate: true,
      reminderAfterDays: 3,
      whatsappEnabled: true,
      upiId: '',
      upiPayeeName: '',
      invoicePrefix: 'INV',
      receiptPrefix: 'RCP',
      ...DEFAULT_SLA_HOURS,
    },
  })

  const values = form.watch()
  const pathname = usePathname()
  const [tab, setTabState] = React.useState<string>(initialTab ?? 'billing')
  React.useEffect(() => {
    if (initialTab) setTabState(initialTab)
  }, [initialTab])
  function setTab(next: string) {
    setTabState(next)
    // Deep-linkable: /app/settings?tab=roles
    // (native history API — Next keeps useSearchParams in sync, no refetch).
    window.history.replaceState(null, '', `${pathname}?tab=${next}`)
  }

  async function onSubmit(data: Values) {
    try {
      await api.post('/api/settings', data)
      toast.success('Settings saved', 'Every automation will use these from now on.')
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to save settings',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    }
  }

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <div className="-mx-4 overflow-x-auto px-4 pb-1 scrollbar-slim sm:mx-0 sm:px-0">
        <TabsList className="w-max">
          <TabsTrigger value="billing">Rent & billing</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          {access.team && <TabsTrigger value="features">Features</TabsTrigger>}
          {access.team && <TabsTrigger value="roles">Roles & permissions</TabsTrigger>}
          {access.team && <TabsTrigger value="team">Team</TabsTrigger>}
          {access.lookups && <TabsTrigger value="lookups">Dropdown lists</TabsTrigger>}
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)}>
        {/* ------------------------------------------------ Rent & billing */}
        <TabsContent value="billing">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CalendarClock className="size-4 text-slate-400" />
                  Rent cycle
                </CardTitle>
                <p className="text-xs text-slate-500">
                  Invoices are generated automatically on the generation day, for every active
                  resident, pro-rated from their joining date.
                </p>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Generate invoices on"
                  hint="Day of the month"
                  error={form.formState.errors.rentGenerateDay?.message}
                >
                  <Select {...form.register('rentGenerateDay')} disabled={!canEdit}>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Rent falls due on"
                  hint="Default for new residents"
                  error={form.formState.errors.rentDueDay?.message}
                >
                  <Select {...form.register('rentDueDay')} disabled={!canEdit}>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Invoice prefix">
                  <Input maxLength={6} {...form.register('invoicePrefix')} disabled={!canEdit} />
                </Field>
                <Field label="Receipt prefix">
                  <Input maxLength={6} {...form.register('receiptPrefix')} disabled={!canEdit} />
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm">Late fees</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-3">
                  <span>
                    <span className="block text-sm font-medium text-slate-800">
                      Charge a late fee
                    </span>
                    <span className="block text-xs text-slate-500">
                      Applied once, after the grace period, when the invoice is still unpaid.
                    </span>
                  </span>
                  <Switch
                    checked={values.lateFeeEnabled}
                    onCheckedChange={(c) => form.setValue('lateFeeEnabled', c)}
                    disabled={!canEdit}
                  />
                </label>

                {values.lateFeeEnabled && (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Grace period (days)">
                      <Input
                        type="number"
                        inputMode="numeric"
                        {...form.register('lateFeeGraceDays')}
                        disabled={!canEdit}
                      />
                    </Field>
                    <Field label="Flat fee">
                      <Input
                        type="number"
                        inputMode="numeric"
                        {...form.register('lateFeeAmount')}
                        disabled={!canEdit}
                      />
                    </Field>
                    <Field label="Per day after grace">
                      <Input
                        type="number"
                        inputMode="numeric"
                        {...form.register('lateFeePerDay')}
                        disabled={!canEdit}
                      />
                    </Field>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CreditCard className="size-4 text-slate-400" />
                  Collecting payments
                </CardTitle>
                <p className="text-xs text-slate-500">
                  Your UPI details are embedded in rent reminders as a payment link.
                </p>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="UPI ID" hint="yourpg@okicici">
                  <Input {...form.register('upiId')} disabled={!canEdit} />
                </Field>
                <Field label="Payee name" hint="As it should appear in the UPI app">
                  <Input {...form.register('upiPayeeName')} disabled={!canEdit} />
                </Field>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---------------------------------------------------- Reminders */}
        <TabsContent value="reminders">
          <div className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <MessageCircle className="size-4 text-slate-400" />
                Automatic rent reminders
              </CardTitle>
              <p className="text-xs text-slate-500">
                Reminders run every day. Nobody is messaged twice about the same invoice on the
                same day.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-3">
                <span>
                  <span className="block text-sm font-medium text-slate-800">
                    Send WhatsApp reminders
                  </span>
                  <span className="block text-xs text-slate-500">
                    Turn off to stop all outgoing rent messages.
                  </span>
                </span>
                <Switch
                  checked={values.whatsappEnabled}
                  onCheckedChange={(c) => form.setValue('whatsappEnabled', c)}
                  disabled={!canEdit}
                />
              </label>
              <p className="text-xs text-slate-500">
                Switch individual messages (reminders, receipts, complaint updates…) on or off per
                channel in{' '}
                <Link href="/app/settings/notifications" className="font-medium text-blue-700 hover:underline">
                  Notification settings
                </Link>
                .
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Days before the due date" hint="0 turns this reminder off">
                  <Input
                    type="number"
                    inputMode="numeric"
                    {...form.register('reminderDaysBefore')}
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="Repeat every N days once overdue">
                  <Input
                    type="number"
                    inputMode="numeric"
                    {...form.register('reminderAfterDays')}
                    disabled={!canEdit}
                  />
                </Field>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-3">
                <span className="text-sm font-medium text-slate-800">
                  Also remind on the due date itself
                </span>
                <Switch
                  checked={values.reminderOnDueDate}
                  onCheckedChange={(c) => form.setValue('reminderOnDueDate', c)}
                  disabled={!canEdit}
                />
              </label>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <p className="text-xs font-medium text-slate-500">
                  With these settings a resident receives
                </p>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  {values.reminderDaysBefore > 0 && (
                    <li>· A reminder {values.reminderDaysBefore} days before the due date</li>
                  )}
                  {values.reminderOnDueDate && <li>· A reminder on the due date</li>}
                  <li>· An overdue reminder every {values.reminderAfterDays} days after that</li>
                  {values.lateFeeEnabled && (
                    <li>
                      · A late fee of ₹{values.lateFeeAmount} once {values.lateFeeGraceDays} days
                      have passed
                    </li>
                  )}
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Timer className="size-4 text-slate-400" />
                Complaint SLA
              </CardTitle>
              <p className="text-xs text-slate-500">
                How quickly a complaint should be resolved, by priority. Overdue complaints are
                flagged in red and you get a heads-up the moment one slips.
              </p>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-4">
              {(
                [
                  ['slaUrgentHours', 'Urgent'],
                  ['slaHighHours', 'High'],
                  ['slaMediumHours', 'Medium'],
                  ['slaLowHours', 'Low'],
                ] as const
              ).map(([name, label]) => (
                <Field
                  key={name}
                  label={label}
                  hint="Hours, 1–168"
                  error={form.formState.errors[name]?.message}
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={168}
                    {...form.register(name)}
                    disabled={!canEdit}
                  />
                </Field>
              ))}
            </CardContent>
          </Card>
          </div>
        </TabsContent>

        {/* ------------------------------------------------- Organization */}
        <TabsContent value="organization">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Building2 className="size-4 text-slate-400" />
                Organization
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              <Detail label="Business name" value={organization?.name} />
              <Detail label="Owner" value={organization?.ownerName} />
              <Detail label="Email" value={organization?.contactEmail} />
              <Detail label="Phone" value={organization?.contactPhone} />
              <Detail
                label="Address"
                value={
                  [organization?.addressLine, organization?.city, organization?.state]
                    .filter(Boolean)
                    .join(', ') || undefined
                }
                className="sm:col-span-2"
              />
              <Detail label="Account status" value={organization?.status.replace('_', ' ').toLowerCase()} />
            </CardContent>
          </Card>
        </TabsContent>

        {canEdit && FORM_TABS.includes(tab) && (
          <div className="mt-5 flex justify-end">
            <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting}>
              <Save className="size-4" />
              Save settings
            </Button>
          </div>
        )}
        {!canEdit && FORM_TABS.includes(tab) && (
          <p className="mt-5 text-sm text-slate-500">
            Only the account owner can change these settings.
          </p>
        )}
      </form>

      {access.team && (
        <>
          <TabsContent value="features">
            <FeaturesPanel
              disabledModules={features.disabledModules}
              withheld={features.withheld}
              canManage={access.team}
            />
          </TabsContent>
          <TabsContent value="roles">
            <RolesPanel roles={roles} enabledModules={features.enabledModules} canManage={access.team} />
          </TabsContent>
          <TabsContent value="team">
            <TeamPanel
              team={team}
              properties={properties}
              currentUserId={currentUserId}
              canManage={access.team}
              roles={roles}
            />
          </TabsContent>
        </>
      )}

      {access.lookups && (
        <TabsContent value="lookups">
          <LookupsPanel canManage={access.lookups} />
        </TabsContent>
      )}

      {/* ------------------------------------------------- Integrations */}
      <TabsContent value="integrations">
        <div className="grid gap-4 sm:grid-cols-2">
          <IntegrationLink
            icon={MessageCircle}
            name="WhatsApp"
            href="/app/settings/whatsapp"
            live={integrations.whatsapp === 'live'}
            body="Connect your own WhatsApp Business number or use the StayFlow number. See delivery status and message templates."
            canEdit={canEdit}
          />
          <IntegrationLink
            icon={CreditCard}
            name="Online rent payments (Razorpay)"
            href="/app/settings/payments"
            live={integrations.payments === 'live'}
            body="Connect your Razorpay account so residents' rent goes straight to your bank account."
            canEdit={canEdit}
          />
        </div>
      </TabsContent>
    </Tabs>
  )
}

function Detail({
  label,
  value,
  className,
}: {
  label: string
  value?: string | null
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm capitalize text-slate-800">{value || '—'}</dd>
    </div>
  )
}

function IntegrationLink({
  icon: Icon,
  name,
  href,
  live,
  body,
  canEdit,
}: {
  icon: React.ElementType
  name: string
  href: string
  live: boolean
  body: string
  canEdit: boolean
}) {
  return (
    <Card className={cn(live ? 'border-emerald-200' : 'border-slate-200')}>
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                'flex size-9 items-center justify-center rounded-xl',
                live ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-600',
              )}
            >
              <Icon className="size-4" />
            </div>
            <p className="text-sm font-semibold text-slate-900">{name}</p>
          </div>
          <Badge variant={live ? 'success' : 'outline'} size="sm">
            {live ? 'Connected' : 'Not connected'}
          </Badge>
        </div>
        <p className="flex-1 text-sm leading-relaxed text-slate-600">{body}</p>
        {canEdit ? (
          <Button variant="outline" size="sm" asChild className="self-start">
            <Link href={href}>
              {live ? 'Manage' : 'Set up'}
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        ) : (
          <p className="text-xs text-slate-500">Only the account owner can change this.</p>
        )}
      </CardContent>
    </Card>
  )
}
