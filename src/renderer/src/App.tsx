import { useCallback, useEffect, useState } from 'react'
import { FileImage, FileText, Layers, Settings } from 'lucide-react'
import { AppearanceProvider, useAppearance } from '@/components/AppearanceContext'
import { TitleBar } from '@/components/TitleBar'
import { SettingsSection } from '@/components/sections/SettingsSection'
import { ImagesSection } from '@/components/sections/ImagesSection'
import { DocumentsSection } from '@/components/sections/DocumentsSection'
import { BatchSection } from '@/components/sections/BatchSection'
import { Empty } from '@/components/ui/empty'
import { Toaster } from '@/components/ui/toaster'
import { I18nProvider, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const sections = [
  { id: 'imagenes', labelKey: 'nav.images', icon: FileImage, descriptionKey: 'section.images.desc' },
  { id: 'documentos', labelKey: 'nav.documents', icon: FileText, descriptionKey: 'section.documents.desc' },
  { id: 'lotes', labelKey: 'nav.batches', icon: Layers, descriptionKey: 'section.batches.desc' },
  { id: 'ajustes', labelKey: 'nav.settings', icon: Settings, descriptionKey: 'section.settings.desc' }
] as const

type SectionId = (typeof sections)[number]['id']

function PlaceholderSection({ description }: { description: string }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Empty>
      <p className="text-sm text-muted-foreground">{description}</p>
      <p className="text-xs text-muted-foreground/70">{t('section.pending')}</p>
    </Empty>
  )
}

function Shell(): React.JSX.Element {
  const [active, setActive] = useState<SectionId>('imagenes')
  const [droppedPath, setDroppedPath] = useState<string | undefined>(undefined)
  const [droppedDocPath, setDroppedDocPath] = useState<string | undefined>(undefined)
  /** Versión del software para la esquina inferior izquierda. */
  const [appVersion, setAppVersion] = useState('')
  const { appearance } = useAppearance()
  const { t } = useI18n()
  const current = sections.find((s) => s.id === active)!

  useEffect(() => {
    void window.api.app.version().then(setAppVersion)
  }, [])

  // DnD global: un archivo soltado en cualquier punto navega a la sección adecuada.
  useEffect(() => {
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      const path = window.api.dnd.getPathForFile(file)
      void (async () => {
        const isImage = await window.api.images.isImage(path)
        setActive(isImage ? 'imagenes' : 'documentos')
        if (isImage) setDroppedPath(path)
        else setDroppedDocPath(path)
      })()
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  const handleSelect = useCallback((id: SectionId) => {
    setActive(id)
  }, [])

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
                onClick={() => handleSelect(section.id)}
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
          {/* Versión del software (esquina inferior izquierda). */}
          <div className="mt-auto px-3 pb-1 text-[10px] tracking-wide text-muted-foreground/50">
            {appVersion ? `v${appVersion}` : ''}
          </div>
        </nav>
        <main key={active} className="animate-fade-in min-w-0 flex-1 overflow-auto p-6">
          {active === 'imagenes' ? (
            <ImagesSection initialPath={droppedPath} />
          ) : active === 'documentos' ? (
            <DocumentsSection initialPath={droppedDocPath} />
          ) : active === 'lotes' ? (
            <BatchSection />
          ) : active === 'ajustes' ? (
            <SettingsSection />
          ) : (
            <PlaceholderSection description={t(current.descriptionKey)} />
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
