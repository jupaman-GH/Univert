import { basename, dirname, extname, join } from 'path'
import { access, readFile, rm, stat, writeFile } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { PDFDocument } from 'pdf-lib'
import { findBinary } from './binaries'
import type { DocumentFormat } from '../shared/types'

export type { DocumentFormat }

const execFileAsync = promisify(execFile)

/**
 * Motor de documentos (Fase 4).
 *
 * - Operaciones PDF estructurales (unir/partir/crear): `pdf-lib` (JS puro, sin binario).
 * - Conversiones de texto/marcado (md, html, txt, rtf, docx, odt, epub): Pandoc (binario).
 * - Documento → PDF: Pandoc compone un HTML intermedio y `wkhtmltopdf` lo
 *   rinde a PDF (motor PDF opcional de Ajustes → Motores).
 * - PDF → imagen: Ghostscript (binario).
 * - Faltan binarios → se degrada con MOTOR_MISSING.
 */

export const DOC_EXTENSIONS: Record<string, DocumentFormat> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.odt': 'odt',
  '.rtf': 'rtf',
  '.txt': 'txt',
  '.md': 'md',
  '.markdown': 'md',
  '.html': 'html',
  '.htm': 'html',
  '.epub': 'epub',
  '.csv': 'csv'
}
// Nota: 'png' es un DocumentFormat válido solo como *destino* de PDF→imagen (Ghostscript);
// como archivo de entrada se enruta como imagen, por eso no aparece en DOC_EXTENSIONS.

/** Formatos que Pandoc puede leer/escribir (aproximación documentada en README). */
const PANDOC_FORMATS = new Set<DocumentFormat>(['md', 'html', 'txt', 'rtf', 'docx', 'odt', 'epub'])

export function isDocumentFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() in DOC_EXTENSIONS
}

export function detectDocumentFormat(filePath: string): DocumentFormat | null {
  return DOC_EXTENSIONS[extname(filePath).toLowerCase()] ?? null
}

/** Formatos de destino disponibles para un origen dado, según los motores presentes. */
export async function documentTargets(source: DocumentFormat): Promise<DocumentFormat[]> {
  const targets: DocumentFormat[] = []
  const pandoc = await findBinary('pandoc')
  const gs = await findBinary('gs')

  if (pandoc && PANDOC_FORMATS.has(source)) {
    for (const format of PANDOC_FORMATS) {
      if (format !== source) targets.push(format)
    }
    // PDF como destino: Pandoc compone el HTML y wkhtmltopdf lo rinde.
    if (await findBinary('wkhtmltopdf')) targets.push('pdf')
  }
  if (source === 'pdf' && gs) {
    targets.push('png')
  }
  if (source === 'pdf' && pandoc) {
    // Pandoc no lee PDF; para extraer texto usaríamos pdfjs (no implementado como destino).
  }
  return targets
}

