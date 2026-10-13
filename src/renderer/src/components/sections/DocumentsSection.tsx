import { useCallback, useEffect, useState } from 'react'
import { FileText, FolderOpen, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { ConvertDocResult, DocumentFormat } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const DOC_LABELS: Record<DocumentFormat, string> = {
  pdf: 'PDF',
  docx: 'Word (DOCX)',
  odt: 'ODT',
  rtf: 'RTF',
  txt: 'Texto (TXT)',
  md: 'Markdown',
  html: 'HTML',
  epub: 'EPUB',
  csv: 'CSV',
  png: 'PNG (imagen)'
}

export function DocumentsSection({ initialPath }: { initialPath?: string }): React.JSX.Element {
  const { t } = useI18n()
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [targets, setTargets] = useState<DocumentFormat[]>([])
  const [targetFormat, setTargetFormat] = useState<DocumentFormat | null>(null)
  const [useCustomDir, setUseCustomDir] = useState(false)
  const [customDir, setCustomDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<ConvertDocResult | null>(null)
  const [dragging, setDragging] = useState(false)

  const loadFile = useCallback(async (filePath: string) => {
    setSourcePath(filePath)
    setLastResult(null)
    const available = await window.api.docs.targets(filePath)
    setTargets(available)
    setTargetFormat(available[0] ?? null)
    if (available.length === 0) {
      toast.info(t('doc.noEngineInfo'), { description: t('doc.noEngineDesc') })
    }
  }, [t])

  useEffect(() => {
    if (initialPath) void loadFile(initialPath)
  }, [initialPath, loadFile])

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      void loadFile(window.api.dnd.getPathForFile(file))
    },
    [loadFile]
  )

  const pickFile = useCallback(async () => {
    const [path] = await window.api.dialog.pickFiles('documentos')
    if (path) void loadFile(path)
  }, [loadFile])

  const pickOutputDir = useCallback(async () => {
    const dir = await window.api.window.pickDirectory()
    if (dir) setCustomDir(dir)
  }, [])

  const convert = useCallback(async () => {
    if (!sourcePath || !targetFormat) return
    setBusy(true)
    try {
      const response = await window.api.docs.convert({
        inputPath: sourcePath,
        targetFormat,
        outputDir: useCustomDir ? customDir : null
      })
      if (response.ok) {
        setLastResult(response.result)
        toast.success(t('doc.converted'), { description: response.result.outputPath })
      } else {
        toast.error(t('doc.convertError'), { description: response.error.message })
      }
    } finally {
      setBusy(false)
    }
  }, [sourcePath, targetFormat, useCustomDir, customDir, t])

  return (
    <div className="space-y-4">
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
          dragging ? 'border-primary bg-primary/10' : 'border-border/80 hover:border-primary/60 hover:bg-accent/40'
        )}
      >
        <Upload className={cn('h-8 w-8', dragging ? 'text-primary' : 'text-muted-foreground')} />
        <div>
          <p className="text-sm font-medium">{t('doc.drop')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('doc.formats')}</p>
        </div>
      </div>

      {sourcePath && (
        <Card className="border-border/60 bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4" /> {t('doc.convert')}
            </CardTitle>
            <CardDescription className="break-all text-xs">{sourcePath}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t('doc.targetFormat')}</Label>
              <Select
                value={targetFormat ?? undefined}
                onValueChange={(v) => setTargetFormat(v as DocumentFormat)}
                disabled={targets.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={targets.length === 0 ? t('doc.noEngines') : undefined} />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((f) => (
                    <SelectItem key={f} value={f}>
                      {DOC_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('doc.customDir')}</Label>
                <p className="text-xs text-muted-foreground">
                  {useCustomDir ? (customDir ?? t('doc.customDirOn')) : t('doc.customDirOff')}
                </p>
              </div>
              <Switch checked={useCustomDir} onCheckedChange={setUseCustomDir} />
            </div>

            {useCustomDir && (
              <Button variant="outline" onClick={pickOutputDir}>
                <FolderOpen className="h-4 w-4" />
                {t('doc.pickFolder')}
              </Button>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={convert} disabled={busy || !targetFormat || (useCustomDir && !customDir)}>
                {busy ? <Spinner /> : null}
                {t('doc.convert')}
              </Button>
              {lastResult && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void window.api.shell.openPath(lastResult.outputPath.replace(/\\/g, '/').replace(/\/[^/]+$/, ''))}
                >
                  <FolderOpen className="h-4 w-4" />
                  {t('doc.openFolder')}
                </Button>
              )}
            </div>

            {lastResult && (
              <p className="text-xs text-muted-foreground">
                Generado: {lastResult.outputPath} · {(lastResult.sizeBytes / 1024).toFixed(1)} KB ·{' '}
                {Math.round(lastResult.durationMs)} ms
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
