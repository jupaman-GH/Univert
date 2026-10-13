import { basename, dirname, extname, join } from 'path'
import { access, mkdtemp, rm, stat, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import sharp, { type Sharp } from 'sharp'
import { Resvg } from '@resvg/resvg-js'
import { findBinary } from './binaries'
import { IMAGE_FORMATS } from '../shared/types'
import type {
  ConvertImageOptions,
  ConvertImageResult,
  ImageFormat,
  ImageInfo
} from '../shared/types'

/**
 * Motor de conversión de imágenes (Fase 2 + binarios de la Fase 6).
 *
 * - Raster: sharp (libvips) cubre png/jpeg/webp/avif/tiff/gif.
 * - SVG: se rasteriza con resvg y, si el destino no es png, se re-encripta con sharp.
 * - bmp/ico/heic/raw: libvips no ESCRIBE bmp/ico, no LEE bmp/ico/raw y con heic
 *   solo lee la cabecera (el binario oficial no incluye libde265 y no decodifica
 *   HEVC). La conversión se rutas a ImageMagick (binario descargable desde
 *   Ajustes); sin motor, la UI no ofrece destinos y aquí se lanza la guía de
 *   instalación.
 */

/** Formatos que sharp (libvips) codifica realmente. */
const SHARP_OUTPUT = new Set<ImageFormat>(['png', 'jpeg', 'webp', 'avif', 'tiff', 'gif'])

/** Salidas que solo ImageMagick puede codificar (sharp no tiene bmp/ico). */
const MAGICK_OUTPUT = new Set<ImageFormat>(['bmp', 'ico'])

/**
 * Entradas que libvips no DECODIFICA: bmp/ico/raw no las lee, y de heic solo
 * lee la cabecera (metadata) sin poder decodificar HEVC. La conversión pasa
 * siempre por ImageMagick; `getImageInfo` puede resolverse sin él porque solo
 * necesita la cabecera.
 */
const MAGICK_ONLY_INPUT = new Set<ImageFormat>(['bmp', 'ico', 'heic', 'raw'])

const execFileAsync = promisify(execFile)

/** Mensaje de error uniforme cuando falta ImageMagick. */
function magickRequired(what: string): Error {
  return new Error(`${what} requiere ImageMagick: instálalo desde Ajustes → General → Descargar`)
}

/** Identifica una imagen con ImageMagick (ancho/alto/alfa) para formatos que sharp no lee. */
async function magickIdentify(
  magick: string,
  filePath: string
): Promise<{ width: number; height: number; hasAlpha: boolean }> {
  const { stdout } = await execFileAsync(magick, ['identify', '-format', '%w|%h|%[channels]', filePath])
  const [w, h, channels = ''] = stdout.trim().split('|')
  const width = parseInt(w, 10)
  const height = parseInt(h, 10)
  if (!width || !height) throw new Error('No se pudieron leer las dimensiones de la imagen')
  return { width, height, hasAlpha: channels.endsWith('a') || channels.includes('alpha') }
}

/** Formatos de salida que admiten control de calidad. */
const QUALITY_FORMATS = new Set<ImageFormat>(['jpeg', 'webp', 'avif', 'tiff', 'gif'])

/** Extensión canónica por formato de imagen. */
const EXTENSION: Record<ImageFormat, string> = {
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
  avif: '.avif',
  tiff: '.tiff',
  gif: '.gif',
  bmp: '.bmp',
  ico: '.ico',
  heic: '.heic',
  raw: '.raw',
  svg: '.svg'
}

const EXTENSION_TO_FORMAT: Record<string, ImageFormat> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.jpe': 'jpeg',
  '.webp': 'webp',
  '.avif': 'avif',
  '.tif': 'tiff',
  '.tiff': 'tiff',
  '.gif': 'gif',
  '.bmp': 'bmp',
  '.ico': 'ico',
  '.heic': 'heic',
  '.heif': 'heic',
  '.raw': 'raw',
  '.svg': 'svg'
}

export function isImageFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() in EXTENSION_TO_FORMAT
}

/** Detecta el formato por extensión (los binarios de la Fase 6 validan además por contenido). */
export function detectImageFormat(filePath: string): ImageFormat | null {
  return EXTENSION_TO_FORMAT[extname(filePath).toLowerCase()] ?? null
}

