import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, ImageIcon, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { ConvertImageResult, ImageFormat, ImageInfo } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** Etiquetas de los formatos que la UI puede ofrecer como destino. */
const TARGET_LABELS: Partial<Record<ImageFormat, string>> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  avif: 'AVIF',
  tiff: 'TIFF',
  gif: 'GIF',
  bmp: 'BMP',
  ico: 'ICO'
}

/** Formatos de destino que admiten control de calidad (bmp/ico no lo admiten). */
const QUALITY_TARGETS = new Set<ImageFormat>(['png', 'jpeg', 'webp', 'avif', 'tiff', 'gif'])

/** Propiedad que la UI usa para saber si un formato admite control de calidad. */
function supportsQuality(format: ImageFormat): boolean {
  return QUALITY_TARGETS.has(format)
}

export function ImagesSection({ initialPath }: { initialPath?: string }): React.JSX.Element {
  const { t } = useI18n()
  const [info, setInfo] = useState<ImageInfo | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  /** Destinos reales según los motores instalados (lo decide el proceso main). */
  const [targets, setTargets] = useState<ImageFormat[]>([])
  const [targetFormat, setTargetFormat] = useState<ImageFormat>('png')
  const [quality, setQuality] = useState(90)
  const [useCustomDir, setUseCustomDir] = useState(false)
  const [customDir, setCustomDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<ConvertImageResult | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadFile = useCallback(async (filePath: string) => {
    try {
      const imageInfo = await window.api.images.info(filePath)
      setInfo(imageInfo)
      setLastResult(null)
      // Preview vía data-URL leído por el proceso main no está expuesto; usamos file://.
      setPreviewUrl(`file://${filePath}`)
      // Destinos habilitados según los motores instalados (bmp/ico requieren
      // ImageMagick; la lista la calcula main y excluye el formato de origen).
      const available = await window.api.images.targets(filePath)
      setTargets(available)
      setTargetFormat(available[0] ?? 'png')
    } catch (error) {
      toast.error(t('img.readError'), { description: String(error) })
    }
  }, [t])

  // Archivo inicial llegando por DnD global desde App.
  useEffect(() => {
    if (initialPath) void loadFile(initialPath)
  }, [initialPath, loadFile])

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      const path = window.api.dnd.getPathForFile(file)
      void loadFile(path)
    },
    [loadFile]
  )

  const pickFile = useCallback(async () => {
    const [path] = await window.api.dialog.pickFiles('imagenes')
    if (path) void loadFile(path)
  }, [loadFile])

  const pickOutputDir = useCallback(async () => {
    const dir = await window.api.window.pickDirectory()
    if (dir) setCustomDir(dir)
  }, [])

  const convert = useCallback(async () => {
    if (!info) return
    setBusy(true)
    try {
      const response = await window.api.images.convert({
        inputPath: info.path,
        targetFormat,
        quality: supportsQuality(targetFormat) ? quality : undefined,
        outputDir: useCustomDir ? customDir : null
      })
      if (response.ok) {
        setLastResult(response.result)
        toast.success(t('img.converted'), { description: response.result.outputPath })
      } else {
        toast.error(t('img.convertError'), { description: response.error.message })
      }
    } finally {
      setBusy(false)
    }
  }, [info, targetFormat, quality, useCustomDir, customDir, t])

  return (
    <div className="space-y-4">
      {/* Zona de carga / drag & drop */}
      <div
        onClick={pickFile}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
          dragging
            ? 'border-primary bg-primary/10'
            : 'border-border/80 hover:border-primary/60 hover:bg-accent/40'
        )}
      >
        <Upload className={cn('h-8 w-8', dragging ? 'text-primary' : 'text-muted-foreground')} />
        <div>
          <p className="text-sm font-medium">{t('img.drop')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('img.formats')}</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {info && (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          {/* Preview */}
          <Card className="border-border/60 bg-card/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ImageIcon className="h-4 w-4" /> {t('img.preview')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt={t('img.preview')}
                  className="max-h-48 w-full rounded-md object-contain"
                />
              )}
              <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <dt>{t('img.origin')}</dt>
                  <dd className="uppercase">{info.format}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t('img.dimensions')}</dt>
                  <dd className="tabular-nums">
                    {info.width}×{info.height}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t('img.size')}</dt>
                  <dd className="tabular-nums">{(info.sizeBytes / 1024).toFixed(1)} KB</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Controles */}
          <Card className="border-border/60 bg-card/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('img.convert')}</CardTitle>
              <CardDescription className="break-all text-xs">{info.path}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t('img.targetFormat')}</Label>
                <Select value={targetFormat} onValueChange={(v) => setTargetFormat(v as ImageFormat)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((f) => (
                      <SelectItem key={f} value={f}>
                        {TARGET_LABELS[f] ?? f.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {targets.length === 0 && (
                  <p className="text-xs text-destructive">{t('img.noEngines')}</p>
                )}
              </div>

              {supportsQuality(targetFormat) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{t('img.quality')}</Label>
                    <span className="tabular-nums text-sm text-muted-foreground">{quality}%</span>
                  </div>
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={[quality]}
                    onValueChange={([v]) => setQuality(v)}
                  />
                </div>
              )}

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t('img.customDir')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {useCustomDir
                      ? (customDir ?? t('img.customDirOn'))
                      : t('img.customDirOff')}
                  </p>
                </div>
                <Switch checked={useCustomDir} onCheckedChange={setUseCustomDir} />
              </div>

              {useCustomDir && (
                <Button variant="outline" onClick={pickOutputDir}>
                  <FolderOpen className="h-4 w-4" />
                  {t('img.pickFolder')}
                </Button>
              )}

              <div className="flex items-center gap-3">
                <Button onClick={convert} disabled={busy || targets.length === 0 || (useCustomDir && !customDir)}>
                  {busy ? <Spinner /> : null}
                  {t('img.convert')}
                </Button>
                {lastResult && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void window.api.shell.openPath(lastResult.outputPath.replace(/\\/g, '/').replace(/\/[^/]+$/, ''))}
                  >
                    <FolderOpen className="h-4 w-4" />
                    {t('img.openFolder')}
                  </Button>
                )}
              </div>

              {lastResult && (
                <p className="text-xs text-muted-foreground">
                  Generado: {lastResult.outputPath} · {lastResult.width}×{lastResult.height} ·{' '}
                  {(lastResult.sizeBytes / 1024).toFixed(1)} KB ·{' '}
                  {Math.round(lastResult.durationMs)} ms
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
