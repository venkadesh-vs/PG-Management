import {
  Smartphone,
  KeyRound,
  ListChecks,
  ToggleRight,
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  Bed,
  BedDouble,
  BookOpen,
  Bell,
  Boxes,
  Building2,
  CalendarClock,
  ChartNoAxesCombined,
  CheckCircle2,
  CircleHelp,
  ClipboardList,
  Clock,
  CreditCard,
  FileUp,
  IndianRupee,
  TrendingUp,
  DoorOpen,
  FileText,
  Gauge,
  History,
  Home,
  LayoutDashboard,
  LifeBuoy,
  type LucideIcon,
  Megaphone,
  MessagesSquare,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Tags,
  TrendingDown,
  UserPlus,
  UserRound,
  Users,
  Utensils,
  Wallet,
  Wrench,
} from 'lucide-react'

/**
 * Icon registry.
 *
 * React Server Components cannot pass a component (a function) as a prop to a
 * Client Component. Server pages therefore pass an icon *name* and the client
 * component looks it up here. Anything already inside a client boundary can
 * keep passing the Lucide component directly.
 */

export const ICONS = {
  alert: AlertCircle,
  warning: AlertTriangle,
  transfer: ArrowRightLeft,
  cash: Banknote,
  bed: Bed,
  beds: BedDouble,
  bell: Bell,
  boxes: Boxes,
  building: Building2,
  calendar: CalendarClock,
  chart: ChartNoAxesCombined,
  check: CheckCircle2,
  clipboard: ClipboardList,
  clock: Clock,
  card: CreditCard,
  money: IndianRupee,
  door: DoorOpen,
  file: FileText,
  gauge: Gauge,
  history: History,
  home: Home,
  dashboard: LayoutDashboard,
  megaphone: Megaphone,
  messages: MessagesSquare,
  receipt: Receipt,
  search: Search,
  settings: Settings,
  shield: ShieldCheck,
  smartphone: Smartphone,
  key: KeyRound,
  list: ListChecks,
  toggle: ToggleRight,
  cart: ShoppingCart,
  sparkles: Sparkles,
  tags: Tags,
  trendingDown: TrendingDown,
  trendingUp: TrendingUp,
  upload: FileUp,
  userPlus: UserPlus,
  user: UserRound,
  help: CircleHelp,
  book: BookOpen,
  lifebuoy: LifeBuoy,
  users: Users,
  utensils: Utensils,
  wallet: Wallet,
  wrench: Wrench,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

/** Accepts either a registry name (safe across the RSC boundary) or a component. */
export type IconLike = IconName | React.ComponentType<{ className?: string; strokeWidth?: number }>

export function resolveIcon(
  icon: IconLike | undefined,
): React.ComponentType<{ className?: string; strokeWidth?: number }> | null {
  if (!icon) return null
  if (typeof icon === 'string') return ICONS[icon] ?? null
  return icon
}

/** One stroke weight everywhere (1.75) so icons look like a single set. */
export function Icon({
  name,
  className,
  strokeWidth = 1.75,
}: {
  name: IconLike
  className?: string
  strokeWidth?: number
}) {
  const Component = resolveIcon(name)
  if (!Component) return null
  return <Component className={className} strokeWidth={strokeWidth} />
}
