import { app } from 'electron'
import { execFile } from 'child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { promisify } from 'util'
import { DOC_EXTENSIONS } from './docConverter'
import type { ContextMenuRequest, ContextMenuSettings } from '../shared/types'

/**
 * Menú contextual del Explorador de Windows.
 *
 * Diseño (v2, simplificado a petición):
 * - UN solo verbo «Convertir con Univert» por archivo compatible (imagen o
 *   documento), sin submenú de formatos: al invocarlo, la app se abre con los
 *   archivos ya cargados y el usuario elige en la interfaz el formato único
 *   o el formato por archivo.
 * - Verbo SIMPLE (clave + `command`), no cascada: verificado empíricamente en
 *   Windows 11 — los verbos simples sí aparecen en `*.ext\shell` (sin
 *   UserChoice), en el ProgId efectivo (con UserChoice) y en
 *   `SystemFileAssociations\image`; las cascadas con hojas NO se llegan a
 *   mostrar, por lo que se evitan por completo.
 * - Alta/baja en `HKCU\Software\Classes` con `reg.exe` + `SHChangeNotify`.
 * - `MultiSelectModel = Player` (hasta 100 archivos seleccionados); Explorer
 *   lanza un proceso por archivo y el main fusiona las invocaciones (§ Fase C).
 *
 * Verificación: `scripts/verify-ctxmenu.ts` (plan puro + round-trip real con
 * reg.exe + parser de argv). El plan se construye SIN depender de motores: la
 * conversión ocurre dentro de la app.
 */

/** Valores por defecto del menú contextual (opt-in). */
const DEFAULTS: ContextMenuSettings = {
  enabled: false
}

let cached: ContextMenuSettings | null = null

/** Directorio de datos sobrescrito para pruebas headless (null = Electron). */
let userDataDirOverride: string | null = null

/**
 * Fija el directorio donde vive `context-menu.json` sin pasar por Electron.
 * Solo para pruebas (p. ej. `scripts/verify-ctxmenu.ts`); la app real nunca
 * lo llama y sigue usando `app.getPath('userData')`.
 */
export function setContextMenuUserDataDir(dir: string | null): void {
  userDataDirOverride = dir
}

/** Ruta del archivo de preferencias en `userData` (patrón de `updater.json`). */
function configPath(): string {
  return join(userDataDirOverride ?? app.getPath('userData'), 'context-menu.json')
}

/** Normaliza cualquier JSON leído: booleanos estrictos. */
function sanitize(raw: unknown): ContextMenuSettings {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    enabled: typeof data.enabled === 'boolean' ? data.enabled : DEFAULTS.enabled
  }
}

function load(): ContextMenuSettings {
  try {
    return sanitize(JSON.parse(readFileSync(configPath(), 'utf8')))
  } catch {
    // Sin archivo (primera ejecución) o ilegible: valores por defecto.
    return { ...DEFAULTS }
  }
}

function persist(settings: ContextMenuSettings): void {
  try {
    mkdirSync(dirname(configPath()), { recursive: true })
    writeFileSync(configPath(), JSON.stringify(settings))
  } catch {
    // Sin acceso a disco la preferencia solo vive en memoria de esta sesión.
  }
}

/** Snapshot actual de los parámetros (copia defensiva). */
export function contextMenuSettings(): ContextMenuSettings {
  if (!cached) cached = load()
  return { ...cached }
}

/**
 * Aplica un parche parcial, persiste y devuelve el estado resultante.
 * Valores inválidos se ignoran campo a campo (nunca tira la llamada IPC).
 */
export function saveContextMenuSettings(patch: Partial<ContextMenuSettings>): ContextMenuSettings {
  const current = contextMenuSettings()
  const clean: Partial<ContextMenuSettings> = {}
  if (typeof patch.enabled === 'boolean') clean.enabled = patch.enabled
  cached = sanitize({ ...current, ...clean })
  persist(cached)
  return { ...cached }
}

// ---------------------------------------------------------------------------
// Registro de las claves en el Explorador (solo Windows empaquetado)
// ---------------------------------------------------------------------------

/** Nombre del verbo; el mismo en imágenes y documentos. */
const VERB_NAME = 'UnivertConvert'

/** Raíz del espacio de clases por usuario (HKCU\Software\Classes fusiona en HKCR). */
const CLASSES = 'HKCU\\Software\\Classes'

const execFileAsync = promisify(execFile)