/** Mapea calidad 0–100 del UI a los parámetros reales de cada formato de salida. */
function qualityFor(format: ImageFormat, quality: number): number {
  const clamped = Math.min(100, Math.max(0, quality))
  switch (format) {
    case 'png':
      // sharp: quality solo aplica con palette; lo usamos como umbral de cuantización.
      return clamped
    case 'gif':
      // sharp: colours 2–256.
      return Math.max(2, Math.round(2 + (clamped / 100) * 254))
    default:
      // jpeg/webp/avif/tiff: 1–100 (1 = peor calidad mínima permitida).
      return Math.max(1, clamped)
  }
}

function applyQuality(pipeline: Sharp, format: ImageFormat, quality: number): Sharp {
  const value = qualityFor(format, quality)
  switch (format) {
    case 'jpeg':
      return pipeline.jpeg({ quality: value, chromaSubsampling: quality >= 90 ? '4:4:4' : '4:2:0' })
    case 'webp':
      return pipeline.webp({ quality: value })
    case 'avif':
      return pipeline.avif({ quality: value })
    case 'tiff':
      return pipeline.tiff({ quality: value })
    case 'gif':
      return pipeline.gif({ colours: value })
    case 'png':
      return pipeline.png({
        compressionLevel: Math.round(((100 - value) / 100) * 9),
        palette: value < 100,
        quality: value
      })
    default:
      return pipeline
  }
}

/**
 * Construye el nombre de salida: `foto.png` → `foto_converted.webp`, añadiendo
 * numeración si el destino ya existe para no pisar archivos.
 */
