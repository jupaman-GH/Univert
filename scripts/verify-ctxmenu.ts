/**
 * verify-ctxmenu — Verificación del menú contextual del Explorador (v2).
 *
 * Diseño verificado: UN verbo SIMPLE «Convertir con Univert» por archivo
 * compatible (imagen o documento). La app se abre con los archivos cargados y
 * el formato se elige en la interfaz (no hay submenús: las cascadas con hojas
 * no se muestran en Windows 11 — comprobado empíricamente).
 *
 * Fase A: saneado de parámetros y persistencia en disco de
 * `userData/context-menu.json`, usando la costura `setContextMenuUserDataDir`
 * (headless, sin Electron).
 *
 * Fase B:
 *  1. Construcción PURA del plan (`buildRegistryPlan`): verbo en el tipo
 *     percibido `image`, en cada extensión compatible y en su ProgId
 *     efectivo; comando con `%1`; raíces de borrado.
 *  2. Round-trip REAL con `reg.exe` (alta → `reg query` → re-sync → baja)
 *     usando un verbo de prueba (`UnivertConvertVerify`) para no tocar el
 *     registro real del usuario. Solo en Windows; en otros SO se omite.
 *
 * Fase C: parser de argv `--ctx`, tolerante al reordenamiento de Windows
 * (second-instance agrupa los `--flags` al principio).
 *
 * Ejecutar: npm run verify:ctxmenu
 */
import { createRequire } from 'module'
import { execFile } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import type { RegistryPlan } from '../src/main/contextMenu'

const execFileAsync = promisify(execFile)
const req = createRequire(join(process.cwd(), 'package.json'))
const ctxPath = join(process.cwd(), 'src', 'main', 'contextMenu.ts')

const failures: string[] = []
function expect(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`)
  if (!ok) {
    console.log(`     esperado: ${JSON.stringify(expected)}`)
    failures.push(name)
  }
}
function expectTrue(name: string, condition: boolean, detail?: unknown): void {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}`)
  if (!condition) {
    if (detail !== undefined) console.log(`     detalle: ${JSON.stringify(detail)}`)
    failures.push(name)
  }
}

/** Ejecuta `reg` y captura la salida aunque falle (clave inexistente = exit 1). */
async function regRaw(args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('reg', args)
    return { ok: true, out: `${stdout}${stderr}` }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string }
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/** Valor por defecto (REG_SZ) de una clave, o null si no existe. */
async function regDefault(key: string): Promise<string | null> {
  const result = await regRaw(['query', key, '/ve'])
  if (!result.ok) return null
  const line = result.out.split(/\r?\n/).find((l) => /^\s*\(Default\)\s+REG_SZ\s/.test(l))
  return line ? line.replace(/^\s*\(Default\)\s+REG_SZ\s+/, '') : null
}

function entryOf(plan: RegistryPlan, key: string): RegistryPlan['entries'][number] | undefined {
  return plan.entries.find((e) => e.key === key)
}

