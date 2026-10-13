import { BrowserWindow } from 'electron'
import { createWriteStream } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { once } from 'events'
import { promisify } from 'util'
import { ENGINE_SOURCES, engineUrl, type EngineId } from '../shared/engineSources'
import type { EngineProgress } from '../shared/types'
import { BIN_ROOT, invalidateBinary } from './binaries'

const execFileAsync = promisify(execFile)

let window: BrowserWindow | null = null
/** Descargas en curso, por id de motor (sólo una a la vez por motor). */
const active = new Map<string, AbortController>()

/** Registra la ventana destino de los eventos de progreso. */
export function initEngineInstaller(target: BrowserWindow): void {
  window = target
}

function send(progress: EngineProgress): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send('engine:progress', progress)
  }
}

/**
 * Ejecuta un instalador esperando códigos de éxito (0 y 3010 = reboot pendiente).
 *
 * NSIS devuelve 2 en algunos casos benignos (p. ej. «ya instalado»); también lo
 * aceptamos para no marcar como error una instalación que ya está completa.
 */
async function runInstaller(command: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 })
  } catch (error) {
    const code = (error as { code?: number | string }).code
    if (code === 3010 || code === 2 || code === 0) return
    throw error
  }
}

/**
 * Ejecuta un instalador EXE/MSI ELEVADO (UAC) y espera su fin.
 *
 * Los instaladores de Ghostscript (NSIS) y LibreOffice (MSI) piden
 * administrador en su manifiesto: lanzarlos en plano de usuario devuelve
 * ERROR_ELEVATION_REQUIRED. La única vía válida es `Start-Process -Verb RunAs`:
 * Windows muestra UNA confirmación UAC; si el usuario la cancela (1223) se
 * propaga un error claro. Se espera (`-Wait`) para no marcar «done» antes de
 * tiempo, y se devuelve el código de salida real (`-PassThru`).
 *
 * `argsString` se pasa como UN solo string (sin re-comillar por PowerShell):
 * NSIS exige `/D=<ruta>` sin comillas incluso con espacios, y msiexec acepta
 * `/i "<ruta>"` con las comillas que nosotros mismos ponemos.
 */
async function runElevatedInstaller(command: string, argsString: string): Promise<void> {
  const script =
    `$p = Start-Process -FilePath '${command.replace(/'/g, "''")}' ` +
    `-ArgumentList '${argsString.replace(/'/g, "''")}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    })
  } catch (error) {
    const code = (error as { code?: number | string }).code
    const stderr = String((error as { stderr?: string }).stderr ?? '')
    // 1223 = el usuario canceló el diálogo UAC.
    if (/1223/.test(stderr)) throw new Error('Instalación cancelada (sin permiso de administrador)')
    if (code === 3010 || code === 2 || code === 0) return
    throw error
  }
}

/**
 * Descarga e instala un motor externo.
 *
 * Descarga con `fetch` (sigue redirecciones de GitHub y soporta abortar),
 * emitiendo `engine:progress` de forma moderada (~150 ms), y después:
 * `archive` → extrae el zip en `resources/bin/<id>/`; `msi`/`exe` → instalador
 * silencioso. Al terminar invalida la caché de binarios para que la UI refresque.
 */
export async function downloadEngine(rawId: string): Promise<{ ok: boolean; error?: string }> {
  const id = rawId as EngineId
  const source = ENGINE_SOURCES[id]
  if (!source) return { ok: false, error: `Motor desconocido: ${rawId}` }
  if (active.has(rawId)) return { ok: false, error: 'Ya hay una descarga en curso' }

  const controller = new AbortController()
  active.set(rawId, controller)
  const filePath = join(tmpdir(), `uc-engine-${rawId}-${source.fileName}`)

  let received = 0
  let total = 0
  let lastEmit = 0
  const emitDownload = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastEmit < 150) return
    lastEmit = now
    send({
      id: rawId,
      phase: 'downloading',
      percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null,
      bytesReceived: received,
      totalBytes: total
    })
  }

  try {
    // --- 1) Descarga con progreso ---
    const response = await fetch(engineUrl(id), {
      redirect: 'follow',
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    total = Number(response.headers.get('content-length') ?? '0') || 0

    if (response.body) {
      const reader = response.body.getReader()
      const out = createWriteStream(filePath)
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
          emitDownload()
          if (!out.write(value)) await once(out, 'drain')
        }
      } finally {
        out.end()
        await once(out, 'finish').catch(() => undefined)
      }
    } else {
      // Respuesta sin cuerpo streaming: copia directa (sin progreso intermedio).
      const buffer = Buffer.from(await response.arrayBuffer())
      received = buffer.byteLength
      const { writeFile } = await import('fs/promises')
      await writeFile(filePath, buffer)
    }
    emitDownload(true)
    send({
      id: rawId,
      phase: 'installing',
      percent: 100,
      bytesReceived: received,
      totalBytes: total || received
    })

    // --- 2) Instalación ---
    // Carpeta destino del motor en resources/bin/<id> (para archive y para los
    // instaladores que aceptan ruta propia con /D=__INSTALL_DIR__).
    const installDir = join(BIN_ROOT, rawId)
    if (source.kind === 'archive') {
      if (process.platform !== 'win32') {
        throw new Error('La instalación automática sólo está disponible en Windows')
      }
      const dest = installDir
      await mkdir(dest, { recursive: true })
      // Expand-Archive viene con Windows PowerShell 5.1: sin dependencias extra.
      await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath '${filePath}' -DestinationPath '${dest}' -Force`
        ],
        { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
      )
    } else if (source.kind === 'msi') {
      // MSI en Program Files: también requiere elevation (UAC una sola vez).
      await runElevatedInstaller('msiexec.exe', `/i "${filePath}" /quiet /norestart`)
    } else {
      // `__FILE__` → instalador descargado; `__INSTALL_DIR__` → carpeta destino.
      // NSIS exige `/D=<ruta>` SIN comillas (incluso con espacios) y al final.
      const argsString = (source.exeArgs ?? [])
        .map((a) => (a === '__FILE__' ? filePath : a === '__INSTALL_DIR__' ? installDir : a))
        .join(' ')
      await runElevatedInstaller(filePath, argsString)
    }

    invalidateBinary(rawId)
    send({
      id: rawId,
      phase: 'done',
      percent: 100,
      bytesReceived: received,
      totalBytes: total || received
    })
    return { ok: true }
  } catch (error) {
    const aborted =
      (error as { name?: string }).name === 'AbortError' ||
      controller.signal.aborted
    if (!aborted) {
      const message = error instanceof Error ? error.message : 'Error desconocido'
      send({
        id: rawId,
        phase: 'error',
        percent: null,
        bytesReceived: received,
        totalBytes: total,
        error: message
      })
      return { ok: false, error: message }
    }
    // Cancelado por el usuario: sin evento de error (la UI ya limpió su estado).
    return { ok: false, error: 'Cancelado' }
  } finally {
    active.delete(rawId)
    await rm(filePath, { force: true }).catch(() => undefined)
  }
}

/** Cancela la descarga en curso de un motor (durante la fase de descarga). */
export function cancelEngineDownload(id: string): void {
  active.get(id)?.abort()
}
