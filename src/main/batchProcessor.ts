import { BrowserWindow } from 'electron'
import { convertImage } from './imageConverter'
import { convertDocument, detectDocumentFormat } from './docConverter'
import type {
  BatchItemStatus,
  BatchOptions,
  BatchProgress,
  BatchSummary,
  ImageFormat
} from '../shared/types'

/**
 * Procesador de lotes (Fase 5).
 *
 * Ejecuta una cola de conversiones con concurrencia limitada, emitiendo progreso
 * al renderer por IPC y permitiendo cancelación cooperativa.
 */

const CONCURRENCY = 4

let cancelRequested = false
let running = false

/** Envía progreso a los renderer; fuera de Electron (scripts) no hace nada. */
function send(channel: string, payload: unknown): void {
  if (typeof BrowserWindow === 'undefined' || !BrowserWindow) return
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

function emit(progress: BatchProgress): void {
  send('batch:progress', progress)
}

export function isBatchRunning(): boolean {
  return running
}

/** Solicita la cancelación cooperativa del lote en curso. */
export function cancelBatch(): void {
  cancelRequested = true
}

async function convertOne(
  item: BatchOptions['items'][number],
  options: BatchOptions
): Promise<{ outputPath: string }> {
  // El tipo se decide POR ARCHIVO: un lote puede mezclar imágenes y
  // documentos (la sección Convertir es única y admite ambos).
  if (detectDocumentFormat(item.inputPath)) {
    const result = await convertDocument({
      inputPath: item.inputPath,
      targetFormat: (item.targetFormat ?? options.targetFormat) as never,
      outputDir: options.outputDir
    })
    return { outputPath: result.outputPath }
  }
  const result = await convertImage({
    inputPath: item.inputPath,
    targetFormat: (item.targetFormat ?? options.targetFormat) as ImageFormat,
    quality: options.quality,
    outputDir: options.outputDir
  })
  return { outputPath: result.outputPath }
}

/** Ejecuta un lote completo y devuelve el resumen. */
export async function runBatch(options: BatchOptions): Promise<BatchSummary> {
  if (running) throw new Error('Ya hay un lote en curso')
  running = true
  cancelRequested = false

  const items: BatchItemStatus[] = options.items.map((item) => ({
    inputPath: item.inputPath,
    status: 'pending'
  }))
  const total = items.length
  let completed = 0
  let cursor = 0

  const report = (current: BatchItemStatus): void => {
    emit({ completed, total, current, items: items.map((i) => ({ ...i })) })
  }

  const worker = async (): Promise<void> => {
    while (true) {
      if (cancelRequested) return
      const index = cursor++
      if (index >= total) return

      const status = items[index]
      status.status = 'converting'
      report(status)

      try {
        const { outputPath } = await convertOne(options.items[index], options)
        status.status = 'done'
        status.outputPath = outputPath
      } catch (error) {
        status.status = 'error'
        status.error = error instanceof Error ? error.message : String(error)
      }
      completed += 1
      report(status)
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker())
  await Promise.all(workers)

  running = false
  const summary: BatchSummary = {
    total,
    succeeded: items.filter((i) => i.status === 'done').length,
    failed: items.filter((i) => i.status === 'error').length,
    items: items.map((i) => ({ ...i }))
  }
  // Emite un evento final con el resumen.
  send('batch:done', summary)
  return summary
}
