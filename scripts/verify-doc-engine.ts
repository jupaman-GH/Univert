/**
 * Verificación del motor de documentos (Fase 4).
 * Ejecutar: npm run verify:docs
 * Prueba las operaciones PDF con pdf-lib (JS puro, sin binarios) y comprueba que
 * las conversiones que requieren binarios emiten MOTOR_MISSING cuando faltan.
 */
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PDFDocument } from 'pdf-lib'
import { convertDocument, detectDocumentFormat, isDocumentFile } from '../src/main/docConverter'

type Check = { name: string; ok: boolean; detail?: string }
const checks: Check[] = []
function record(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function makePdf(path: string, pages: number): Promise<void> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i += 1) doc.addPage([595, 842])
  const bytes = await doc.save()
  const { writeFile } = await import('fs/promises')
  await writeFile(path, bytes)
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'uc-docs-'))
  console.log(`Directorio temporal: ${dir}\n`)

  try {
    // Detección
    record('detect .md', detectDocumentFormat('a.md') === 'md')
    record('detect .docx', detectDocumentFormat('a.docx') === 'docx')
    record('detect .pdf', detectDocumentFormat('a.pdf') === 'pdf')
    record('detect .xyz → null', detectDocumentFormat('a.xyz') === null)
    record('isDocumentFile .txt', isDocumentFile('a.txt'))
    record('isDocumentFile .png → falso', !isDocumentFile('a.png'))

    // pdf-lib: crear y leer
    const pdfA = join(dir, 'a.pdf')
    const pdfB = join(dir, 'b.pdf')
    await makePdf(pdfA, 3)
    await makePdf(pdfB, 2)

    const { mergePdfs, splitPdf } = await import('../src/main/docConverter')
    const mergedPath = join(dir, 'merged.pdf')
    const mergeResult = await mergePdfs([pdfA, pdfB], mergedPath)
    const mergedDoc = await PDFDocument.load(await readFile(mergedPath))
    record('unir PDFs: 3+2 = 5 páginas', mergedDoc.getPageCount() === 5, `${mergeResult.sizeBytes} B`)

    // split
    const splitDir = join(dir, 'split')
    const { mkdir } = await import('fs/promises')
    await mkdir(splitDir)
    const parts = await splitPdf(pdfA, splitDir)
    record('partir PDF: 3 archivos', parts.length === 3, parts.map((p) => p.outputPath.split(/[\\/]/).pop()).join(', '))
    for (const part of parts) {
      const s = await stat(part.outputPath)
      if (s.size <= 0) record(`parte válida ${part.outputPath}`, false)
    }

    // Motor de conversiones con binario ausente → MOTOR_MISSING (degradación elegante)
    try {
      await convertDocument({ inputPath: join(dir, 'a.md'), targetFormat: 'docx' })
      // Si pandoc está instalado en esta máquina, la conversión puede funcionar; lo registramos.
      record('md→docx (pandoc presente o MOTOR_MISSING)', true, 'pandoc detectado en el sistema')
    } catch (error) {
      const msg = String(error)
      record(
        'md→docx sin pandoc → MOTOR_MISSING',
        msg.includes('MOTOR_MISSING'),
        msg.slice(0, 60)
      )
    }

    // pdf → png sin ghostscript → MOTOR_MISSING
    try {
      await convertDocument({ inputPath: pdfA, targetFormat: 'png' })
      record('pdf→png (ghostscript presente)', true)
    } catch (error) {
      const msg = String(error)
      record('pdf→png sin gs → MOTOR_MISSING', msg.includes('MOTOR_MISSING'), msg.slice(0, 60))
    }
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
