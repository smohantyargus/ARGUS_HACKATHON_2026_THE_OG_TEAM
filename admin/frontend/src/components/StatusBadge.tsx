import { cn } from '@/lib/cn'
import { CheckCircle2, Clock, AlertCircle, Loader2, XCircle } from 'lucide-react'

const CONFIG: Record<string, { classes: string; icon: any }> = {
  completed: {
    classes: 'bg-emerald-950/60 text-emerald-400 border-emerald-900/60',
    icon: CheckCircle2
  },
  in_progress: {
    classes: 'bg-amber-950/60 text-amber-400 border-amber-900/60',
    icon: Loader2
  },
  processing: {
    classes: 'bg-sky-950/60 text-sky-400 border-sky-900/60',
    icon: Loader2
  },
  failed: {
    classes: 'bg-red-950/60 text-red-400 border-red-900/60',
    icon: AlertCircle
  },
  pending: {
    classes: 'bg-slate-900/80 text-slate-400 border-slate-800/60',
    icon: Clock
  },
  cancelled: {
    classes: 'bg-orange-950/60 text-orange-400 border-orange-900/60',
    icon: XCircle
  },
}

export default function StatusBadge({ status }: { status: string }) {
  const normStatus = status?.toLowerCase().replace(' ', '_') || 'pending'
  const { classes, icon: Icon } = CONFIG[normStatus] || CONFIG.pending

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border h-7 font-mono',
      classes
    )}>
      <Icon size={13} className={cn('shrink-0', normStatus === 'processing' || normStatus === 'in_progress' ? 'animate-spin' : '')} />
      <span className="capitalize leading-none">{status?.replace('_', ' ')}</span>
    </span>
  )
}