/** Etiqueta del verbo (MUIVerb), por idioma de la UI. */
const VERB_LABEL: Record<'es' | 'en', string> = {
  es: 'Convertir con Univert',
  en: 'Convert with Univert'
}

/**
 * Extensiones compatibles con la aplicación (con punto): las que la app puede
 * abrir y convertir. `.csv` queda fuera (no tiene destinos de conversión).
 */
export const SUPPORTED_EXTENSIONS: readonly string[] = [
  // Imágenes
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
  '.tif',
  '.tiff',
  '.gif',
  '.bmp',
  '.ico',
  '.heic',
  '.raw',
  '.svg',
  // Documentos
  ...Object.keys(DOC_EXTENSIONS)
].filter((ext, index, all) => all.indexOf(ext) === index && ext !== '.csv')

/** Un valor REG_SZ/REG_DWORD a escribir (`name: ''` = valor por defecto). */
export type RegistryValue = { name: string; data: string; type: 'REG_SZ' | 'REG_DWORD' }

/** Una clave con sus valores (una `reg add` por valor). */
export type RegistryEntry = { key: string; values: RegistryValue[] }

/** Plan completo: lo que se escribe y las raíces que se borran (superconjunto). */
export type RegistryPlan = { entries: RegistryEntry[]; roots: string[] }

export type RegistryPlanOptions = {
  /** Ruta al .exe (`process.execPath` en producción). */
  execPath: string
  /** Nombre del verbo (las pruebas usan uno distinto para no tocar el real). */
  verbName: string
  locale: 'es' | 'en'
  /**
   * Extensiones a cubrir con su ProgId(s) efectivo(s):
   * - `ext`: extensión con punto (`.pdf`).
   * - `progIds`: ProgIds bajo los que también se escribe el verbo (UserChoice
   *   y/o ProgId por defecto). Con UserChoice, Explorer IGNORA
   *   `\<ext>\shell` y solo lee el ProgId (verificado empíricamente).
   */
  targets: { ext: string; progIds: string[] }[]
}

/**
 * Entrada del menú: verbo SIMPLE con `command` directo (nunca cascada).
 * `ExtendedSubCommandsKey`/hojas se eliminaron: no se muestran en Win11.
 */
function verbEntry(key: string, options: RegistryPlanOptions): RegistryEntry[] {
  const exe = `"${options.execPath}"`
  return [
    {
      key,
      values: [
        { name: '', data: '', type: 'REG_SZ' },
        { name: 'MUIVerb', data: VERB_LABEL[options.locale], type: 'REG_SZ' },
        { name: 'Icon', data: `${options.execPath},0`, type: 'REG_SZ' },
        // Selección múltiple (hasta 100 ítems con verbos legacy).
        { name: 'MultiSelectModel', data: 'Player', type: 'REG_SZ' }
      ]
    },
    {
      key: `${key}\\command`,
      values: [{ name: '', data: `${exe} --ctx convert "%1"`, type: 'REG_SZ' }]
    }
  ]
}

/**
 * Raíces de borrado (superconjunto fijo + ProgIds dados): la imagen se borra
 * siempre; las extensiones son fijas; los ProgIds dependen de la asociación
 * vigente del usuario y se pasan por parámetro.
 */
export function registryRoots(verbName = VERB_NAME, progIds: string[] = []): string[] {
  return [
    `${CLASSES}\\SystemFileAssociations\\image\\shell\\${verbName}`,
    `${CLASSES}\\${verbName}`,
    ...SUPPORTED_EXTENSIONS.map((ext) => `${CLASSES}\\${ext}\\shell\\${verbName}`),
    ...progIds.map((progId) => `${CLASSES}\\${progId}\\shell\\${verbName}`)
  ]
}

/**
 * Construye el plan de registro (puro, sin I/O): el verbo en el tipo
 * percibido `image` (cubre todas las extensiones de imagen, aunque tengan
 * UserChoice) y en cada extensión compatible + su ProgId efectivo.
 */
export function buildRegistryPlan(options: RegistryPlanOptions): RegistryPlan {
  const seen = new Set<string>()
  const entries: RegistryEntry[] = []
  const push = (key: string): void => {
    if (seen.has(key)) return
    seen.add(key)
    entries.push(...verbEntry(key, options))
  }

  // Imágenes por tipo percibido (una sola clave para todas).
  push(`${CLASSES}\\SystemFileAssociations\\image\\shell\\${options.verbName}`)
  for (const target of options.targets) {
    push(`${CLASSES}\\${target.ext}\\shell\\${options.verbName}`)
    for (const progId of target.progIds) {
      push(`${CLASSES}\\${progId}\\shell\\${options.verbName}`)
    }
  }

  const progIds = [...new Set(options.targets.flatMap((target) => target.progIds))]
  return { entries, roots: registryRoots(options.verbName, progIds) }
}

