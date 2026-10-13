/**
 * Verificación del motor de conversión de imágenes (Fase 2).
 *
 * Ejecutar: npm run verify:images
 * Genera fixtures con sharp, convierte la matriz de formatos, y comprueba
 * dimensiones, respeto de la calidad y resolución de rutas de salida.
 *
 * Si ImageMagick está disponible (Fase 6) también prueba bmp/ico como
 * destino y bmp/heic como origen; sin él, comprueba la degradación elegante.
 */
import { mkdtemp, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { findBinary } from '../src/main/binaries'
import {
  availableImageTargets,
  convertImage,
  detectImageFormat,
  getImageInfo,
  resolveOutputPath
} from '../src/main/imageConverter'

type Check = { name: string; ok: boolean; detail?: string }
const checks: Check[] = []

function record(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail })
  const mark = ok ? '✓' : '✗'
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** BMP mínimo de 1×1 escrito a mano (BITMAPFILEHEADER + DIB + 1 píxel). */
function makeMinimalBmp(): Buffer {
  const buf = Buffer.alloc(14 + 40 + 4)
  buf.write('BM', 0, 'ascii')
  buf.writeUInt32LE(buf.length, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(1, 18)
  buf.writeInt32LE(1, 22)
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(4, 34)
  return buf
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'uc-images-'))
  console.log(`Directorio temporal: ${dir}\n`)

  try {
    // --- Fixtures -----------------------------------------------------------
    const base = sharp({
      create: { width: 64, height: 48, channels: 4, background: { r: 220, g: 90, b: 40, alpha: 0.8 } }
    })
    const fixturePng = join(dir, 'fixture.png')
    const fixtureJpeg = join(dir, 'fixture.jpg')
    const fixtureWebp = join(dir, 'fixture.webp')
    const fixtureAvif = join(dir, 'fixture.avif')
    const fixtureTiff = join(dir, 'fixture.tiff')
    const fixtureGif = join(dir, 'fixture.gif')
    await base.png().toFile(fixturePng)
    await base.flatten().jpeg({ quality: 90 }).toFile(fixtureJpeg)
    await base.webp({ quality: 90 }).toFile(fixtureWebp)
    await base.avif({ quality: 90 }).toFile(fixtureAvif)
    await base.tiff().toFile(fixtureTiff)
    await base.gif().toFile(fixtureGif)

    // SVG fixture con contenido vectorial real.
    const { writeFile } = await import('fs/promises')
    const fixtureSvg = join(dir, 'fixture.svg')
    await writeFile(
      fixtureSvg,
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="#22d3ee"/><circle cx="50" cy="30" r="18" fill="#0b0f14"/></svg>'
    )

    // BMP mínimo de 1×1 escrito a mano: para probar la degradación sin motor
    // aunque el sistema (libvips con BMP embebido) sepa leer BMP.
    const manualBmp = join(dir, 'manual.bmp')
    await writeFile(manualBmp, makeMinimalBmp())

    // --- Detección de formato ------------------------------------------------
    const detectCases: Array<[string, string | null]> = [
      [fixturePng, 'png'],
      [manualBmp, 'bmp'],
      [fixtureJpeg, 'jpeg'],
      [fixtureWebp, 'webp'],
      [fixtureAvif, 'avif'],
      [fixtureTiff, 'tiff'],
      [fixtureGif, 'gif'],
      [fixtureSvg, 'svg'],
      [join(dir, 'no-existe.xyz'), null]
    ]
    for (const [path, expected] of detectCases) {
      const got = detectImageFormat(path)
      record(`detect ${expected ?? 'desconocido'}`, got === expected, `→ ${got}`)
    }

    // --- getImageInfo --------------------------------------------------------
    const info = await getImageInfo(fixturePng)
    record(
      'info png: 64x48 con alfa',
      info.width === 64 && info.height === 48 && info.hasAlpha,
      `${info.width}x${info.height} alfa=${info.hasAlpha}`
    )

    // --- Matriz de conversión (formatos de la Fase 2) ------------------------
    const raster: Array<[string, 'png' | 'jpeg' | 'webp' | 'avif' | 'tiff' | 'gif']> = [
      [fixturePng, 'jpeg'],
      [fixturePng, 'webp'],
      [fixturePng, 'avif'],
      [fixturePng, 'tiff'],
      [fixturePng, 'gif'],
      [fixtureJpeg, 'png'],
      [fixtureJpeg, 'webp'],
      [fixtureWebp, 'png'],
      [fixtureWebp, 'avif'],
      [fixtureAvif, 'png'],
      [fixtureAvif, 'jpeg'],
      [fixtureTiff, 'png'],
      [fixtureGif, 'png']
    ]
    for (const [inputPath, targetFormat] of raster) {
      try {
        const result = await convertImage({ inputPath, targetFormat, quality: 80 })
        const outStat = await stat(result.outputPath)
        const dimsOk = result.width === 64 && result.height === 48
        const exists = outStat.size > 0
        record(
          `${targetFormat} ← ${detectImageFormat(inputPath)}`,
          dimsOk && exists,
          `${result.width}x${result.height}, ${(outStat.size / 1024).toFixed(1)} KB`
        )
      } catch (error) {
        record(`${targetFormat} ← ${detectImageFormat(inputPath)}`, false, String(error))
      }
    }

    // SVG → PNG (resvg)
    try {
      const result = await convertImage({ inputPath: fixtureSvg, targetFormat: 'png', quality: 90 })
      record('png ← svg (resvg)', result.width === 100 && result.height === 60, `${result.width}x${result.height}`)
    } catch (error) {
      record('png ← svg (resvg)', false, String(error))
    }

    // --- Calidad: menor calidad ⇒ archivo más pequeño ------------------------
    const qLow = await convertImage({ inputPath: fixturePng, targetFormat: 'jpeg', quality: 10 })
    const qHigh = await convertImage({ inputPath: fixturePng, targetFormat: 'jpeg', quality: 95 })
    record(
      'calidad 10 < calidad 95 (jpeg)',
      qLow.sizeBytes < qHigh.sizeBytes,
      `${qLow.sizeBytes} B vs ${qHigh.sizeBytes} B`
    )

    // --- Rutas de salida -----------------------------------------------------
    const outDir = join(dir, 'salida')
    const inSubdir = join(dir, 'origen')
    const { mkdir } = await import('fs/promises')
    await mkdir(outDir)
    await mkdir(inSubdir)
    const nested = join(inSubdir, 'foto.png')
    const { copyFile } = await import('fs/promises')
    await copyFile(fixturePng, nested)

    const defaultPath = await resolveOutputPath(nested, 'webp', null)
    record(
      'salida por defecto junto al origen',
      defaultPath.startsWith(inSubdir) && defaultPath.endsWith('_converted.webp'),
      defaultPath
    )
    const customPath = await resolveOutputPath(nested, 'avif', outDir)
    record('salida a directorio alternativo', customPath.startsWith(outDir), customPath)

    const converted = await convertImage({
      inputPath: nested,
      targetFormat: 'webp',
      quality: 80,
      outputDir: outDir
    })
    record(
      'convertir escribe en directorio alternativo',
      converted.outputPath.startsWith(outDir) && (await stat(converted.outputPath)).size > 0,
      converted.outputPath
    )

    // No pisar archivos: segunda conversión al mismo destino añade numeración.
    const second = await convertImage({
      inputPath: nested,
      targetFormat: 'webp',
      quality: 80,
      outputDir: outDir
    })
    record('evita sobrescribir (numeración)', second.outputPath !== converted.outputPath, second.outputPath)

    // --- Formatos protegidos (degradación elegante) --------------------------
    try {
      await convertImage({ inputPath: fixturePng, targetFormat: 'svg' })
      record('svg como destino rechazado', false)
    } catch {
      record('svg como destino rechazado (limitación documentada)', true)
    }

    // --- Motores externos (Fase 6): bmp/ico como destino, bmp/heic como origen
    const magick = await findBinary('magick')
    const heicFixture = fileURLToPath(new URL('fixtures/sample.heic', import.meta.url))

    if (magick) {
      let bmpFixture: string | null = null
      try {
        const bmp = await convertImage({ inputPath: fixturePng, targetFormat: 'bmp', outputDir: outDir })
        bmpFixture = bmp.outputPath
        const bmpInfo = await getImageInfo(bmpFixture)
        record(
          'bmp ← png (motor)',
          bmpInfo.format === 'bmp' && bmpInfo.width === 64,
          `${bmpInfo.format} ${bmpInfo.width}x${bmpInfo.height}`
        )
      } catch (error) {
        record('bmp ← png (motor)', false, String(error))
      }

      if (bmpFixture) {
        try {
          const back = await convertImage({ inputPath: bmpFixture, targetFormat: 'png', outputDir: outDir })
          record('png ← bmp (motor)', (await stat(back.outputPath)).size > 0, `${back.width}x${back.height}`)
        } catch (error) {
          record('png ← bmp (motor)', false, String(error))
        }
      } else {
        record('png ← bmp (motor)', false, 'sin fixture bmp')
      }

      try {
        const ico = await convertImage({ inputPath: fixturePng, targetFormat: 'ico', outputDir: outDir })
        const icoInfo = await getImageInfo(ico.outputPath)
        record('ico ← png (motor)', icoInfo.format === 'ico', `${icoInfo.width}x${icoInfo.height}`)
      } catch (error) {
        record('ico ← png (motor)', false, String(error))
      }

      try {
        const heicCopy = join(dir, 'muestra.heic')
        await copyFile(heicFixture, heicCopy)
        const heicInfo = await getImageInfo(heicCopy)
        record(
          'info heic (motor)',
          heicInfo.format === 'heic' && heicInfo.width === 451,
          `${heicInfo.format} ${heicInfo.width}x${heicInfo.height}`
        )
        const fromHeic = await convertImage({ inputPath: heicCopy, targetFormat: 'png', outputDir: outDir })
        record('png ← heic (motor)', (await stat(fromHeic.outputPath)).size > 0, `${fromHeic.width}x${fromHeic.height}`)
        const heicTargets = await availableImageTargets(heicCopy)
        record(
          'targets heic con motor: incluye png+bmp',
          heicTargets.includes('png') && heicTargets.includes('bmp'),
          heicTargets.join(',')
        )
      } catch (error) {
        record('heic con motor', false, String(error))
      }

      // Formatos de solo lectura: heic sigue rechazándose como destino.
      try {
        await convertImage({ inputPath: fixturePng, targetFormat: 'heic' })
        record('heic como destino sigue rechazado', false, 'no lanzó error')
      } catch {
        record('heic como destino sigue rechazado', true)
      }

      const withEngine = await availableImageTargets(fixturePng)
      record(
        'targets con motor: bmp+ico',
        withEngine.includes('bmp') && withEngine.includes('ico'),
        withEngine.join(',')
      )
    } else {
      // Sin motor: rechazo con mensaje de guía y sin bmp/ico entre los destinos.
      try {
        await getImageInfo(manualBmp)
        record('info bmp sin motor → guía', false, 'no lanzó error')
      } catch (error) {
        record('info bmp sin motor → guía', String(error).includes('ImageMagick'), String(error))
      }
      try {
        await convertImage({ inputPath: manualBmp, targetFormat: 'png' })
        record('convertir bmp sin motor → guía', false, 'no lanzó error')
      } catch (error) {
        record('convertir bmp sin motor → guía', String(error).includes('ImageMagick'), String(error))
      }
      try {
        await convertImage({ inputPath: fixturePng, targetFormat: 'bmp' })
        record('bmp destino sin motor → rechazado', false, 'no lanzó error')
      } catch (error) {
        record('bmp destino sin motor → rechazado', String(error).includes('ImageMagick'), String(error))
      }
      const withoutEngine = await availableImageTargets(fixturePng)
      record(
        'targets sin motor: sin bmp/ico',
        !withoutEngine.includes('bmp') && !withoutEngine.includes('ico'),
        withoutEngine.join(',')
      )
      // HEIC sin motor: sharp solo lee la cabecera, no decodifica HEVC.
      // La conversión ofrece la guía y la UI no ofrece ningún destino.
      const heicReal = join(dir, 'real.heic')
      await copyFile(fileURLToPath(new URL('fixtures/sample.heic', import.meta.url)), heicReal)
      try {
        await convertImage({ inputPath: heicReal, targetFormat: 'png' })
        record('convertir heic sin motor → guía', false, 'no lanzó error')
      } catch (error) {
        record('convertir heic sin motor → guía', String(error).includes('ImageMagick'), String(error))
      }
      record(
        'targets heic sin motor → vacío (guía en UI)',
        (await availableImageTargets(heicReal)).length === 0
      )
    }
  } finally {
    // Windows puede retener handles de libvips unos ms; reintentamos el borrado.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt === 5) {
          console.error(`Aviso: no se pudo limpiar ${dir}:`, error)
        } else {
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }
    }
  }

  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} comprobaciones OK`)
  if (failed.length > 0) {
    console.error('Fallidas:')
    for (const f of failed) console.error(`  ✗ ${f.name}: ${f.detail ?? ''}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