export async function resolveOutputPath(
  inputPath: string,
  format: ImageFormat,
  outputDir: string | null | undefined
): Promise<string> {
  const dir = outputDir ?? dirname(inputPath)
  const stem = basename(inputPath, extname(inputPath))
  let candidate = join(dir, `${stem}_converted${EXTENSION[format]}`)
  let counter = 2
  while (await fileExists(candidate)) {
    candidate = join(dir, `${stem}_converted_${counter}${EXTENSION[format]}`)
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

/** Convierte SVG a buffer rasterizado con resvg (sin binarios del sistema). */
function svgToPngBuffer(svg: Buffer, width?: number): Promise<Buffer> {
  const resvg = new Resvg(svg, width ? { fitTo: { mode: 'width', value: width } } : undefined)
  const rendered = resvg.render()
  return Promise.resolve(Buffer.from(rendered.asPng()))
}

/** Analiza un archivo de imagen: formato, dimensiones, alfa y tamaño. */
export async function getImageInfo(filePath: string): Promise<ImageInfo> {
  const format = detectImageFormat(filePath)
  if (!format) {
    throw new Error(`Formato de imagen no reconocido: ${extname(filePath) || '(sin extensión)'}`)
  }
  const fileStat = await stat(filePath)
  let width = 0
  let height = 0
  let hasAlpha = false
  try {
    const metadata = await sharp(filePath, format === 'svg' ? { density: 300 } : {}).metadata()
    width = metadata.width ?? 0
    height = metadata.height ?? 0
    hasAlpha = metadata.hasAlpha ?? false
    if (!width || !height) throw new Error('No se pudieron leer las dimensiones de la imagen')
  } catch (sharpError) {
    // sharp (libvips) no lee bmp/ico/raw (heic sí por cabecera, no llega aquí):
    // lo intenta ImageMagick si está.
    const magick = await findBinary('magick')
    if (!magick) {
      if (MAGICK_ONLY_INPUT.has(format)) throw magickRequired(`Leer ${format.toUpperCase()}`)
      throw sharpError
    }
    ;({ width, height, hasAlpha } = await magickIdentify(magick, filePath))
  }
  return {
    format,
    width,
    height,
    hasAlpha,
    sizeBytes: fileStat.size,
    path: filePath
  }
}

/**
 * Destinos de conversión disponibles para un archivo de origen concreto.
 * La UI la consume por IPC (mismo patrón que `docs:targets`) para mostrar solo
 * los formatos que los motores instalados pueden escribir realmente.
 */
export async function availableImageTargets(inputPath: string): Promise<ImageFormat[]> {
  const source = detectImageFormat(inputPath)
  const hasMagick = Boolean(await findBinary('magick'))
  const targets: ImageFormat[] = []
  // Sin ImageMagick, un origen que solo decodifica ImageMagick (bmp/ico/heic/raw)
  // no tiene ningún destino posible: la UI muestra el mensaje de guía en vez de
  // destinos que fallarían al convertir.
  if (!hasMagick && source && MAGICK_ONLY_INPUT.has(source)) return targets
  for (const format of IMAGE_FORMATS) {
    if (format === source) continue
    if (SHARP_OUTPUT.has(format)) targets.push(format)
    else if (MAGICK_OUTPUT.has(format) && hasMagick) targets.push(format)
  }
  return targets
}

/** Convierte una imagen al formato indicado y devuelve el resultado. */
export async function convertImage(options: ConvertImageOptions): Promise<ConvertImageResult> {
  const { inputPath, targetFormat, quality = 80, outputDir } = options

  const sourceFormat = detectImageFormat(inputPath)
  if (!sourceFormat) {
    throw new Error(`Formato de origen no soportado: ${extname(inputPath) || '(sin extensión)'}`)
  }
  if (targetFormat === 'heic' || targetFormat === 'raw') {
    throw new Error(
      `La conversión a ${targetFormat.toUpperCase()} no está disponible: ImageMagick solo permite leerlos, no escribirlos`
    )
  }
  if (!SHARP_OUTPUT.has(targetFormat) && !MAGICK_OUTPUT.has(targetFormat)) {
    throw new Error(`La conversión a ${targetFormat.toUpperCase()} no está disponible en esta fase`)
  }

  const startedAt = performance.now()
  const outputPath = await resolveOutputPath(inputPath, targetFormat, outputDir)

  // --- Destinos que solo ImageMagick codifica (bmp/ico) ---------------------
  // magick también decodifica aquí la entrada (cualquier formato), así que una
  // sola llamada cubre casos como heic → bmp.
  if (MAGICK_OUTPUT.has(targetFormat)) {
    const magick = await findBinary('magick')
    if (!magick) throw magickRequired(`La conversión a ${targetFormat.toUpperCase()}`)
    const args: string[] = []
    if (targetFormat === 'ico') {
      // Icono multiresolución estándar de Windows (256…16 px).
      args.push('-define', 'icon:auto-resize=256,128,64,48,32,16')
    }
    args.push(inputPath, outputPath)
    await execFileAsync(magick, args)
    const dims = await magickIdentify(magick, outputPath)
    const outStat = await stat(outputPath)
    return {
      outputPath,
      width: dims.width,
      height: dims.height,
      sizeBytes: outStat.size,
      durationMs: performance.now() - startedAt
    }
  }

  // --- Entradas que libvips no decodifica (bmp/ico/heic/raw) ----------------
  // sharp lee la cabecera de heic (metadata), pero el binario oficial no incluye
  // libde265 y no decodifica HEVC: la conversión pasa siempre por ImageMagick,
  // que sí decodifica a un PNG temporal. El resto del pipeline es el habitual de
  // sharp (calidad, resolución de nombres, etc.).
  let effectiveInput = inputPath
  let tempDir: string | null = null
  if (MAGICK_ONLY_INPUT.has(sourceFormat)) {
    const magick = await findBinary('magick')
    if (!magick) throw magickRequired(`El formato ${sourceFormat.toUpperCase()}`)
    tempDir = await mkdtemp(join(tmpdir(), 'univert-'))
    effectiveInput = join(tempDir, 'decoded.png')
    await execFileAsync(magick, [inputPath, effectiveInput])
  }

  try {
    let pipeline: Sharp
    if (sourceFormat === 'svg') {
      // resvg rasteriza el SVG; sharp hace la codificación al formato destino.
      const pngBuffer = await svgToPngBuffer(
        await import('fs/promises').then((fs) => fs.readFile(effectiveInput))
      )
      pipeline = sharp(pngBuffer)
    } else {
      pipeline = sharp(effectiveInput)
    }
    const info = await applyQuality(pipeline, targetFormat, quality).toFile(outputPath)
    return {
      outputPath,
      width: info.width,
      height: info.height,
      sizeBytes: info.size,
      durationMs: performance.now() - startedAt
    }
  } finally {
    if (tempDir) {
      await unlink(effectiveInput).catch(() => undefined)
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