async function main(): Promise<void> {
  // ==========================================================================
  // Fase A — parámetros y persistencia
  // ==========================================================================

  // Vida 1 del "proceso": directorio temporal inyectado.
  const userdata = mkdtempSync(join(tmpdir(), 'uc-ctx-'))
  const first = req(ctxPath) as typeof import('../src/main/contextMenu')
  first.setContextMenuUserDataDir(userdata)

  expect('defaults', first.contextMenuSettings(), { enabled: false })

  expect('patch habilita', first.saveContextMenuSettings({ enabled: true }), { enabled: true })

  expect(
    'campos desconocidos ignorados (calidad/lote legados)',
    first.saveContextMenuSettings({ quality: 250, showBatch: false } as never),
    { enabled: true }
  )

  expect(
    'tipos inválidos ignorados',
    first.saveContextMenuSettings({ enabled: 'yes' as never }),
    { enabled: true }
  )

  expect('on disk', JSON.parse(readFileSync(join(userdata, 'context-menu.json'), 'utf8')), {
    enabled: true
  })

  const snapshot = first.contextMenuSettings()
  snapshot.enabled = false
  expect('defensive copy', first.contextMenuSettings().enabled, true)

  // Vida 2 del "proceso" (reinicio simulado): módulo nuevo, relee del mismo disco.
  delete req.cache[ctxPath]
  const second = req(ctxPath) as typeof import('../src/main/contextMenu')
  second.setContextMenuUserDataDir(userdata)
  expect('survives restart (re-read)', second.contextMenuSettings(), { enabled: true })

  rmSync(userdata, { recursive: true, force: true })

  // ==========================================================================
  // Fase B1 — construcción pura del plan
  // ==========================================================================
  console.log('\n--- Fase B: plan de registro (puro) ---')

  const REG = 'HKCU\\Software\\Classes'
  const VERB = 'UnivertConvertVerify'
  const EXE = 'C:\\Fake\\Universal Converter\\uc.exe' // con espacios: ejercita el quoting
  const imageVerbKey = `${REG}\\SystemFileAssociations\\image\\shell\\${VERB}`

  // Lista soportada: imágenes + documentos, sin .csv (sin destinos).
  expectTrue(
    'extensiones soportadas: imágenes y documentos',
    ['.png', '.jpg', '.svg', '.pdf', '.docx', '.md', '.html', '.epub'].every((ext) =>
      second.SUPPORTED_EXTENSIONS.includes(ext)
    ),
    second.SUPPORTED_EXTENSIONS
  )
  expectTrue('csv fuera de la lista', !second.SUPPORTED_EXTENSIONS.includes('.csv'))

  const targets = [
    { ext: '.pdf', progIds: ['Acro.Prog'] },
    { ext: '.md', progIds: [] },
    { ext: '.md', progIds: [] }, // duplicado: se deduplica por clave
    { ext: '.txt', progIds: ['AppX123', 'Acro.Prog'] } // Acro.Prog repetido entre exts
  ]
  const plan = second.buildRegistryPlan({ execPath: EXE, verbName: VERB, locale: 'es', targets })

  expect(
    'raíces de borrado (imagen + verbos raíz + extensiones + ProgIds)',
    second.registryRoots(VERB, ['Acro.Prog', 'AppX123']),
    [
      imageVerbKey,
      `${REG}\\${VERB}`,
      ...second.SUPPORTED_EXTENSIONS.map((ext) => `${REG}\\${ext}\\shell\\${VERB}`),
      `${REG}\\Acro.Prog\\shell\\${VERB}`,
      `${REG}\\AppX123\\shell\\${VERB}`
    ]
  )

  expect('verbo de imágenes (MUIVerb + Icon + MultiSelectModel)', entryOf(plan, imageVerbKey)?.values, [
    { name: '', data: '', type: 'REG_SZ' },
    { name: 'MUIVerb', data: 'Convertir con Univert', type: 'REG_SZ' },
    { name: 'Icon', data: `${EXE},0`, type: 'REG_SZ' },
    { name: 'MultiSelectModel', data: 'Player', type: 'REG_SZ' }
  ])

  expect('comando (comillas + %1, sin submenús)', entryOf(plan, `${imageVerbKey}\\command`)?.values, [
    { name: '', data: `"${EXE}" --ctx convert "%1"`, type: 'REG_SZ' }
  ])

  expectTrue(
    'sin ExtendedSubCommandsKey (nada de cascadas)',
    !plan.entries.some((e) => e.values.some((v) => v.name === 'ExtendedSubCommandsKey'))
  )
  expectTrue('sin hojas de formato ni 90-batch', !plan.entries.some((e) => e.key.includes('90-batch')))
  expectTrue(
    'sin hojas numeradas (01-…)',
    !plan.entries.some((e) => /\\(0[0-9]-|90-)/.test(e.key))
  )

  expectTrue(
    'verbo en la extensión .md',
    entryOf(plan, `${REG}\\.md\\shell\\${VERB}`)?.values.some(
      (v) => v.name === 'MUIVerb' && v.data === 'Convertir con Univert'
    )
  )
  expectTrue(
    'verbo en el ProgId efectivo (Acro.Prog)',
    Boolean(entryOf(plan, `${REG}\\Acro.Prog\\shell\\${VERB}`))
  )
  expectTrue(
    'verbo en el ProgId AppX',
    Boolean(entryOf(plan, `${REG}\\AppX123\\shell\\${VERB}`))
  )
  expect(
    'ProgId repetido entre extensiones → una sola entrada',
    plan.entries.filter((e) => e.key === `${REG}\\Acro.Prog\\shell\\${VERB}`).length,
    1
  )
  expect(
    'raíces con ProgIds deduplicados',
    plan.roots.filter((r) => r.endsWith(`Acro.Prog\\shell\\${VERB}`)).length,
    1
  )

  const en = second.buildRegistryPlan({ execPath: EXE, verbName: VERB, locale: 'en', targets })
  expect(
    'MUIVerb en inglés',
    entryOf(en, imageVerbKey)?.values.find((v) => v.name === 'MUIVerb')?.data,
    'Convert with Univert'
  )

  // ==========================================================================
  // Fase C — parseo del argv del menú contextual (puro)
  // ==========================================================================
  console.log('\n--- Fase C: parser de argv --ctx (puro) ---')

  expect(
    'parse: convert con ruta con espacios',
    second.parseContextArgv([
      'C:\\App\\Univert.exe',
      '--ctx',
      'convert',
      'C:\\Users\\Uno\\Mis imágenes\\foto final.png'
    ]),
    { action: 'convert', paths: ['C:\\Users\\Uno\\Mis imágenes\\foto final.png'] }
  )
  expect(
    'parse: argv REORDENADO de second-instance (flags agrupados + restos legados)',
    second.parseContextArgv([
      'C:\\App\\Univert.exe',
      '--ctx',
      '--kind',
      '--format',
      '--allow-file-access-from-files',
      'script.js',
      'convert',
      'imagenes',
      'webp',
      'C:\\Users\\Uno\\foto final.webp'
    ]),
    { action: 'convert', paths: ['C:\\Users\\Uno\\foto final.webp'] }
  )
  expect(
    'parse: comando antiguo con --kind/--format se entiende',
    second.parseContextArgv([
      'app.exe',
      '--ctx',
      'convert',
      '--kind',
      'documentos',
      '--format',
      'docx',
      'C:\\docs\\a.pdf',
      'C:\\docs\\b.docx'
    ]),
    { action: 'convert', paths: ['C:\\docs\\a.pdf', 'C:\\docs\\b.docx'] }
  )
  expect(
    'parse: lote legado abre la app con sus archivos',
    second.parseContextArgv(['app.exe', '--ctx', 'batch', '--kind', 'imagenes', 'C:\\x\\y.png']),
    { action: 'convert', paths: ['C:\\x\\y.png'] }
  )
  expect('parse: sin --ctx → null', second.parseContextArgv(['app.exe', 'C:\\x.png']), null)
  expect('parse: --ctx sin acción → null', second.parseContextArgv(['app.exe', '--ctx']), null)
  expect(
    'parse: --ctx sin rutas → null',
    second.parseContextArgv(['app.exe', '--ctx', 'convert']),
    null
  )
  expect(
    'parse: --ctx-activate NO es una petición',
    second.parseContextArgv(['app.exe', '--ctx-activate']),
    null
  )

  // ==========================================================================
  // Fase B2 — round-trip real con reg.exe (solo Windows)
  // ==========================================================================
  if (process.platform !== 'win32') {
    console.log('\nSKIP round-trip con reg.exe (solo Windows)')
  } else {
    console.log('\n--- Fase B: round-trip real con reg.exe (verbo de prueba) ---')
    second.setContextMenuEnv({ packaged: true, verbName: VERB, execPath: EXE, locale: 'es' })
    try {
      await second.registerContextMenu({ enabled: true })
      expectTrue('alta: isContextMenuRegistered', await second.isContextMenuRegistered())
      expectTrue('alta: rama de imágenes dada de alta', (await regRaw(['query', imageVerbKey])).ok)
      expectTrue(
        'alta: extensión .md dada de alta',
        (await regRaw(['query', `${REG}\\.md\\shell\\${VERB}`])).ok
      )
      expect(
        'alta: round-trip de comillas del comando en reg',
        await regDefault(`${imageVerbKey}\\command`),
        `"${EXE}" --ctx convert "%1"`
      )

      // Re-sync en caliente (idempotente).
      await second.syncContextMenu({ enabled: true })
      expectTrue('re-sync: sigue registrado', await second.isContextMenuRegistered())

      // Baja desde Ajustes.
      await second.syncContextMenu({ enabled: false })
      expectTrue('baja: no registrado', !(await second.isContextMenuRegistered()))
      const leftovers: string[] = []
      for (const root of second.registryRoots(VERB)) {
        if ((await regRaw(['query', root])).ok) leftovers.push(root)
      }
      expectTrue('baja: sin claves de prueba restantes', leftovers.length === 0, leftovers)

      // Guardia de desarrollo: fuera de build empaquetado no registra.
      second.setContextMenuEnv({ packaged: false, verbName: VERB, execPath: EXE, locale: 'es' })
      await second.syncContextMenu({ enabled: true })
      expectTrue(
        'guardia dev: no registra fuera de build empaquetado',
        !(await second.isContextMenuRegistered())
      )
    } finally {
      // Limpieza garantizada: jamás dejar claves de prueba en el registro.
      second.setContextMenuEnv({ packaged: true, verbName: VERB, execPath: EXE, locale: 'es' })
      await second.unregisterContextMenu().catch(() => undefined)
      second.setContextMenuEnv(null)
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} comprobaciones fallidas`)
    process.exit(1)
  }
  console.log(
    '\nverify-ctxmenu: parámetros, plan del verbo simple, alta/baja en caliente y argv del menú verificados'
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
