import { cn } from '@/lib/cn'
import { CheckCircle2, Clock, AlertCircle, Loader2 } from 'lucide-react'

const CONFIG: Record<string, { classes: string; icon: any }> = {
  completed: {
    classes: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    icon: CheckCircle2
  },
  in_progress: {
    classes: 'bg-amber-50 text-amber-700 border-amber-100',
    icon: Clock
  },
  processing: {
    classes: 'bg-amber-50 text-amber-700 border-amber-100',
    icon: Loader2
  },
  failed: {
    classes: 'bg-red-50 text-red-700 border-red-100',
    icon: AlertCircle
  },
  pending: {
    classes: 'bg-slate-50 text-slate-600 border-slate-100',
    icon: Clock
  },
}

export default function StatusBadge({ status }: { status: string }) {
  const normStatus = status?.toLowerCase().replace(' ', '_') || 'pending'
  const { classes, icon: Icon } = CONFIG[normStatus] || CONFIG.pending

  return (
    <span className={cn(
      'inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border h-7',
      classes
    )}>
      <Icon size={14} className={cn('shrink-0', normStatus === 'processing' ? 'animate-spin' : '')} />
      <span className="capitalize leading-none">{status?.replace('_', ' ')}</span>
    </span>
  )
}