async function reg(args: string[]): Promise<void> {
  await execFileAsync('reg', args)
}

/** Valor REG_SZ de una clave/valor, o null si no existe. */
async function regQueryValue(key: string, valueName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', key, '/v', valueName])
    const line = stdout
      .split(/\r?\n/)
      .find((l) => new RegExp(`^\\s*${valueName}\\s+REG_SZ\\s+(.*)$`, 'i').test(l))
    if (!line) return null
    const data = line.replace(new RegExp(`^\\s*${valueName}\\s+REG_SZ\\s+`, 'i'), '').trim()
    return !data || data === '(value not set)' ? null : data
  } catch {
    return null
  }
}

/** Valor por defecto (REG_SZ) de una clave, o null si no existe. */
async function regQueryDefault(key: string): Promise<string | null> {
  return regQueryValue(key, '(Default)')
}

/**
 * Resuelve qué ProgIds debe cubrir el verbo para cada extensión:
 * el UserChoice del usuario (asociación elegida en Configuración de archivos)
 * y el ProgId por defecto de la extensión. Deduplicado entre extensiones.
 */
async function resolveTargets(): Promise<RegistryPlanOptions['targets']> {
  const results = await Promise.all(
    SUPPORTED_EXTENSIONS.map(async (ext): Promise<RegistryPlanOptions['targets'][number]> => {
      const userChoice = await regQueryValue(
        `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice`,
        'ProgId'
      )
      const defaultProgId = await regQueryDefault(`HKCR\\${ext}`)
      const progIds = [userChoice, defaultProgId].filter(
        (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index
      )
      return { ext, progIds }
    })
  )
  return results
}

/** SHChangeNotify(SHCNE_ASSOCCHANGED): Explorer recarga los menús sin reiniciar. */
async function notifyExplorer(): Promise<void> {
  const script =
    "Add-Type -Namespace Univert -Name ShellNotify -MemberDefinition " +
    "'[DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);'; " +
    '[Univert.ShellNotify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)'
  try {
    await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script])
  } catch {
    // Sin PowerShell el menú se recarga igual con F5 o al reabrir la sesión.
  }
}

/**
 * Escribe el plan: limpia antes las raíces (reescritura idempotente: una
 * extensión que pierde su UserChoice no deja claves huérfanas) y luego añade.
 * Un fallo en cualquier `reg add` rechaza la promesa para que el caller
 * revierta los ajustes.
 */
export async function applyRegistryPlan(plan: RegistryPlan): Promise<void> {
  for (const root of plan.roots) {
    try {
      await reg(['delete', root, '/f'])
    } catch {
      // Raíz inexistente (alta inicial o extensión descatalogada): se ignora.
    }
  }
  for (const entry of plan.entries) {
    for (const value of entry.values) {
      const args = ['add', entry.key]
      args.push(value.name === '' ? '/ve' : '/v', ...(value.name === '' ? [] : [value.name]))
      args.push('/t', value.type)
      if (value.data !== '') args.push('/d', value.data)
      args.push('/f')
      await reg(args)
    }
  }
}

/** ¿Hay claves dadas de alta? (comprueba la rama de imágenes). */
export async function isContextMenuRegistered(): Promise<boolean> {
  if (env().platform !== 'win32') return false
  try {
    await reg(['query', registryRoots(env().verbName)[0]])
    return true
  } catch {
    return false
  }
}

/** Registra el verbo en todas las extensiones compatibles y avisa a Explorer. */
export async function registerContextMenu(_settings: ContextMenuSettings): Promise<void> {
  const e = env()
  // El registro apunta a process.execPath: solo Windows empaquetado.
  if (e.platform !== 'win32' || !e.packaged) return
  const plan = buildRegistryPlan({
    execPath: e.execPath,
    verbName: e.verbName,
    locale: e.locale,
    targets: await resolveTargets()
  })
  await applyRegistryPlan(plan)
  await notifyExplorer()
}

