import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import {
  DOCUMENT_FORMATS,
  IMAGE_FORMATS,
  type DefaultFormats,
  type DocumentFormat,
  type ImageFormat
} from '../shared/types'

/**
 * Formatos por defecto de conversión (Ajustes → General).
 *
 * `null` = sin preferencia (la UI elige el primer formato disponible de cada
 * archivo). La preselección se aplica en la sección Convertir al cargar
 * archivos, incluidos los que llegan desde el menú contextual del Explorador.
 *
 * Patrón idéntico a `context-menu.json`/`updater.json`: JSON en `userData`,
 * lectura tolerante y persistencia best-effort.
 */

const DEFAULTS: DefaultFormats = { image: null, document: null }

let cached: DefaultFormats | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'defaults.json')
}

function isImageFormat(value: unknown): value is ImageFormat {
  return typeof value === 'string' && (IMAGE_FORMATS as readonly string[]).includes(value)
}

function isDocumentFormat(value: unknown): value is DocumentFormat {
  return typeof value === 'string' && (DOCUMENT_FORMATS as readonly string[]).includes(value)
}

/** Normaliza cualquier JSON leído: solo formatos conocidos, nulo si no hay. */
function sanitize(raw: unknown): DefaultFormats {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    image: isImageFormat(data.image) ? data.image : null,
    document: isDocumentFormat(data.document) ? data.document : null
  }
}

/** Snapshot actual de los formatos por defecto (copia defensiva). */
export function defaultFormats(): DefaultFormats {
  if (!cached) {
    try {
      cached = sanitize(JSON.parse(readFileSync(configPath(), 'utf8')))
    } catch {
      // Sin archivo (primera ejecución) o ilegible: valores por defecto.
      cached = { ...DEFAULTS }
    }
  }
  return { ...cached }
}

/**
 * Aplica un parche parcial, persiste y devuelve el estado resultante.
 * Valores que no sean formatos soportados se interpretan como `null`
 * (sin preferencia); nunca tira la llamada IPC.
 */
export function saveDefaultFormats(patch: {
  image?: string | null
  document?: string | null
}): DefaultFormats {
  const current = defaultFormats()
  const clean: Partial<DefaultFormats> = {}
  if ('image' in patch) clean.image = isImageFormat(patch.image) ? patch.image : null
  if ('document' in patch) clean.document = isDocumentFormat(patch.document) ? patch.document : null
  cached = { ...current, ...clean }
  try {
    mkdirSync(dirname(configPath()), { recursive: true })
    writeFileSync(configPath(), JSON.stringify(cached))
  } catch {
    // Sin acceso a disco la preferencia solo vive en memoria de esta sesión.
  }
  return { ...cached }
}
