import {
  Armchair,
  Bath,
  DoorClosed,
  Droplets,
  Fan,
  Flame,
  ShieldAlert,
  Snowflake,
  Sparkles,
  Utensils,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/** Category keys are org-editable, so match on keywords and fall back to a wrench. */
const RULES: [RegExp, LucideIcon][] = [
  [/plumb|tap|leak|water(?!.*heat)/i, Droplets],
  [/heater|geyser|gas/i, Flame],
  [/elec|light|power|socket/i, Zap],
  [/\bac\b|^ac$|air.?con|cool/i, Snowflake],
  [/fan/i, Fan],
  [/bath|toilet|wash/i, Bath],
  [/clean|hygiene|pest/i, Sparkles],
  [/internet|wi-?fi|network/i, Wifi],
  [/food|kitchen|meal/i, Utensils],
  [/furn|bed|chair|table|cupboard/i, Armchair],
  [/room|door|window|lock/i, DoorClosed],
  [/secur|gate|guard/i, ShieldAlert],
]

export function categoryIcon(key: string, label?: string): LucideIcon {
  for (const [re, Icon] of RULES) if (re.test(key) || (label && re.test(label))) return Icon
  return Wrench
}

/** Icon tile for a complaint category; urgent work glows rose, the rest sit in brand indigo. */
export function CategoryTile({
  category,
  label,
  hot,
  className,
}: {
  category: string
  label?: string
  hot?: boolean
  className?: string
}) {
  const Icon = categoryIcon(category, label)
  return (
    <div
      title={label ?? category}
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
        hot
          ? 'bg-gradient-to-br from-rose-50 to-rose-100/70 text-rose-600 ring-rose-100'
          : 'bg-gradient-to-br from-blue-50 to-blue-100/60 text-blue-700 ring-blue-100',
        className,
      )}
    >
      <Icon className="size-5" />
    </div>
  )
}
