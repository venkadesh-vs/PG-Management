'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { compactNumber, formatMoney } from '@/lib/utils'
import { CHART_COLORS } from '@/lib/theme'
import { EmptyState } from '@/components/ui/feedback'
import { ChartNoAxesCombined } from 'lucide-react'

/**
 * Chart wrappers. Recharts needs hex, not Tailwind classes, so colours come
 * from the shared CHART_COLORS palette in lib/theme.
 */

const AXIS = {
  tick: { fontSize: 11, fill: '#94a3b8' },
  axisLine: false as const,
  tickLine: false as const,
}

function ChartTooltip({
  active,
  payload,
  label,
  money,
  suffix,
}: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
  money?: boolean
  suffix?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-float backdrop-blur">
      {label && <p className="mb-1 text-xs font-semibold text-slate-700">{label}</p>}
      <ul className="space-y-0.5">
        {payload.map((entry) => (
          <li key={entry.name} className="flex items-center gap-2 text-xs">
            <span className="size-2 rounded-full" style={{ background: entry.color }} />
            <span className="text-slate-500">{entry.name}</span>
            <span className="ml-auto font-semibold text-slate-900 tabular">
              {money ? formatMoney(entry.value) : `${entry.value}${suffix ?? ''}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function NoData({ label }: { label: string }) {
  return (
    <EmptyState
      compact
      icon={ChartNoAxesCombined}
      title="No data yet"
      description={label}
      className="h-full border-none bg-transparent"
    />
  )
}

// ------------------------------------------------------- Revenue trend -----

export function RevenueChart({
  data,
  height = 260,
}: {
  data: { month: string; collected: number; expenses: number; billed: number }[]
  height?: number
}) {
  if (!data.length || data.every((d) => !d.collected && !d.expenses && !d.billed)) {
    return <NoData label="Collections and expenses will appear here once money starts moving." />
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="gCollected" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.28} />
            <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gExpenses" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS[5]} stopOpacity={0.22} />
            <stop offset="100%" stopColor={CHART_COLORS[5]} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="month" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(v: number) => compactNumber(v)} width={48} />
        <Tooltip content={<ChartTooltip money />} cursor={{ stroke: '#e2e8f0' }} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 8, color: '#64748b' }}
        />
        <Area
          type="monotone"
          dataKey="collected"
          name="Collected"
          stroke={CHART_COLORS[0]}
          strokeWidth={2}
          fill="url(#gCollected)"
        />
        <Area
          type="monotone"
          dataKey="expenses"
          name="Expenses"
          stroke={CHART_COLORS[5]}
          strokeWidth={2}
          fill="url(#gExpenses)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ----------------------------------------------------- Occupancy trend -----

export function OccupancyChart({
  data,
  color = CHART_COLORS[0],
  height = 240,
}: {
  data: { date: string; occupancy: number; occupied: number; total: number }[]
  color?: string
  height?: number
}) {
  if (!data.length) return <NoData label="Occupancy is recorded daily — check back tomorrow." />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="date" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
        <YAxis {...AXIS} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} width={40} />
        <Tooltip content={<ChartTooltip suffix="%" />} cursor={{ stroke: '#e2e8f0' }} />
        <Line
          type="monotone"
          dataKey="occupancy"
          name="Occupancy"
          stroke={color}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

// -------------------------------------------------------- Donut charts -----

export function DonutChart({
  data,
  height = 220,
  money,
  centerLabel,
  centerValue,
}: {
  data: { name: string; value: number; color?: string }[]
  height?: number
  money?: boolean
  centerLabel?: string
  centerValue?: string
}) {
  const filtered = data.filter((d) => d.value > 0)
  if (!filtered.length) return <NoData label="Nothing recorded for this period yet." />

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={filtered}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={2}
            stroke="none"
          >
            {filtered.map((entry, i) => (
              <Cell key={entry.name} fill={entry.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip money={money} />} />
        </PieChart>
      </ResponsiveContainer>
      {centerValue && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="font-display text-xl font-semibold text-slate-900 tabular">{centerValue}</p>
          {centerLabel && <p className="text-[11px] text-slate-500">{centerLabel}</p>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------- Bar charts -----

export function CategoryBarChart({
  data,
  height = 240,
  money = true,
  color = CHART_COLORS[0],
  layout = 'vertical',
}: {
  data: { name: string; amount: number }[]
  height?: number
  money?: boolean
  color?: string
  layout?: 'vertical' | 'horizontal'
}) {
  if (!data.length) return <NoData label="No entries in this period." />

  if (layout === 'vertical') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" {...AXIS} tickFormatter={(v: number) => compactNumber(v)} />
          <YAxis type="category" dataKey="name" {...AXIS} width={110} />
          <Tooltip content={<ChartTooltip money={money} />} cursor={{ fill: '#f8fafc' }} />
          <Bar dataKey="amount" name="Amount" radius={[0, 6, 6, 0]} fill={color} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="name" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(v: number) => compactNumber(v)} width={48} />
        <Tooltip content={<ChartTooltip money={money} />} cursor={{ fill: '#f8fafc' }} />
        <Bar dataKey="amount" name="Amount" radius={[6, 6, 0, 0]} fill={color} barSize={28} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Grouped bars comparing PGs side by side. */
export function ComparisonChart({
  data,
  height = 260,
}: {
  data: { name: string; collected: number; pending: number; expenses: number }[]
  height?: number
}) {
  if (!data.length) return <NoData label="Add a second PG to compare performance." />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="name" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(v: number) => compactNumber(v)} width={48} />
        <Tooltip content={<ChartTooltip money />} cursor={{ fill: '#f8fafc' }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        <Bar dataKey="collected" name="Collected" radius={[6, 6, 0, 0]} fill={CHART_COLORS[0]} barSize={18} />
        <Bar dataKey="pending" name="Pending" radius={[6, 6, 0, 0]} fill={CHART_COLORS[3]} barSize={18} />
        <Bar dataKey="expenses" name="Expenses" radius={[6, 6, 0, 0]} fill={CHART_COLORS[5]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  )
}

