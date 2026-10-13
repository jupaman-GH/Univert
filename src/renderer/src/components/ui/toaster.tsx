import { Toaster as SonnerToaster } from 'sonner'

/** Toaster global (sonner) con el tema oscuro de la app. */
export function Toaster(): React.JSX.Element {
  return (
    <SonnerToaster
      position="bottom-right"
      theme="dark"
      toastOptions={{
        classNames: {
          toast:
            'rounded-lg border border-border bg-card text-card-foreground shadow-lg'
        }
      }}
    />
  )
}
