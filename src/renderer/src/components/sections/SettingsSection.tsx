import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Cpu, Languages, Palette, RefreshCw, RotateCcw } from 'lucide-react'
import type { EngineProgress, UpdaterState } from '@shared/types'
import { useAppearance } from '@/components/AppearanceContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n, type Language } from '@/i18n'

/** Presets de color de fondo de la ventana. */
const colorPresets = [
  { nameKey: 'preset.graphite', value: '#0b0f14' },
  { nameKey: 'preset.indigo', value: '#12102a' },
  { nameKey: 'preset.abyss', value: '#071a1c' },
  { nameKey: 'preset.plum', value: '#1a0f1e' },
  { nameKey: 'preset.charcoal', value: '#141414' }
]

/** Presets del color de acento (botones seleccionados, sliders, foco). */
const accentPresets = [
  { nameKey: 'preset.cyan', value: '#00cfd1' },
  { nameKey: 'preset.orange', value: '#f97316' },
  { nameKey: 'preset.yellow', value: '#eab308' },
  { nameKey: 'preset.red', value: '#ef4444' },
  { nameKey: 'preset.green', value: '#22c55e' }
]

const ENGINES: Record<string, { labelKey: string }> = {
  pandoc: { labelKey: 'settings.engine.pandoc' },
  magick: { labelKey: 'settings.engine.magick' },
  gs: { labelKey: 'settings.engine.gs' },
  soffice: { labelKey: 'settings.engine.soffice' }
}

