import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Empty({
  className,
  children
}: {
  className?: string
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/80 p-8 text-center',
        className
      )}
    >
      {children}
    </div>
  )
}
