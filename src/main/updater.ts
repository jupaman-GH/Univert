import { app, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { autoUpdater } from 'electron-updater'
import type { UpdaterState } from '../shared/types'

/** Intervalo entre comprobaciones automáticas (4 horas). */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let window: BrowserWindow | null = null
let state: UpdaterState = { status: 'idle' }
let enabled = true
let initialized = false
let checkTimer: NodeJS.Timeout | null = null

/** Persistimos la preferencia para que el chequeo no dependa del renderer. */
function configPath(): string {
  return join(app.getPath('userData'), 'updater.json')
}

function loadEnabled(): boolean {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as { enabled?: boolean }
    return raw.enabled !== false
  } catch {
    return true
  }
}

function saveEnabled(value: boolean): void {
  try {
    mkdirSync(dirname(configPath()), { recursive: true })
    writeFileSync(configPath(), JSON.stringify({ enabled: value }))
  } catch {
    // Sin acceso a disco la preferencia solo vive en memoria de esta sesión.
  }
}

function setState(next: UpdaterState): void {
  state = next
  if (window && !window.isDestroyed()) {
    window.webContents.send('updater:state-changed', next)
  }
}

/** Falso en desarrollo: electron-updater necesita el app-update.yml del paquete. */
function active(): boolean {
  return app.isPackaged && enabled
}

async function check(): Promise<void> {
  if (!app.isPackaged) {
    setState({ status: 'inactive', reason: 'development' })
    return
  }
  if (!enabled) {
    setState({ status: 'inactive', reason: 'disabled' })
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    // Sin red o fuera de la tasa de GitHub (60 req/h por IP sin token):
    // fallo silencioso; el próximo ciclo reintenta.
    setState({
      status: 'error',
      message: error instanceof Error ? error.message : 'Error desconocido'
    })
  }
}

/**
 * Inicializa el updater. Llamar una vez cuando la app esté lista.
 * Devuelve los handlers IPC que registra.
 */
export function initUpdater(target: BrowserWindow): void {
  window = target
  if (initialized) return
  initialized = true

  enabled = loadEnabled()

  // Descarga en segundo plano; la instalación espera la confirmación del usuario
  // ("Reiniciar ahora"); también evita la instalación silenciosa al salir.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => setState({ status: 'not-available' }))
  autoUpdater.on('update-available', (info) =>
    setState({ status: 'available', version: info.version, notes: info.releaseNotes?.toString() })
  )
  autoUpdater.on('download-progress', (progress) => {
    if (state.status === 'available' || state.status === 'downloading') {
      setState({
        status: 'downloading',
        version: state.version,
        percent: Math.round(progress.percent)
      })
    }
  })
  autoUpdater.on('update-downloaded', (info) =>
    setState({ status: 'ready', version: info.version })
  )
  autoUpdater.on('error', (error) => {
    if (state.status !== 'ready') {
      setState({ status: 'error', message: error.message })
    }
  })

  if (app.isPackaged && enabled) {
    void check()
    checkTimer = setInterval(() => void check(), CHECK_INTERVAL_MS)
    checkTimer.unref?.()
  } else {
    setState(
      app.isPackaged
        ? { status: 'inactive', reason: 'disabled' }
        : { status: 'inactive', reason: 'development' }
    )
  }
}

/** Comprobación manual (botón "Buscar actualizaciones" en Ajustes). */
export function checkForUpdates(): Promise<void> {
  return check()
}

/** Estado actual (para que el renderer pida el snapshot al montar). */
export function updaterState(): { state: UpdaterState; enabled: boolean; active: boolean } {
  return { state, enabled, active: active() }
}

/** Activa/desactiva las comprobaciones desde el switch de Ajustes. */
export function setUpdaterEnabled(value: boolean): boolean {
  enabled = value
  saveEnabled(value)
  if (!value) {
    if (checkTimer) {
      clearInterval(checkTimer)
      checkTimer = null
    }
    setState({ status: 'inactive', reason: 'disabled' })
  } else if (checkTimer === null && app.isPackaged) {
    void check()
    checkTimer = setInterval(() => void check(), CHECK_INTERVAL_MS)
    checkTimer.unref?.()
  } else if (!app.isPackaged) {
    setState({ status: 'inactive', reason: 'development' })
  }
  return enabled
}

/** Instala la versión ya descargada y reinicia la app. */
export function installUpdate(): void {
  if (state.status !== 'ready') return
  // Silencioso = false: mostramos el instalador NSIS; forceRunAfter para que la
  // app vuelva a abrir tras la instalación.
  autoUpdater.quitAndInstall(false, true)
}
