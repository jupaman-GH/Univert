import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }): React.JSX.Element {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-primary', className)} />
}