/** Borra todas las claves (extensiones + ProgIds vigentes) y avisa a Explorer. */
export async function unregisterContextMenu(): Promise<void> {
  const e = env()
  if (e.platform !== 'win32' || !e.packaged) return
  // Nada que borra: evita el spawn de PowerShell en cada arranque.
  if (!(await isContextMenuRegistered())) return
  const targets = await resolveTargets()
  const progIds = targets.flatMap((target) => target.progIds)
  for (const root of registryRoots(e.verbName, progIds)) {
    try {
      await reg(['delete', root, '/f'])
    } catch {
      // Rama inexistente: el borrado es idempotente.
    }
  }
  await notifyExplorer()
}

/** Cola interna: dos syncs (arranque + cambio de idioma) no se pisan. */
let syncChain: Promise<void> = Promise.resolve()

/**
 * Escribe o borra las claves según `settings.enabled`; idempotente y avisa a
 * Explorer. En fuera de Windows o en desarrollo no hace nada (los verbos
 * solo se registran sobre el ejecutable empaquetado).
 */
export function syncContextMenu(settings: ContextMenuSettings): Promise<void> {
  const task = async (): Promise<void> => {
    if (settings.enabled) await registerContextMenu(settings)
    else await unregisterContextMenu()
  }
  const run = syncChain.then(task, task)
  syncChain = run.catch(() => undefined)
  return run
}

// ---------------------------------------------------------------------------
// Parseo de la línea de comandos del menú contextual (puro)
// ---------------------------------------------------------------------------

/**
 * Extrae la petición `--ctx convert <rutas…>` del argv.
 *
 * Tolerante al reordenamiento de Windows: en `second-instance` Chromium
 * reagrupa los `--flags` al principio y deja los tokens posicionales al
 * final en su orden original (verificado con un probe en Electron 44), así
 * que la acción no se exige contigua a `--ctx`. También entiende los comandos
 * antiguos con `--kind`/`--format` (se ignoran) y filtra valores que no son
 * rutas. Devuelve null si no hay petición o no hay rutas: un argv parcial se
 * ignora sin romper el arranque.
 */
export function parseContextArgv(argv: string[]): ContextMenuRequest | null {
  const at = argv.indexOf('--ctx')
  if (at === -1) return null
  const positional: string[] = []
  for (let i = at + 1; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--kind' || token === '--format') {
      i += 1 // valor del flag legado (si viene contiguo)
      continue
    }
    if (token.startsWith('--')) continue
    positional.push(token)
  }
  const actionAt = positional.findIndex((token) => token === 'convert' || token === 'batch')
  if (actionAt === -1) return null
  // `batch` legado (antiguo submenú) abre la app con los mismos archivos.
  // Filtro de "parece ruta": descarta restos de comandos antiguos (p. ej.
  // `imagenes`, `webp`) que llegaron como tokens posicionales.
  const paths = positional.slice(actionAt + 1).filter((token) => /[\\/]/.test(token))
  if (paths.length === 0) return null
  return { action: 'convert', paths }
}

/** Entorno de registro sobrescribible para pruebas headless (null = real). */
export type ContextMenuEnv = {
  execPath: string
  packaged: boolean
  platform: NodeJS.Platform
  locale: 'es' | 'en'
  verbName: string
}

let envOverride: Partial<ContextMenuEnv> | null = null
/** Idioma de la UI para los MUIVerb (null = derivar de Electron). */
let uiLocale: 'es' | 'en' | null = null

/** Fija el entorno de registro para pruebas (p. ej. `scripts/verify-ctxmenu.ts`). */
export function setContextMenuEnv(overrides: Partial<ContextMenuEnv> | null): void {
  envOverride = overrides
}

/** Fija el idioma de los MUIVerb; devuelve true si respecto al actual cambia. */
export function setContextMenuLocale(next: 'es' | 'en'): boolean {
  const changed = env().locale !== next
  uiLocale = next
  return changed
}

/** Idioma por defecto fuera de la UI: el del sistema (patrón de dialogLocale). */
function defaultLocale(): 'es' | 'en' {
  try {
    const electronApp = app as unknown as { getLocale?: () => string } | undefined
    const value = electronApp?.getLocale?.() ?? ''
    return value.toLowerCase().startsWith('es') ? 'es' : 'en'
  } catch {
    return 'es'
  }
}

function env(): ContextMenuEnv {
  const electronApp = app as unknown as { isPackaged?: boolean } | undefined
  return {
    execPath: envOverride?.execPath ?? process.execPath,
    packaged: envOverride?.packaged ?? electronApp?.isPackaged ?? false,
    platform: envOverride?.platform ?? process.platform,
    locale: envOverride?.locale ?? uiLocale ?? defaultLocale(),
    verbName: envOverride?.verbName ?? VERB_NAME
  }
}
