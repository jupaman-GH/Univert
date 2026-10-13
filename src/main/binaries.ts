import { access, readdir } from 'fs/promises'
import { join, sep } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as electron from 'electron'

const execFileAsync = promisify(execFile)

/**
 * Descubrimiento de binarios externos (Fases 4/6/7).
 *
 * Busca cada herramienta primero en `resources/bin` (empaquetada con la app),
 * luego en el PATH del sistema. Si no la encuentra, devuelve `null` y la UI
 * degrada elegantemente ocultando los formatos que dependen de ella.
 */

// Los binarios empaquetados quedan en resources/bin (ver electron-builder.yml).
// Fuera de Electron (scripts de verificación) no hay `app`; usamos cwd.
const app = (electron as { app?: { isPackaged: boolean } }).app
const APP_ROOT =
  app?.isPackaged && typeof process.resourcesPath === 'string'
    ? join(process.resourcesPath, 'bin')
    : join(process.cwd(), 'resources', 'bin')

/** Ejecutables por plataforma para una herramienta dada. */
const EXECUTABLE_NAMES: Record<string, string[]> = {
  pandoc: process.platform === 'win32' ? ['pandoc.exe', 'pandoc'] : ['pandoc'],
  magick: process.platform === 'win32' ? ['magick.exe', 'magick'] : ['magick'],
  gs: process.platform === 'win32' ? ['gswin64c.exe', 'gswin32c.exe', 'gs'] : ['gs'],
  soffice: process.platform === 'win32' ? ['soffice.exe', 'soffice'] : ['soffice']
}

/** Rutas conocidas de instalaciones habituales (solo informativas, se intentan tras PATH). */
const COMMON_INSTALL_PATHS: Record<string, string[]> = {
  pandoc: [],
  magick: process.platform === 'win32'
    ? ['C:/Program Files/ImageMagick-7.1-Q16-HDRI/magick.exe']
    : [],
  gs: process.platform === 'win32'
    ? ['C:/Program Files/gs/gs10.04.0/bin/gswin64c.exe']
    : [],
  soffice: process.platform === 'win32'
    ? ['C:/Program Files/LibreOffice/program/soffice.exe']
    : ['/usr/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice']
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Escaneo limitado de subcarpetas de `resources/bin`.
 *
 * Las dependencias "portable" suelen extraerse en su propia subcarpeta (p. ej.
 * `gs/bin/gswin64c.exe` o `pandoc/pandoc.exe`), no en la raíz. Buscamos el
 * ejecutable recorriendo un árbol poco profundo para encontrarlo sin importar
 * la carpeta concreta que use cada distribución.
 */
const MAX_SCAN_DEPTH = 3

async function findBinaryInSubdirs(root: string, names: string[]): Promise<string | null> {
  let level = [root]
  for (let depth = 0; depth <= MAX_SCAN_DEPTH; depth++) {
    const next: string[] = []
    for (const dir of level) {
      for (const name of names) {
        const candidate = join(dir, name)
        if (await exists(candidate)) return candidate
      }
      let entries: import('fs').Dirent[] = []
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.isDirectory()) next.push(join(dir, entry.name))
      }
    }
    level = next
  }
  return null
}

/** Raíz donde viven los binarios (resources/bin); la usa el instalador de motores. */
export const BIN_ROOT = APP_ROOT

const cache = new Map<string, string | null>()

/**
 * Olvida el resultado cacheado tras instalar (o eliminar) un motor, para que
 * `binaryStatus()` vuelva a escanear el disco en la siguiente consulta.
 */
export function invalidateBinary(tool?: string): void {
  if (tool) cache.delete(tool)
  else cache.clear()
}

/** Devuelve la ruta absoluta al binario o null si no está disponible. */
export async function findBinary(tool: keyof typeof EXECUTABLE_NAMES): Promise<string | null> {
  if (cache.has(tool)) return cache.get(tool) ?? null

  const names = EXECUTABLE_NAMES[tool] ?? [tool]

  // 1) resources/bin empaquetado.
  for (const name of names) {
    const candidate = join(APP_ROOT, name)
    if (await exists(candidate)) {
      cache.set(tool, candidate)
      return candidate
    }
  }

  // 1b) subcarpetas de resources/bin (dependencias "portable" extraídas).
  const inSubdir = await findBinaryInSubdirs(APP_ROOT, names)
  if (inSubdir) {
    // Normalizamos a nativo para que las llamadas a execFile reciban rutas estables.
    cache.set(tool, inSubdir.split('/').join(sep))
    return inSubdir.split('/').join(sep)
  }

  // 2) PATH del sistema (comprobamos con `which`/`where`).
  const probe = process.platform === 'win32' ? 'where' : 'which'
  for (const name of names) {
    try {
      const { stdout } = await execFileAsync(probe, [name])
      const found = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
      if (found && (await exists(found))) {
        cache.set(tool, found)
        return found
      }
    } catch {
      // no está en el PATH; seguimos
    }
  }

  // 3) Rutas de instalación comunes conocidas.
  for (const path of COMMON_INSTALL_PATHS[tool] ?? []) {
    if (await exists(path)) {
      cache.set(tool, path)
      return path
    }
  }

  cache.set(tool, null)
  return null
}

/** Estado de todos los motores externos, para mostrarlo en Ajustes. */
export async function binaryStatus(): Promise<Record<string, boolean>> {
  const [pandoc, magick, gs, soffice] = await Promise.all([
    findBinary('pandoc'),
    findBinary('magick'),
    findBinary('gs'),
    findBinary('soffice')
  ])
  return { pandoc: !!pandoc, magick: !!magick, gs: !!gs, soffice: !!soffice }
}
