/**
 * Verificación del procesador de lotes (Fase 5).
 * Ejecutar: npm run verify:batch
 * Ejecuta lotes reales de imágenes en las dos modalidades, comprueba que todos los
 * archivos se convierten, y valida la cancelación cooperativa.
 */
import { mkdtemp, rm, writeFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { runBatch, isBatchRunning, cancelBatch } from '../src/main/batchProcessor'

type Check = { name: string; ok: boolean; detail?: string }
const checks: Check[] = []
function record(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function makeFixtures(dir: string, count: number): Promise<string[]> {
  const paths: string[] = []
  for (let i = 0; i < count; i += 1) {
    const p = join(dir, `img${i}.png`)
    await sharp({
      create: { width: 32, height: 32, channels: 4, background: { r: i * 8, g: 120, b: 200, alpha: 1 } }
    })
      .png()
      .toFile(p)
    paths.push(p)
  }
  return paths
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'uc-batch-'))
  const outDir = join(dir, 'out')
  const { mkdir } = await import('fs/promises')
  await mkdir(outDir)
  console.log(`Directorio temporal: ${dir}\n`)

  try {
    // --- Modalidad 1: un mismo formato para todos ---------------------------
    const filesA = await makeFixtures(dir, 12)
    const summaryA = await runBatch({
      kind: 'imagenes',
      mode: 'single-format',
      items: filesA.map((f) => ({ inputPath: f })),
      targetFormat: 'webp',
      quality: 85,
      outputDir: outDir
    })
    record(
      'lote single-format: 12/12 convertidos',
      summaryA.succeeded === 12 && summaryA.failed === 0,
      `${summaryA.succeeded}/${summaryA.total}`
    )
    let outputsExist = true
    for (let i = 0; i < 12; i += 1) {
      const candidate = join(outDir, `img${i}_converted.webp`)
      try {
        const s = await stat(candidate)
        if (s.size <= 0) outputsExist = false
      } catch {
        outputsExist = false
      }
    }
    record('single-format: todos los .webp escritos', outputsExist)
    record('lote terminado (no sigue corriendo)', !isBatchRunning())

    // --- Modalidad 2: formato por archivo ------------------------------------
    const filesB = await makeFixtures(dir, 6)
    const perFile: Record<string, string> = {}
    filesB.forEach((f, i) => {
      perFile[f] = i % 2 === 0 ? 'jpeg' : 'avif'
    })
    const outDir2 = join(dir, 'out2')
    await mkdir(outDir2)
    const summaryB = await runBatch({
      kind: 'imagenes',
      mode: 'per-file',
      items: filesB.map((f) => ({ inputPath: f, targetFormat: perFile[f] as never })),
      outputDir: outDir2
    })
    record(
      'lote per-file: 6/6 convertidos',
      summaryB.succeeded === 6 && summaryB.failed === 0,
      `${summaryB.succeeded}/${summaryB.total}`
    )
    // Comprobar que la mitad son jpeg y la mitad avif.
    let correctMix = true
    for (let i = 0; i < 6; i += 1) {
      const ext = i % 2 === 0 ? 'jpg' : 'avif'
      try {
        await stat(join(outDir2, `img${i}_converted.${ext}`))
      } catch {
        correctMix = false
      }
    }
    record('per-file: formatos individuales respetados', correctMix)

    // --- Cancelación cooperativa ---------------------------------------------
    const filesC = await makeFixtures(dir, 24)
    const outDir3 = join(dir, 'out3')
    await mkdir(outDir3)
    // Cancelamos casi de inmediato; el lote debe terminar con menos de 24 éxito.
    setTimeout(() => cancelBatch(), 30)
    const summaryC = await runBatch({
      kind: 'imagenes',
      mode: 'single-format',
      items: filesC.map((f) => ({ inputPath: f })),
      targetFormat: 'tiff',
      outputDir: outDir3
    })
    record(
      'cancelación detiene la cola (<24 convertidos)',
      summaryC.succeeded < summaryC.total,
      `${summaryC.succeeded}/${summaryC.total}`
    )
    record('tras cancelar no sigue corriendo', !isBatchRunning())

    // --- Protección: no dos lotes a la vez ------------------------------------
    const p = runBatch({
      kind: 'imagenes',
      mode: 'single-format',
      items: filesB.map((f) => ({ inputPath: f })),
      targetFormat: 'png',
      outputDir: outDir
    })
    let rejected = false
    try {
      await runBatch({
        kind: 'imagenes',
        mode: 'single-format',
        items: filesB.map((f) => ({ inputPath: f })),
        targetFormat: 'png',
        outputDir: outDir
      })
    } catch {
      rejected = true
    }
    await p
    record('segundo lote simultáneo rechazado', rejected)
  } finally {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true })
        break
      } catch {
        if (attempt === 5) console.error(`Aviso: no se pudo limpiar ${dir}`)
        else await new Promise((r) => setTimeout(r, 200))
      }
    }
  }

  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} comprobaciones OK`)
  if (failed.length > 0) {
    for (const f of failed) console.error(`  ✗ ${f.name}: ${f.detail ?? ''}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
