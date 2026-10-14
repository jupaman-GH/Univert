import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, FolderOpen, ImageIcon, Layers, Play, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import type {
  BatchItemStatus,
  DefaultFormats,
  ImageFormat,
  ImageInfo
} from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Sección única de conversión (imágenes y documentos, sin discriminar):
 * un mismo flujo para 1 o N archivos, sin selección de modalidad. Cada
 * archivo lleva su formato de destino (preseleccionado con el formato por
 * defecto de Ajustes si está disponible) y un único botón convierte todo.
 * La lista de archivos vive en App (sobrevive a cambios de sección y llega
 * desde el menú contextual / DnD global).
 */

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

/** Formatos de imagen que admiten control de calidad (bmp/ico no). */
const QUALITY_TARGETS = new Set<string>(['png', 'jpeg', 'webp', 'avif', 'tiff', 'gif'])

function supportsQuality(format: string): boolean {
  return QUALITY_TARGETS.has(format)
}

/** Metadatos por archivo: tipo detectado y formatos de destino reales. */
type FileMeta = { kind: 'imagen' | 'documento'; targets: string[] }

export function ConvertSection({
  files,
  onChange
}: {
  files: string[]
  onChange: (paths: string[]) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [meta, setMeta] = useState<Record<string, FileMeta>>({})
  const [perFile, setPerFile] = useState<Record<string, string>>({})
  const [defaults, setDefaults] = useState<DefaultFormats | null>(null)
  const [quality, setQuality] = useState(90)
  const [useCustomDir, setUseCustomDir] = useState(false)
  const [customDir, setCustomDir] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)
  const [statuses, setStatuses] = useState<BatchItemStatus[]>([])
  const [info, setInfo] = useState<ImageInfo | null>(null)
  const [dragging, setDragging] = useState(false)

  // Formatos por defecto (Ajustes): condicionan la preselección de destinos.
  useEffect(() => {
    void window.api.defaults
      .get()
      .then(setDefaults)
      .catch(() => setDefaults({ image: null, document: null }))
  }, [])

  // --- Incorporación / retirada de archivos ----------------------------------
  const addPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return
      onChange(Array.from(new Set([...files, ...paths])))
    },
    [files, onChange]
  )

  const pickFiles = useCallback(async () => {
    addPaths(await window.api.dialog.pickFiles())
  }, [addPaths])

  const removeFile = useCallback(
    (path: string) => {
      onChange(files.filter((f) => f !== path))
    },
    [files, onChange]
  )

  // --- Tipo y destinos reales por archivo ------------------------------------
  // `meta` no va en deps a propósito: se lee su valor vigente y se actualiza
  // de forma idempotente (una doble carga del mismo archivo es inocua).
  // Se espera a `defaults` para poder preseleccionar el formato por defecto.
  useEffect(() => {
    if (!defaults) return
    setMeta((prev) => {
      const next: Record<string, FileMeta> = {}
      for (const path of files) if (prev[path]) next[path] = prev[path]
      return next
    })
    setPerFile((prev) => {
      const next: Record<string, string> = {}
      for (const path of files) if (prev[path]) next[path] = prev[path]
      return next
    })
    for (const path of files) {
      if (meta[path]) continue
      void (async () => {
        const isImage = await window.api.images.isImage(path)
        const targets: string[] = isImage
          ? await window.api.images.targets(path)
          : await window.api.docs.targets(path)
        setMeta((current) => ({
          ...current,
          [path]: { kind: isImage ? 'imagen' : 'documento', targets }
        }))
        // Preselección: formato por defecto de Ajustes si este archivo lo
        // admite; si no, el primero disponible (compatibilidad histórica).
        const preferred = isImage ? defaults.image : defaults.document
        setPerFile((current) => ({
          ...current,
          [path]:
            current[path] ??
            (preferred && targets.includes(preferred) ? preferred : (targets[0] ?? ''))
        }))
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, defaults])

  // --- Vista previa del archivo único (imágenes) ------------------------------
  const single = files.length === 1 ? files[0] : null
  const singleMeta = single ? meta[single] : null
  useEffect(() => {
    if (!single || !singleMeta || singleMeta.kind !== 'imagen') {
      setInfo(null)
      return
    }
    void window.api.images
      .info(single)
      .then(setInfo)
      .catch(() => setInfo(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, singleMeta?.kind])

  // --- Progreso del lote ------------------------------------------------------
  useEffect(() => {
    const offProgress = window.api.batch.onProgress((p) => {
      setProgress({ completed: p.completed, total: p.total })
      setStatuses(p.items)
    })
    // El resumen global en toast lo emite App.tsx (visible desde cualquier
    // sección); aquí solo se gestiona el estado de esta sección.
    const offDone = window.api.batch.onDone(() => {
      setRunning(false)
      setProgress(null)
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [])

  const pickOutputDir = useCallback(async () => {
    const dir = await window.api.window.pickDirectory()
    if (dir) setCustomDir(dir)
  }, [])

  // --- Ejecución (siempre por lotes: 1 archivo es un lote de uno) ------------
  const convertible = useMemo(
    () => files.filter((path) => meta[path] && (meta[path]?.targets.length ?? 0) > 0 && perFile[path]),
    [files, meta, perFile]
  )

  const startBatch = useCallback(async () => {
    if (convertible.length === 0) return
    setRunning(true)
    setStatuses(convertible.map((f) => ({ inputPath: f, status: 'pending' as const })))
    setProgress({ completed: 0, total: convertible.length })
    const response = await window.api.batch.run({
      // Indicativo: el tipo real se decide por archivo en el proceso main.
      kind: convertible.every((f) => meta[f]?.kind === 'documento') ? 'documentos' : 'imagenes',
      mode: 'per-file',
      items: convertible.map((f) => ({ inputPath: f, targetFormat: perFile[f] as ImageFormat })),
      quality,
      outputDir: useCustomDir ? customDir : null
    })
    if (!response.ok) {
      setRunning(false)
      toast.error(t('batch.startError'), { description: response.error.message })
    }
  }, [convertible, meta, perFile, quality, useCustomDir, customDir, t])

  const clear = useCallback(() => onChange([]), [onChange])

  // --- Condiciones de arranque ------------------------------------------------
  const loaded = files.length > 0 && files.every((path) => meta[path])
  const canRun =
    loaded && convertible.length > 0 && !running && (useCustomDir ? customDir !== null : true)
  // Calidad solo si algún destino elegido es imagen con parámetro de calidad.
  const showQuality = convertible.some(
    (path) => meta[path]?.kind === 'imagen' && supportsQuality(perFile[path] ?? '')
  )

  return (
    <div className="space-y-4">
      {/* Paso 1: archivos (clic o arrastre; el DnD global añade a la lista) */}
      <Card className="border-border/60 bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4" /> {t('convert.files')}
          </CardTitle>
          <CardDescription className="text-xs">{t('convert.formats')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              // El DnD global de App añade los archivos a la lista.
            }}
            className={cn(
              'flex cursor-pointer items-center justify-center gap-3 rounded-lg border-2 border-dashed p-5 text-center transition-colors',
              dragging ? 'border-primary bg-primary/10' : 'border-border/80 hover:border-primary/60'
            )}
          >
            <Upload
              className={cn('h-6 w-6', dragging ? 'text-primary' : 'text-muted-foreground')}
            />
            <div>
              <p className="text-sm font-medium">{t('convert.drop')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('batch.addFiles', { count: files.length })}
              </p>
            </div>
          </div>

          {files.length > 0 && (
            <div className="max-h-64 space-y-1 overflow-auto rounded-md border border-border/60 p-2">
              {files.map((path) => {
                const fileMeta = meta[path]
                return (
                  <div key={path} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      {fileMeta?.kind === 'imagen' ? (
                        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate" title={path}>
                        {baseName(path)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!fileMeta ? (
                        <Spinner />
                      ) : fileMeta.targets.length === 0 ? (
                        <span className="text-destructive">{t('convert.noTargets')}</span>
                      ) : (
                        <Select
                          value={perFile[path] ?? ''}
                          onValueChange={(v) => setPerFile((p) => ({ ...p, [path]: v }))}
                          disabled={running}
                        >
                          <SelectTrigger className="h-7 w-32 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {fileMeta.targets.map((fmt) => (
                              <SelectItem key={fmt} value={fmt}>
                                {fmt.toUpperCase()}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {!running && (
                        <button
                          onClick={() => removeFile(path)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vista previa del archivo único (imágenes) */}
      {single && info && (
        <Card className="border-border/60 bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ImageIcon className="h-4 w-4" /> {t('img.preview')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4">
            <img
              src={`file://${info.path}`}
              alt=""
              className="max-h-40 rounded-md object-contain"
            />
            <dl className="space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between gap-6">
                <dt>{t('img.origin')}</dt>
                <dd className="uppercase">{info.format}</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt>{t('img.dimensions')}</dt>
                <dd className="tabular-nums">
                  {info.width}×{info.height}
                </dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt>{t('img.size')}</dt>
                <dd className="tabular-nums">{(info.sizeBytes / 1024).toFixed(1)} KB</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Paso 2: calidad, destino y ejecución */}
      {files.length > 0 && (
        <Card className="border-border/60 bg-card/50">
          <CardContent className="flex flex-col gap-4 pt-6">
            {showQuality && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <Label>{t('batch.quality')}</Label>
                  <span className="tabular-nums text-muted-foreground">{quality}%</span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[quality]}
                  onValueChange={([v]) => setQuality(v)}
                  disabled={running}
                />
              </div>
            )}

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('batch.customDir')}</Label>
                <p className="text-xs text-muted-foreground">
                  {useCustomDir ? (customDir ?? t('batch.customDirOn')) : t('batch.customDirOff')}
                </p>
              </div>
              <Switch checked={useCustomDir} onCheckedChange={setUseCustomDir} disabled={running} />
            </div>
            {useCustomDir && (
              <Button variant="outline" onClick={() => void pickOutputDir()} disabled={running}>
                <FolderOpen className="h-4 w-4" />
                {t('batch.pickFolder')}
              </Button>
            )}

            {running ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Spinner /> {t('batch.converting')} {progress?.completed ?? 0}/
                    {progress?.total ?? convertible.length}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void window.api.batch.cancel()}
                  >
                    {t('batch.cancel')}
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
                <Button onClick={() => void startBatch()} disabled={!canRun}>
                  <Play className="h-4 w-4" />
                  {convertible.length === 1
                    ? t('img.convert')
                    : t('batch.start', { count: convertible.length })}
                </Button>
                <Button variant="ghost" onClick={clear}>
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
