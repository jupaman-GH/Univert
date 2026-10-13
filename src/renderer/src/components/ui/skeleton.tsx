import { cn } from '@/lib/utils'

/** Placeholder de carga (Skeleton). */
export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}
