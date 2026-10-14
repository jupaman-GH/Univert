import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'

/**
 * Comportamiento de la ✕ de la ventana (Ajustes → General).
 *
 * - `trayOnClose: true` (por defecto): la ✕ OCULTA la ventana en la bandeja
 *   del sistema; la salida real es desde el menú de la bandeja.
 * - `trayOnClose: false`: la ✕ CIERRA la aplicación (salida real).
 *
 * Patrón idéntico a `defaults.json`/`updater.json`: JSON en `userData`,
 * lectura tolerante y persistencia best-effort.
 */

export type CloseBehavior = { trayOnClose: boolean }

const DEFAULTS: CloseBehavior = { trayOnClose: true }

let cached: CloseBehavior | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'close-behavior.json')
}

function sanitize(raw: unknown): CloseBehavior {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    trayOnClose: typeof data.trayOnClose === 'boolean' ? data.trayOnClose : DEFAULTS.trayOnClose
  }
}

/** Snapshot actual del comportamiento (copia defensiva). */
export function closeBehavior(): CloseBehavior {
  if (!cached) {
    try {
      cached = sanitize(JSON.parse(readFileSync(configPath(), 'utf8')))
    } catch {
      // Sin archivo (primera ejecución) o ilegible: por defecto, bandeja.
      cached = { ...DEFAULTS }
    }
  }
  return { ...cached }
}

/** Aplica un parche parcial, persiste y devuelve el estado resultante. */
export function saveCloseBehavior(patch: Partial<CloseBehavior>): CloseBehavior {
  const current = closeBehavior()
  const clean: Partial<CloseBehavior> = {}
  if (typeof patch.trayOnClose === 'boolean') clean.trayOnClose = patch.trayOnClose
  cached = { ...current, ...clean }
  try {
    mkdirSync(dirname(configPath()), { recursive: true })
    writeFileSync(configPath(), JSON.stringify(cached))
  } catch {
    // Sin acceso a disco la preferencia solo vive en memoria de esta sesión.
  }
  return { ...cached }
}
