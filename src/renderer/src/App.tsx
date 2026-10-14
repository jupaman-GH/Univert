import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Layers, Settings } from 'lucide-react'
import type { UpdaterState } from '@shared/types'
import { AppearanceProvider, useAppearance } from '@/components/AppearanceContext'
import { TitleBar } from '@/components/TitleBar'
import { SettingsSection } from '@/components/sections/SettingsSection'
import { ConvertSection } from '@/components/sections/ConvertSection'
import { Progress } from '@/components/ui/progress'
import { Toaster } from '@/components/ui/toaster'
import { I18nProvider, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const sections = [
  { id: 'convertir', labelKey: 'nav.convert', icon: Layers },
  { id: 'ajustes', labelKey: 'nav.settings', icon: Settings }
] as const

type SectionId = (typeof sections)[number]['id']

function Shell(): React.JSX.Element {
  const [active, setActive] = useState<SectionId>('convertir')
  /**
   * Lista canónica de archivos a convertir (imágenes y documentos mezclados).
   * Vive en App para sobrevivir a cambios de sección y para recibirla desde
   * el menú contextual (Fase C/D) o el DnD global (Fase 3).
   */
  const [files, setFiles] = useState<string[]>([])
  /** Versión del software para la esquina inferior izquierda. */
  const [appVersion, setAppVersion] = useState('')
  /** Estado del actualizador: alimenta el aviso de descarga (solo con
   *  actualizaciones activas; en desarrollo es `inactive` y no se pinta). */
  const [updateState, setUpdateState] = useState<UpdaterState | null>(null)
  const { appearance } = useAppearance()
  const { t } = useI18n()

  useEffect(() => {
    void window.api.app.version().then(setAppVersion)
    void window.api.updater
      .state()
      .then(({ state }) => setUpdateState(state))
      .catch(() => undefined)
    const offUpdater = window.api.updater.onState(setUpdateState)
    return offUpdater
  }, [])

  // DnD global: cualquier archivo soltado se AÑADE a la lista de conversión.
  useEffect(() => {
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      const dropped = e.dataTransfer?.files
      if (!dropped || dropped.length === 0) return
      const paths = Array.from(dropped).map((f) => window.api.dnd.getPathForFile(f))
      setFiles((prev) => Array.from(new Set([...prev, ...paths])))
      setActive('convertir')
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  // Peticiones del menú contextual (Fase C): «Convertir con Univert» abre la
  // app con los archivos ya cargados; el usuario elige el formato en la UI.
  useEffect(() => {
    const drainCtxRequests = (): void => {
      void window.api.ctxmenu.drain().then((requests) => {
        for (const request of requests) {
          if (request.action === 'notice') {
            toast.error(request.message)
          } else {
            setFiles((prev) => Array.from(new Set([...prev, ...request.paths])))
            setActive('convertir')
          }
        }
      })
    }
    const offCtx = window.api.ctxmenu.onRequest(drainCtxRequests)
    drainCtxRequests() // peticiones en frío emitidas antes de montar
    return offCtx
  }, [])

  // Toast global de resumen de lote (§6): visible desde cualquier sección.
  // El progreso fino vive en ConvertSection cuando hay un lote en curso.
  useEffect(() => {
    const offDone = window.api.batch.onDone((summary) => {
      toast.success(t('batch.done', { succeeded: summary.succeeded, total: summary.total }), {
        description: summary.failed > 0 ? `${summary.failed}` : undefined
      })
    })
    return offDone
  }, [t])

  return (
    <div
      className="glass flex h-full flex-col overflow-hidden rounded-lg border border-border/60"
      style={{
        backgroundColor: `color-mix(in srgb, ${appearance.color} ${Math.round((1 - appearance.transparency) * 100)}%, transparent)`
      }}
    >
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <nav
          className="flex w-56 shrink-0 flex-col gap-1 border-r border-border/60 p-3"
          style={{ backgroundColor: 'var(--bar-color)' }}
        >
          {sections.map((section) => {
            const Icon = section.icon
            const isActive = section.id === active
            return (
              <button
                key={section.id}
                onClick={() => setActive(section.id)}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200',
                  isActive
                    ? 'animate-glow bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {t(section.labelKey)}
              </button>
            )
          })}
          {/* Aviso de actualización + versión (esquina inferior izquierda):
              la barra de descarga aparece SOBRE la etiqueta de versión. */}
          <div className="mt-auto space-y-1 px-3 pb-1">
            {updateState?.status === 'downloading' && (
              <div className="space-y-1" role="status" aria-live="polite">
                <p className="text-[10px] text-muted-foreground">
                  {t('update.downloading')} · {updateState.percent}%
                </p>
                <Progress value={updateState.percent} className="h-1" />
              </div>
            )}
            {updateState?.status === 'ready' && (
              <p className="text-[10px] text-muted-foreground">
                {t('update.ready', { version: updateState.version })}
              </p>
            )}
            <p className="text-[10px] tracking-wide text-muted-foreground/50">
              {appVersion ? `v${appVersion}` : ''}
            </p>
          </div>
        </nav>
        <main key={active} className="animate-fade-in min-w-0 flex-1 overflow-auto p-6">
          {active === 'convertir' ? (
            <ConvertSection files={files} onChange={setFiles} />
          ) : (
            <SettingsSection />
          )}
        </main>
      </div>
      <Toaster />
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <I18nProvider>
      <AppearanceProvider>
        <Shell />
      </AppearanceProvider>
    </I18nProvider>
  )
}