/** Selector de color reutilizable con presets y color personalizado. */
function ColorPicker({
  value,
  onChange,
  presets
}: {
  value: string
  onChange: (color: string) => void
  presets: Array<{ name: string; value: string }>
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((preset) => (
        <button
          key={preset.value}
          type="button"
          title={preset.name}
          onClick={() => onChange(preset.value)}
          className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
            value.toLowerCase() === preset.value.toLowerCase()
              ? 'glow-thumb border-primary'
              : 'border-border'
          }`}
          style={{ backgroundColor: preset.value }}
        />
      ))}
      <label
        className="ml-1 inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        {t('settings.customColor')}
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-5 w-5 cursor-pointer appearance-none border-none bg-transparent p-0"
        />
      </label>
    </div>
  )
}

export function SettingsSection(): React.JSX.Element {
  const { appearance, setAppearance, resetAppearance } = useAppearance()
  const { t, language, setLanguage } = useI18n()
  const [engines, setEngines] = useState<Record<string, boolean> | null>(null)
  /** Estado de la descarga integrada por motor (barra de progreso). */
  const [downloads, setDownloads] = useState<Record<string, EngineProgress>>({})

  // Actualizaciones: la preferencia canónica vive en el proceso main (chequeo
  // sin depender del renderer); localStorage es solo la estimación inicial.
  const [autoUpdates, setAutoUpdates] = useState(() => {
    try {
      return localStorage.getItem('settings.autoUpdates') !== '0'
    } catch {
      return true
    }
  })
  const handleAutoUpdates = (checked: boolean): void => {
    setAutoUpdates(checked)
    try {
      localStorage.setItem('settings.autoUpdates', checked ? '1' : '0')
    } catch {
      // Sin localStorage la preferencia solo vive en esta sesión.
    }
    void window.api.updater.setEnabled(checked)
  }

  const [updateState, setUpdateState] = useState<UpdaterState | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  /** Último estado visto, para avisar una sola vez al terminar la descarga. */
  const lastUpdateStatus = useRef<string | null>(null)
  const notifiedVersion = useRef<string | null>(null)

  useEffect(() => {
    void window.api.binaries.status().then(setEngines)
    void window.api.app.version().then(setAppVersion)
    // El main es la fuente de verdad: replica el switch y el estado actual.
    void window.api.updater.state().then(({ state, enabled }) => {
      setUpdateState(state)
      lastUpdateStatus.current = state.status
      setAutoUpdates(enabled)
    })
    const unsubscribeUpdater = window.api.updater.onState((next) => {
      if (
        next.status === 'ready' &&
        lastUpdateStatus.current !== 'ready' &&
        notifiedVersion.current !== next.version
      ) {
        notifiedVersion.current = next.version
        toast.success(t('settings.update.ready', { version: next.version }))
      }
      lastUpdateStatus.current = next.status
      setUpdateState(next)
    })
    const unsubscribeEngines = window.api.engines.onProgress((progress) => {
      setDownloads((prev) => ({ ...prev, [progress.id]: progress }))
      const engineName = t(ENGINES[progress.id]?.labelKey ?? '')
      if (progress.phase === 'done') {
        void window.api.binaries.status().then(setEngines)
        toast.success(t('settings.dl.done', { engine: engineName }))
      } else if (progress.phase === 'error') {
        toast.error(t('settings.dl.failed', { engine: engineName }))
      }
    })
    return () => {
      unsubscribeUpdater()
      unsubscribeEngines()
    }
  }, [t])

  // Texto del estado de actualización para la tarjeta de Ajustes.
  const updateStatusText = ((): string => {
    if (!updateState) return t('settings.update.idle')
    switch (updateState.status) {
      case 'idle':
        return t('settings.update.idle')
      case 'checking':
        return t('settings.update.checking')
      case 'not-available':
        return t('settings.update.notAvailable')
      case 'available':
        return t('settings.update.available', { version: updateState.version })
      case 'downloading':
        return t('settings.update.downloading', {
          version: updateState.version,
          percent: updateState.percent
        })
      case 'ready':
        return t('settings.update.ready', { version: updateState.version })
      case 'error':
        return t('settings.update.error')
      case 'inactive':
        return updateState.reason === 'development'
          ? t('settings.update.inactive.dev')
          : t('settings.update.inactive.disabled')
    }
  })()

  return (
    // General es la pestaña inicial; Apariencia va después.
    <Tabs defaultValue="general" className="flex flex-col gap-4">
      <TabsList>
        <TabsTrigger value="general">
          <Cpu className="mr-2 h-4 w-4" />
          {t('settings.tab.general')}
        </TabsTrigger>
        <TabsTrigger value="apariencia">
          <Palette className="mr-2 h-4 w-4" />
          {t('settings.tab.appearance')}
        </TabsTrigger>
      </TabsList>

      {/* GENERAL */}
      <TabsContent value="general" className="animate-fade-in mt-0 space-y-4">
        <Card className="border-border/60 bg-card/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Languages className="h-4 w-4" />
              {t('settings.language')}
            </CardTitle>
            <CardDescription>{t('settings.language.desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              {t('settings.updates')}
            </CardTitle>
            <CardDescription>{t('settings.updates.desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="auto-updates">{t('settings.autoUpdates')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.autoUpdates.note')}</p>
              </div>
              <Switch id="auto-updates" checked={autoUpdates} onCheckedChange={handleAutoUpdates} />
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{t('settings.updates.version')}</span>
                <span className="font-medium tabular-nums">{appVersion ?? '…'}</span>
              </div>
              <p className="text-xs text-muted-foreground">{updateStatusText}</p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    !autoUpdates ||
                    updateState?.status === 'checking' ||
                    updateState?.status === 'downloading'
                  }
                  onClick={() => void window.api.updater.check()}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  {t('settings.updates.checkNow')}
                </Button>
                {updateState?.status === 'ready' && (
                  <Button size="sm" onClick={() => void window.api.updater.install()}>
                    {t('settings.updates.install')}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              {t('settings.engines')}
            </CardTitle>
            <CardDescription>{t('settings.engines.desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1.5">
              {Object.entries(ENGINES).map(([key, { labelKey }]) => {
                const available = engines?.[key]
                const progress = downloads[key]
                const busy = progress?.phase === 'downloading' || progress?.phase === 'installing'
                return (
                  <li key={key} className="flex items-start justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">{t(labelKey)}</span>
                    {available === undefined ? (
                      <span className="shrink-0 text-muted-foreground/60">…</span>
                    ) : available ? (
                      <span className="shrink-0 text-primary">{t('settings.available')}</span>
                    ) : busy ? (
                      <span className="flex w-44 shrink-0 items-center gap-2">
                        <Progress
                          value={
                            progress.phase === 'downloading'
                              ? (progress.percent ?? undefined)
                              : undefined
                          }
                          className="h-1.5 flex-1"
                        />
                        <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                          {progress.phase === 'installing'
                            ? t('settings.dl.installing')
                            : progress.percent != null
                              ? `${progress.percent}%`
                              : ''}
                        </span>
                        {progress.phase === 'downloading' && (
                          <button
                            type="button"
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label={t('batch.cancel')}
                            title={t('batch.cancel')}
                            onClick={() => {
                              setDownloads((prev) => {
                                const next = { ...prev }
                                delete next[key]
                                return next
                              })
                              void window.api.engines.cancel(key)
                            }}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void window.api.engines.download(key)}
                        className="shrink-0 text-primary underline underline-offset-2 hover:brightness-125"
                      >
                        {t('settings.download')}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              {t('settings.binNote')}{' '}
              <code className="rounded bg-muted px-1 py-0.5">resources/bin</code>{' '}
              {t('settings.binNote2')}
            </p>
          </CardContent>
        </Card>
      </TabsContent>

      {/* APARIENCIA */}
      <TabsContent value="apariencia" className="animate-fade-in mt-0 space-y-4">
        <Card className="border-border/60 bg-card/50">
          <CardHeader>
            <CardTitle>{t('settings.window')}</CardTitle>
            <CardDescription>{t('settings.window.desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <Label htmlFor="transparency">{t('settings.transparency')}</Label>
                <span className="tabular-nums text-muted-foreground">
                  {Math.round(appearance.transparency * 100)}%
                </span>
              </div>
              <Slider
                id="transparency"
                min={0}
                max={100}
                step={1}
                value={[Math.round(appearance.transparency * 100)]}
                onValueChange={([value]) => setAppearance({ transparency: value / 100 })}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <Label htmlFor="blur">{t('settings.blur')}</Label>
                <span className="tabular-nums text-muted-foreground">{appearance.blur}px</span>
              </div>
              <Slider
                id="blur"
                min={0}
                max={30}
                step={1}
                value={[appearance.blur]}
                onValueChange={([value]) => setAppearance({ blur: value })}
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>{t('settings.bgColor')}</span>
                <span className="tabular-nums text-muted-foreground uppercase">{appearance.color}</span>
              </div>
              <ColorPicker
                value={appearance.color}
                onChange={(color) => setAppearance({ color })}
                presets={colorPresets.map((p) => ({ name: t(p.nameKey), value: p.value }))}
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>{t('settings.barColor')}</span>
                <span className="tabular-nums text-muted-foreground uppercase">{appearance.barColor}</span>
              </div>
              <ColorPicker
                value={appearance.barColor}
                onChange={(barColor) => setAppearance({ barColor })}
                presets={colorPresets.map((p) => ({ name: t(p.nameKey), value: p.value }))}
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>{t('settings.accentColor')}</span>
                <span className="tabular-nums text-muted-foreground uppercase">{appearance.accent}</span>
              </div>
              <ColorPicker
                value={appearance.accent}
                onChange={(accent) => setAppearance({ accent })}
                presets={accentPresets.map((p) => ({ name: t(p.nameKey), value: p.value }))}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between text-sm">
              <div className="space-y-0.5">
                <div>{t('settings.contentTransparency')}</div>
                <div className="text-xs text-muted-foreground">{t('settings.contentTransparency.desc')}</div>
              </div>
              <Switch
                checked={appearance.transparency > 0}
                onCheckedChange={(checked) => setAppearance({ transparency: checked ? 0.35 : 0 })}
              />
            </div>

            <Button variant="outline" onClick={resetAppearance}>
              <RotateCcw className="h-4 w-4" />
              {t('settings.restore')}
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
