'use client'

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { compactNumber, formatMoney } from '@/lib/utils'
import { CHART_COLORS } from '@/lib/theme'

const AXIS = { tick: { fontSize: 11, fill: '#94a3b8' }, axisLine: false as const, tickLine: false as const }

/** Revenue and expenses as bars, net profit as a line — one rupee axis. */
export function PnlTrendChart({
  data,
  height = 280,
}: {
  data: { month: string; revenue: number; expenses: number; profit: number }[]
  height?: number
}) {
  if (!data.length || data.every((d) => !d.revenue && !d.expenses)) {
    return (
      <p className="flex items-center justify-center py-16 text-center text-sm text-slate-500" style={{ minHeight: height / 2 }}>
        Revenue and expenses will appear here once money starts moving.
      </p>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="month" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(v: number) => compactNumber(v)} width={48} />
        <ReferenceLine y={0} stroke="#cbd5e1" />
        <Tooltip
          cursor={{ fill: 'rgba(148,163,184,0.08)' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-float">
                <p className="mb-1 text-xs font-semibold text-slate-700">{label}</p>
                <ul className="space-y-0.5">
                  {payload.map((entry) => (
                    <li key={String(entry.name)} className="flex items-center gap-2 text-xs">
                      <span className="size-2 rounded-full" style={{ background: entry.color }} />
                      <span className="text-slate-500">{entry.name}</span>
                      <span className="ml-auto pl-3 font-semibold text-slate-900 tabular">
                        {formatMoney(Number(entry.value))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null
          }
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8, color: '#64748b' }} />
        <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Bar dataKey="expenses" name="Expenses" fill={CHART_COLORS[5]} radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Line
          type="monotone"
          dataKey="profit"
          name="Net profit"
          stroke={CHART_COLORS[0]}
          strokeWidth={2}
          dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
          activeDot={{ r: 5 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
