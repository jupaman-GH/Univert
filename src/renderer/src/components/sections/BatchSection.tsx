import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Layers, Play, Square, X } from 'lucide-react'
import { toast } from 'sonner'
import type { BatchItemStatus, BatchMode, ImageFormat } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type Kind = 'imagenes' | 'documentos'

const IMAGE_TARGETS: ImageFormat[] = ['png', 'jpeg', 'webp', 'avif', 'tiff', 'gif']

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

export function BatchSection(): React.JSX.Element {
  const { t } = useI18n()
  const [kind, setKind] = useState<Kind | null>(null)
  const [mode, setMode] = useState<BatchMode>('single-format')
  const [files, setFiles] = useState<string[]>([])
  const [sharedFormat, setSharedFormat] = useState<ImageFormat>('png')
  const [perFileFormats, setPerFileFormats] = useState<Record<string, ImageFormat>>({})
  const [quality, setQuality] = useState(90)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)
  const [statuses, setStatuses] = useState<BatchItemStatus[]>([])
  const [dragging, setDragging] = useState(false)
  const [useCustomDir, setUseCustomDir] = useState(false)
  const [customDir, setCustomDir] = useState<string | null>(null)

  // Suscripción a progreso/lote completado.
  useEffect(() => {
    const offProgress = window.api.batch.onProgress((p) => {
      setProgress({ completed: p.completed, total: p.total })
      setStatuses(p.items)
    })
    const offDone = window.api.batch.onDone((summary) => {
      setRunning(false)
      setProgress(null)
      toast.success(t('batch.done', { succeeded: summary.succeeded, total: summary.total }), {
        description: summary.failed > 0 ? `${summary.failed}` : undefined
      })
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [t])

  const pickFiles = useCallback(async () => {
    if (!kind) return
    const paths = await window.api.dialog.pickFiles(kind)
    addFiles(paths)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  const addFiles = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return
      setFiles((prev) => {
        const merged = Array.from(new Set([...prev, ...paths]))
        setPerFileFormats((current) => {
          const next = { ...current }
          for (const p of merged) if (!next[p]) next[p] = 'png'
          return next
        })
        return merged
      })
    },
    []
  )

  const handleDrop = useCallback(
    (dropped: FileList | null) => {
      const paths = Array.from(dropped ?? []).map((f) => window.api.dnd.getPathForFile(f))
      addFiles(paths)
    },
    [addFiles]
  )

  const start = useCallback(async () => {
    if (!kind || files.length === 0) return
    setRunning(true)
    setStatuses(files.map((f) => ({ inputPath: f, status: 'pending' as const })))
    setProgress({ completed: 0, total: files.length })
    const response = await window.api.batch.run({
      kind,
      mode,
      items:
        mode === 'per-file'
          ? files.map((f) => ({ inputPath: f, targetFormat: perFileFormats[f] }))
          : files.map((f) => ({ inputPath: f })),
      targetFormat: mode === 'single-format' ? sharedFormat : undefined,
      quality,
      outputDir: useCustomDir ? customDir : null
    })
    if (!response.ok) {
      setRunning(false)
      toast.error(t('batch.startError'), { description: response.error.message })
    }
  }, [kind, mode, files, sharedFormat, perFileFormats, quality, useCustomDir, customDir, t])

  const cancel = useCallback(async () => {
    await window.api.batch.cancel()
    toast.info(t('batch.canceling'))
  }, [t])

  const pickOutputDir = useCallback(async () => {
    const dir = await window.api.window.pickDirectory()
    if (dir) setCustomDir(dir)
  }, [])

  const reset = useCallback(() => {
    setKind(null)
    setFiles([])
    setStatuses([])
    setProgress(null)
  }, [])

  const canStart =
    kind !== null && files.length > 0 && !running && (!useCustomDir || customDir !== null)

  return (
    <div className="space-y-4">
      {/* Paso 1: tipo de lote */}
      <Card className="border-border/60 bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4" /> {t('batch.step1')}
          </CardTitle>
          <CardDescription className="text-xs">{t('batch.step1.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          {(['imagenes', 'documentos'] as Kind[]).map((k) => (
            <Button
              key={k}
              variant={kind === k ? 'default' : 'outline'}
              onClick={() => {
                setKind(k)
                setFiles([])
              }}
              disabled={running || (kind !== null && kind !== k && files.length > 0)}
            >
              {k === 'imagenes' ? t('batch.images') : t('batch.documents')}
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* Paso 2: modalidad y archivos */}
      {kind && (
        <Card className="border-border/60 bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('batch.step2')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Button
                variant={mode === 'single-format' ? 'default' : 'outline'}
                onClick={() => setMode('single-format')}
                disabled={running}
              >
                {t('batch.modeSingle')}
              </Button>
              <Button
                variant={mode === 'per-file' ? 'default' : 'outline'}
                onClick={() => setMode('per-file')}
                disabled={running}
              >
                {t('batch.modePerFile')}
              </Button>
            </div>

            {mode === 'single-format' && (
              <div className="space-y-2">
                <Label>{t('batch.outputForAll')}</Label>
                <Select value={sharedFormat} onValueChange={(v) => setSharedFormat(v as ImageFormat)} disabled={running}>
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMAGE_TARGETS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {kind === 'imagenes' && (
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between text-sm">
                      <Label>{t('batch.quality')}</Label>
                      <span className="tabular-nums text-muted-foreground">{quality}%</span>
                    </div>
                    <Slider min={0} max={100} step={1} value={[quality]} onValueChange={([v]) => setQuality(v)} disabled={running} />
                  </div>
                )}
              </div>
            )}

            <div
              onClick={() => void pickFiles()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                handleDrop(e.dataTransfer.files)
              }}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors',
                dragging ? 'border-primary bg-primary/10' : 'border-border/80 hover:border-primary/60'
              )}
            >
              <p className="text-sm">{t('batch.addFiles', { count: files.length })}</p>
            </div>

            {files.length > 0 && (
              <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-border/60 p-2">
                {files.map((f) => (
                  <div key={f} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate" title={f}>
                      {baseName(f)}
                    </span>
                    <div className="flex items-center gap-2">
                      {mode === 'per-file' ? (
                        <Select
                          value={perFileFormats[f] ?? 'png'}
                          onValueChange={(v) => setPerFileFormats((p) => ({ ...p, [f]: v as ImageFormat }))}
                          disabled={running}
                        >
                          <SelectTrigger className="h-7 w-28 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {IMAGE_TARGETS.map((fmt) => (
                              <SelectItem key={fmt} value={fmt}>
                                {fmt.toUpperCase()}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">→ {sharedFormat.toUpperCase()}</span>
                      )}
                      {!running && (
                        <button
                          onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Paso 3: destino y ejecución */}
      {kind && files.length > 0 && (
        <Card className="border-border/60 bg-card/50">
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('batch.customDir')}</Label>
                <p className="text-xs text-muted-foreground">
                  {useCustomDir
                    ? (customDir ?? t('batch.customDirOn'))
                    : t('batch.customDirOff')}
                </p>
              </div>
              <Switch checked={useCustomDir} onCheckedChange={setUseCustomDir} disabled={running} />
            </div>
            {useCustomDir && (
              <Button variant="outline" onClick={pickOutputDir} disabled={running}>
                <FolderOpen className="h-4 w-4" />
                {t('batch.pickFolder')}
              </Button>
            )}
            {running ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Spinner /> {t('batch.converting')} {progress?.completed ?? 0}/{progress?.total ?? files.length}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => void cancel()}>
                    <Square className="h-3.5 w-3.5" /> {t('batch.cancel')}
                  </Button>
                </div>
                <Progress value={progress ? (progress.completed / progress.total) * 100 : 0} />
                <div className="max-h-40 space-y-1 overflow-auto text-xs">
                  {statuses.map((s) => (
                    <div key={s.inputPath} className="flex justify-between gap-2">
                      <span className="truncate">{baseName(s.inputPath)}</span>
                      <span
                        className={cn(
                          s.status === 'done' && 'text-primary',
                          s.status === 'error' && 'text-destructive',
                          s.status === 'converting' && 'text-muted-foreground'
                        )}
                      >
                        {s.status === 'done'
                          ? t('batch.status.done')
                          : s.status === 'error'
                            ? `${t('batch.status.error')}: ${s.error}`
                            : t(`batch.status.${s.status}`)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Button onClick={() => void start()} disabled={!canStart}>
                  <Play className="h-4 w-4" /> {t('batch.start', { count: files.length })}
                </Button>
                <Button variant="ghost" onClick={reset}>
                  {t('batch.clear')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
