import { Minus, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
// Símbolo del logo (extraído de UnivertLogo.png con fondo transparente).
import titlebarLogo from '@/assets/titlebar-logo.png'

/** Titlebar personalizado para la ventana sin marco (frameless). */
export function TitleBar(): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div
      className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-border/60 pl-4"
      style={{ backgroundColor: 'var(--bar-color)' }}
    >
      <span className="flex items-center gap-2">
        <img src={titlebarLogo} alt="" className="h-5 w-5 object-contain" />
        <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Univert
        </span>
        <span className="text-[10px] tracking-wide text-muted-foreground/50">
          Universal Converter
        </span>
      </span>
      <div className="drag-region-none flex h-full">
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-12 rounded-none text-muted-foreground hover:bg-muted"
          onClick={() => window.api.window.minimize()}
          aria-label={t('window.minimize')}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-12 rounded-none text-muted-foreground hover:bg-muted"
          onClick={() => window.api.window.maximize()}
          aria-label={t('window.maximize')}
        >
          <Square className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-12 rounded-none text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
          onClick={() => window.api.window.close()}
          aria-label={t('window.close')}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