async function resolveDocOutputPath(
  inputPath: string,
  format: DocumentFormat,
  outputDir: string | null | undefined
): Promise<string> {
  const dir = outputDir ?? dirname(inputPath)
  const stem = basename(inputPath, extname(inputPath))
  const ext = format === 'md' ? '.md' : `.${format}`
  let candidate = join(dir, `${stem}_converted${ext}`)
  let counter = 2
  while (await fileExists(candidate)) {
    candidate = join(dir, `${stem}_converted_${counter}${ext}`)
    counter += 1
  }
  return candidate
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export type ConvertDocOptions = {
  inputPath: string
  targetFormat: DocumentFormat
  outputDir?: string | null
  /** Para PDF→png: página inicial (1-based). */
  firstPage?: number
  lastPage?: number
}

export type ConvertDocResult = {
  outputPath: string
  sizeBytes: number
  durationMs: number
}

/** Une varios PDF en uno solo (JS puro). */
export async function mergePdfs(paths: string[], outputPath: string): Promise<ConvertDocResult> {
  const startedAt = performance.now()
  const merged = await PDFDocument.create()
  for (const path of paths) {
    const bytes = await readFile(path)
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const pages = await merged.copyPages(doc, doc.getPageIndices())
    for (const page of pages) merged.addPage(page)
  }
  const outBytes = await merged.save()
  await writeFile(outputPath, outBytes)
  return { outputPath, sizeBytes: outBytes.length, durationMs: performance.now() - startedAt }
}

/** Divide un PDF en un PDF por página (o un rango). */
export async function splitPdf(
  inputPath: string,
  outputDir: string
): Promise<ConvertDocResult[]> {
  const startedAt = performance.now()
  const bytes = await readFile(inputPath)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const stem = basename(inputPath, extname(inputPath))
  const results: ConvertDocResult[] = []
  const pageIndices = doc.getPageIndices()
  const single = pageIndices.length === 1

  for (const index of pageIndices) {
    const out = await PDFDocument.create()
    const [page] = await out.copyPages(doc, [index])
    out.addPage(page)
    const outBytes = await out.save()
    const suffix = single ? '' : `_page${index + 1}`
    const outputPath = join(outputDir, `${stem}${suffix}.pdf`)
    await writeFile(outputPath, outBytes)
    results.push({ outputPath, sizeBytes: outBytes.length, durationMs: 0 })
  }
  const durationMs = performance.now() - startedAt
  return results.map((r) => ({ ...r, durationMs }))
}

/** Convierte un documento usando el motor apropiado. */
export async function convertDocument(options: ConvertDocOptions): Promise<ConvertDocResult> {
  const { inputPath, targetFormat, outputDir } = options
  const sourceFormat = detectDocumentFormat(inputPath)
  if (!sourceFormat) {
    throw new Error(`Formato de documento no reconocido: ${extname(inputPath)}`)
  }

  const startedAt = performance.now()
  const outputPath = await resolveDocOutputPath(inputPath, targetFormat, outputDir)

  // PDF → imagen vía Ghostscript.
  if (sourceFormat === 'pdf' && targetFormat === 'png') {
    const gs = await findBinary('gs')
    if (!gs) throw new Error('MOTOR_MISSING: Ghostscript no está instalado (Fase 6)')
    const first = options.firstPage ?? 1
    const last = options.lastPage ?? first
    const prefix = outputPath.replace(/\.png$/i, '')
    await execFileAsync(gs, [
      '-dSAFER',
      '-dBATCH',
      '-dNOPAUSE',
      '-sDEVICE=png16m',
      '-r150',
      `-dFirstPage=${first}`,
      `-dLastPage=${last}`,
      `-sOutputFile=${prefix}-%03d.png`,
      inputPath
    ])
    // Ghostscript añade el número de página; devolvemos el primero.
    const actual = `${prefix}-001.png`
    const s = await stat(actual)
    return { outputPath: actual, sizeBytes: s.size, durationMs: performance.now() - startedAt }
  }

  // Documento → PDF: Pandoc (origen → HTML) + wkhtmltopdf (HTML → PDF).
  if (targetFormat === 'pdf') {
    const pandocPdf = await findBinary('pandoc')
    const wkhtmltopdf = await findBinary('wkhtmltopdf')
    if (!pandocPdf) throw new Error('MOTOR_MISSING: Pandoc no está instalado (Fase 4)')
    if (!wkhtmltopdf) {
      throw new Error(
        'MOTOR_MISSING: el motor PDF (wkhtmltopdf) no está instalado (Ajustes → Motores → Motor PDF)'
      )
    }
    const fromFlagPdf = sourceFormat === 'md' ? 'markdown' : sourceFormat
    // HTML intermedio junto al destino (se borra siempre; las imágenes del
    // documento se extraen a un medio temporal que wkhtmltopdf referencia).
    const tmpHtml = outputPath.replace(/\.pdf$/i, '') + '.tmp.html'
    const mediaDir = tmpHtml + '-media'
    try {
      await execFileAsync(pandocPdf, [
        inputPath,
        '-f',
        fromFlagPdf,
        '-t',
        'html',
        '-s',
        '--extract-media',
        mediaDir,
        '-o',
        tmpHtml
      ])
      await execFileAsync(wkhtmltopdf, ['--enable-local-file-access', tmpHtml, outputPath], {
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024
      })
      const s = await stat(outputPath)
      return { outputPath, sizeBytes: s.size, durationMs: performance.now() - startedAt }
    } finally {
      await rm(tmpHtml, { force: true }).catch(() => undefined)
      await rm(mediaDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  // Resto: Pandoc.
  const pandoc = await findBinary('pandoc')
  if (!pandoc) throw new Error('MOTOR_MISSING: Pandoc no está instalado (Fase 4)')

  const fromFlag = sourceFormat === 'md' ? 'markdown' : sourceFormat
  const toFlag = targetFormat === 'md' ? 'markdown' : targetFormat
  await execFileAsync(pandoc, [inputPath, '-f', fromFlag, '-t', toFlag, '-o', outputPath])

  const s = await stat(outputPath)
  return { outputPath, sizeBytes: s.size, durationMs: performance.now() - startedAt }
}
