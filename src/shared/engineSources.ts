/**
 * Fuentes de descarga de los motores de conversión externos.
 *
 * Los archivos viven como assets de una **release fija** (tag `binaries`) del
 * repositorio de GitHub del proyecto. Elegimos URLs ancladas al tag — y no
 * `releases/latest/download` — porque "latest" cambia cada vez que se publica
 * una versión de la app y los motores desaparecerían del enlace. Con el tag
 * fijo la URL es estable para siempre y **no hace falta llamar a la API de
 * GitHub** (limitada a 60 req/h por IP sin token).
 *
 * Tamaño por asset: hasta 2 GiB (límite de GitHub), de modo que todos los
 * archivos y el instalador de LibreOffice caben sin problemas.
 */

export type EngineId = 'pandoc' | 'magick' | 'gs' | 'soffice'

export type EngineSource = {
  /** Nombre del asset en la release (fijo entre versiones). */
  fileName: string
  /**
   * - `archive`: zip extraído a `resources/bin/<id>/` (sin administrador).
   * - `msi`: instalador silencioso de Windows (`msiexec /quiet`).
   * - `exe`: ejecutable con `exeArgs` (silencioso si el fabricante lo permite).
   */
  kind: 'archive' | 'msi' | 'exe'
  /** Argumentos para kind='exe' (`__FILE__` se sustituye por la ruta descargada). */
  exeArgs?: string[]
}

// Dueño y repositorio en GitHub (privado; los assets son públicos vía la release).
const OWNER = 'jupaman-GH'
const REPO = 'universal-converter'

// Base de descarga. `UC_ENGINE_BASE` es un override para pruebas locales (E2E):
// si se define, los assets se piden en esa base en lugar de GitHub.
const BASE =
  (typeof process !== 'undefined' && process.env?.UC_ENGINE_BASE) ||
  `https://github.com/${OWNER}/${REPO}/releases/download/binaries`

export const ENGINE_SOURCES: Record<EngineId, EngineSource> = {
  pandoc: { fileName: 'pandoc.zip', kind: 'archive' },
  magick: { fileName: 'imagemagick.zip', kind: 'archive' },
  gs: { fileName: 'ghostscript.zip', kind: 'archive' },
  // LibreOffice no tiene forma portátil oficial razonable (~350 MB); se instala
  // en silencio. Windows pedirá una sola confirmación UAC (instalación en
  // Program Files), que es un límite del sistema operativo.
  soffice: { fileName: 'libreoffice.msi', kind: 'msi' }
}

/** URL directa de descarga del asset de un motor. */
export function engineUrl(id: EngineId): string {
  return `${BASE}/${ENGINE_SOURCES[id].fileName}`
}
