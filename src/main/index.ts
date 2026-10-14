import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import {
  availableImageTargets,
  convertImage,
  getImageInfo,
  isImageFile
} from './imageConverter'
import {
  convertDocument,
  detectDocumentFormat,
  documentTargets,
  isDocumentFile,
  mergePdfs,
  splitPdf
} from './docConverter'
import { binaryStatus } from './binaries'
import { cancelBatch, isBatchRunning, runBatch } from './batchProcessor'
import {
  initUpdater,
  installUpdate,
  setUpdaterEnabled,
  updaterState,
  checkForUpdates
} from './updater'
import { createSplashWindow, SPLASH_MAX_MS } from './splashWindow'
import { cancelEngineDownload, downloadEngine, initEngineInstaller } from './engineInstaller'
import {
  contextMenuSettings,
  parseContextArgv,
  saveContextMenuSettings,
  setContextMenuLocale,
  syncContextMenu,
  SUPPORTED_EXTENSIONS
} from './contextMenu'
import { defaultFormats, saveDefaultFormats } from './defaults'
import { closeBehavior, saveCloseBehavior } from './closeBehavior'
import type {
  BatchOptions,
  ContextMenuRequest,
  ContextMenuSettings,
  ConvertImageOptions,
  ConvertImageResponse,
  ConvertDocOptions
} from '../shared/types'

export type WindowAppearance = {
  /** Opacidad del fondo de la ventana, 0 (totalmente transparente) a 1 (opaco). */
  transparency: number
  /** Color de fondo en formato hexadecimal, p. ej. "#0b0f14". */
  color: string
  /**
   * Nivel de blur (px). Cero desactiva el efecto; valores mayores activan el
   * material "acrílico" de Windows 11, que difumina el fondo real que hay
   * detrás de la ventana (el blur CSS no puede ver el escritorio).
   */
  blur: number
}

const DEFAULT_APPEARANCE: WindowAppearance = {
  transparency: 1,
  color: '#0b0f14',
  blur: 0
}

// Instancia única (Fase C): si ya hay una instancia abierta —doble lanzamiento
// manual u opción del menú contextual—, esta sale y la otra se trae al frente.
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let splashTimer: NodeJS.Timeout | null = null/** Un cierre real (app.quit / apagado del sistema) está en marcha. */
let isQuitting = false
/** Icono de bandeja del sistema (una sola instancia). */
let tray: Tray | null = null

type AppLocale = 'es' | 'en'
/** Idioma elegido en la UI, comunicado por el renderer (null = idioma del sistema). */
let rendererLocale: AppLocale | null = null

/** Textos del menú de la bandeja del sistema (viven en el proceso principal). */
const TRAY_STRINGS: Record<AppLocale, { open: string; quit: string }> = {
  es: { open: 'Abrir Univert', quit: 'Salir' },
  en: { open: 'Open Univert', quit: 'Quit' }
}

/** Idioma para los diálogos nativos: el de la UI si ya se conoce, si no el del sistema. */
function dialogLocale(): AppLocale {
  if (rendererLocale) return rendererLocale
  return app.getLocale().toLowerCase().startsWith('es') ? 'es' : 'en'
}

/** Cierra el splash (si sigue vivo) y cancela su cierre de seguridad. */
function closeSplash(): void {
  if (splashTimer) {
    clearTimeout(splashTimer)
    splashTimer = null
  }
  const splash = splashWindow
  splashWindow = null
  if (splash && !splash.isDestroyed()) {
    // IMPORTANTE: `close()` NO destruye una ventana con `closable: false` (el
    // splash): quedaba viva tapada tras la ventana principal y, al cerrar la
    // app, `window-all-closed` nunca se disparaba (el proceso se quedaba con la
    // animación de carga y solo se podía matar a mano). `destroy()` cierra la
    // ventana por la fuerza, sin pasar por esa limitación.
    splash.destroy()
  }
}

/** Ruta al icono de bandeja (.ico empaquetado en resources; en dev, build/). */
function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'build', 'icon.ico')
}

/** Muestra (y enfoca) la ventana principal; la recrea si ya se cerró. */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Reconstruye el menú de la bandeja en el idioma vigente. */
function updateTrayMenu(): void {
  if (!tray) return
  const s = TRAY_STRINGS[dialogLocale()]
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: s.open, click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: s.quit,
        click: () => {
          // Salida real: desbloquea el evento 'close' y termina el proceso.
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
}

/** Icono permanente en la bandeja: abrir con clic doble, salir del menú. */
function createTray(): void {
  if (tray) return
  const icon = nativeImage.createFromPath(trayIconPath())
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('Univert')
  updateTrayMenu()
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

// --- Fase C: peticiones del menú contextual (instancia única + fusión) ------

/** Ventana de fusión: Explorer lanza un proceso por archivo seleccionado (§4.4). */
const CTX_MERGE_MS = 500

/** Rutas entrantes esperando a la ventana de fusión (una sola petición). */
let pendingCtxPaths: string[] = []
let pendingCtxTimer: NodeJS.Timeout | null = null
/** Peticiones emitidas que el renderer aún no ha drenado (arranque en frío). */
let undrainedCtxRequests: ContextMenuRequest[] = []

function emitCtxRequest(request: ContextMenuRequest): void {
  // Buffer: el renderer la drena al montar aunque llegaran antes de suscribirse.
  undrainedCtxRequests.push(request)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ctxmenu:request')
  }
}

/** Muestra y enfoca la ventana principal (segunda instancia / menú contextual). */
function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Fusiona las invocaciones entrantes en una ventana de ~500 ms: Explorer
 * lanza un proceso por cada archivo seleccionado y la app debe abrirse UNA
 * sola vez con todos ellos (la conversión se elige en la interfaz).
 */
function enqueueContextRequest(request: ContextMenuRequest): void {
  if (request.action === 'notice') {
    emitCtxRequest(request)
    return
  }
  pendingCtxPaths = [...new Set([...pendingCtxPaths, ...request.paths])]
  if (pendingCtxTimer) clearTimeout(pendingCtxTimer)
  pendingCtxTimer = setTimeout(() => {
    pendingCtxTimer = null
    const paths = pendingCtxPaths
    pendingCtxPaths = []
    if (paths.length > 0) emitCtxRequest({ action: 'convert', paths })
  }, CTX_MERGE_MS)
}

if (hasSingleInstanceLock) {
  // Segunda instancia: fusiona su argv (una opción del menú) y trae la ventana.
  app.on('second-instance', (_event, argv) => {
    const request = parseContextArgv(argv)
    if (request) enqueueContextRequest(request)
    focusMainWindow()
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    frame: false,
    // Icono de la ventana en desarrollo (en el ejecutable empaquetado ya se
    // usa el icono del .exe heredado de build/icon.ico).
    icon: app.isPackaged ? undefined : join(app.getAppPath(), 'build', 'icon.ico'),
    // La transparencia es opción de construcción en Electron; arrancamos con ella
    // habilitada y regulamos la opacidad fina mediante colores con alfa por IPC.
    transparent: true,
    backgroundColor: DEFAULT_APPEARANCE.color,
    // Material de fondo de Windows 11: 'none' de inicio; el slider de blur de
    // Apariencia lo cambia a 'acrylic' en vivo (ver applyAppearance).
    backgroundMaterial: 'none',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    // La interfaz ya está pintada: terminamos el splash y mostramos la ventana.
    closeSplash()
    mainWindow?.show()
  })

  // Toda vía de cierre (la ✕ del titlebar, Alt+F4, «Cerrar» del menú de la
  // barra de tareas) respeta el comportamiento elegido en Ajustes:
  // - bandeja (por defecto): la ventana se oculta y la app sigue viva;
  // - cerrar: salida real (window-all-closed → app.quit).
  mainWindow.on('close', (event) => {
    if (isQuitting) return // salida real en curso: dejamos cerrar sin preguntar
    if (closeBehavior().trayOnClose) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    closeSplash()
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Actualizaciones: registra eventos y dispara el primer chequeo (solo build
  // empaquetado); idempotente, además refresca la ventana destino.
  initUpdater(mainWindow)
  // Descarga integrada de motores: envía `engine:progress` a esta ventana.
  initEngineInstaller(mainWindow)
}

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) return [11, 15, 20]
  const value = parseInt(match[1], 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

function applyAppearance(appearance: WindowAppearance): void {
  if (!mainWindow) return
  const clamped = Math.min(1, Math.max(0, appearance.transparency))
  const [r, g, b] = hexToRgb(appearance.color)
  // El blur real lo aplica DWM con el material "acrílico" (Windows 11): difumina
  // el fondo que hay detrás de la ventana por debajo del tinte con alfa. Sin él,
  // el blur CSS solo muestrea las capas planas de la propia página (sin efecto
  // visible). Otras plataformas / Windows 10: se ignora sin romper nada.
  // IMPORTANTE: el material se aplica ANTES del color de fondo; cambiar el
  // material resetea el background de la ventana y descartaría el tinte.
  if (process.platform === 'win32' && typeof mainWindow.setBackgroundMaterial === 'function') {
    try {
      mainWindow.setBackgroundMaterial(appearance.blur > 0 ? 'acrylic' : 'none')
    } catch {
      // Sistema sin soporte de materiales (Windows 10): dejamos el efecto inactivo.
    }
  }
  // La ventana es transparente a nivel de sistema; la opacidad fina se logra
  // componiendo el color de fondo con alfa (1 - transparency).
  mainWindow.setBackgroundColor(`rgba(${r}, ${g}, ${b}, ${clamped})`)
}

function registerIpc(): void {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
  // Versión del software para la UI (esquina inferior izquierda).
  ipcMain.handle('app:get-version', () => app.getVersion())
  // Idioma de la UI para los diálogos nativos (el de cierre).
  ipcMain.on('app:set-locale', (_event, locale: unknown) => {
    if (locale !== 'es' && locale !== 'en') return
    rendererLocale = locale
    // El menú de la bandeja se traduce al mismo idioma que la UI.
    updateTrayMenu()
    // Los MUIVerb del menú contextual se registran en el idioma de la UI:
    // si cambia, se reescriben las claves (§4.3; no-op fuera de Windows
    // empaquetado y sin cambios reales de idioma).
    if (setContextMenuLocale(locale)) {
      syncContextMenu(contextMenuSettings()).catch((error) =>
        console.error('[menú contextual] re-registro tras cambio de idioma:', error)
      )
    }
  })
  ipcMain.handle('window:set-appearance', (_event, appearance: WindowAppearance) => {
    applyAppearance(appearance)
  })
  ipcMain.handle('window:pick-directory', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('shell:open-path', (_event, path: string) => shell.openPath(path))
  // Abre una URL en el navegador del sistema (solo http/https, desde el renderer).
  ipcMain.handle('shell:open-external', (_event, url: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('URL no permitida')
    }
    return shell.openExternal(url)
  })

  // Fase 2: motor de conversión de imágenes.
  ipcMain.handle('images:info', (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('Ruta de archivo inválida')
    }
    return getImageInfo(filePath)
  })

  ipcMain.handle(
    'images:convert',
    async (_event, options: ConvertImageOptions): Promise<ConvertImageResponse> => {
      if (
        !options ||
        typeof options.inputPath !== 'string' ||
        typeof options.targetFormat !== 'string'
      ) {
        return {
          ok: false,
          error: { code: 'INVALID_ARGUMENT', message: 'Opciones de conversión inválidas' }
        }
      }
      try {
        const result = await convertImage(options)
        return { ok: true, result }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido'
        const code =
          message.includes('no soportado') ||
          message.includes('no está disponible') ||
          message.includes('requiere ImageMagick')
            ? 'UNSUPPORTED_FORMAT'
            : 'READ_ERROR'
        return { ok: false, error: { code, message } }
      }
    }
  )

  // Para el DnD global de la Fase 3: el renderer pregunta si una ruta es imagen.
  ipcMain.handle('images:is-image', (_event, filePath: unknown) =>
    typeof filePath === 'string' ? isImageFile(filePath) : false
  )

  // Destinos de conversión disponibles según los motores instalados (Fase 6).
  ipcMain.handle('images:targets', (_event, filePath: unknown) =>
    typeof filePath === 'string' && filePath.length > 0 ? availableImageTargets(filePath) : []
  )

  // Selector unificado: imágenes y documentos a la vez (sección Convertir).
  ipcMain.handle('dialog:pick-files', async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Imágenes y documentos',
          extensions: SUPPORTED_EXTENSIONS.map((ext) => ext.slice(1))
        }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  // --- Fase 4: documentos ---
  ipcMain.handle('docs:is-document', (_event, filePath: unknown) =>
    typeof filePath === 'string' ? isDocumentFile(filePath) : false
  )
  ipcMain.handle('docs:targets', async (_event, filePath: unknown) => {
    const format = typeof filePath === 'string' ? detectDocumentFormat(filePath) : null
    return format ? documentTargets(format) : []
  })
  ipcMain.handle('docs:convert', async (_event, options: ConvertDocOptions) => {
    try {
      const result = await convertDocument(options)
      return { ok: true, result }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido'
      return {
        ok: false,
        error: {
          code: message.startsWith('MOTOR_MISSING') ? 'MOTOR_MISSING' : 'CONVERSION_FAILED',
          message
        }
      }
    }
  })
  ipcMain.handle('docs:merge', async (_event, paths: string[], outputPath: string) => {
    try {
      return { ok: true, result: await mergePdfs(paths, outputPath) }
    } catch (error) {
      return { ok: false, error: { code: 'CONVERSION_FAILED', message: String(error) } }
    }
  })
  ipcMain.handle('docs:split', async (_event, inputPath: string, outputDir: string) => {
    try {
      return { ok: true, result: await splitPdf(inputPath, outputDir) }
    } catch (error) {
      return { ok: false, error: { code: 'CONVERSION_FAILED', message: String(error) } }
    }
  })

  ipcMain.handle('binaries:status', () => binaryStatus())

  // --- Formatos por defecto (Ajustes → General; preselección en Convertir) ---
  ipcMain.handle('defaults:get', () => defaultFormats())
  ipcMain.handle('defaults:set', (_event, patch: unknown) => {
    // Strings crudos: `saveDefaultFormats` valida contra los formatos soportados.
    const clean: { image?: string | null; document?: string | null } = {}
    if (patch && typeof patch === 'object') {
      const data = patch as Record<string, unknown>
      if ('image' in data) clean.image = typeof data.image === 'string' ? data.image : null
      if ('document' in data)
        clean.document = typeof data.document === 'string' ? data.document : null
    }
    return saveDefaultFormats(clean)
  })

  // Comportamiento de la ✕ de la ventana (Ajustes → General).
  ipcMain.handle('close:get', () => closeBehavior())
  ipcMain.handle('close:set', (_event, patch: unknown) => {
    const clean: Partial<{ trayOnClose: boolean }> = {}
    if (patch && typeof patch === 'object') {
      const data = patch as Record<string, unknown>
      if (typeof data.trayOnClose === 'boolean') clean.trayOnClose = data.trayOnClose
    }
    return saveCloseBehavior(clean)
  })

  // --- Descarga integrada de motores (Ajustes → General) ---
  ipcMain.handle('engine:download', (_event, id: unknown) =>
    downloadEngine(typeof id === 'string' ? id : '')
  )
  ipcMain.handle('engine:cancel', (_event, id: unknown) => {
    if (typeof id === 'string') cancelEngineDownload(id)
  })

  // --- Fase 5: lotes ---
  ipcMain.handle('batch:run', async (_event, options: BatchOptions) => {
    if (isBatchRunning()) {
      return { ok: false, error: { code: 'BUSY', message: 'Ya hay un lote en curso' } }
    }
    try {
      const summary = await runBatch(options)
      return { ok: true, summary }
    } catch (error) {
      return { ok: false, error: { code: 'FAILED', message: String(error) } }
    }
  })
  ipcMain.handle('batch:cancel', () => {
    cancelBatch()
  })

  // --- Actualizaciones (electron-updater sobre GitHub Releases) ---
  ipcMain.handle('updater:state', () => updaterState())
  ipcMain.handle('updater:check', () => checkForUpdates())
  ipcMain.handle('updater:set-enabled', (_event, value: unknown) =>
    setUpdaterEnabled(value === true)
  )
  ipcMain.handle('updater:install', () => installUpdate())

  // --- Menú contextual del Explorador (parámetros + alta/baja en caliente) ---
  ipcMain.handle('ctxmenu:status', () => ({
    settings: contextMenuSettings(),
    supported: process.platform === 'win32',
    packaged: app.isPackaged
  }))
  ipcMain.handle('ctxmenu:set', async (_event, patch: unknown) => {
    const clean: Partial<ContextMenuSettings> = {}
    if (patch && typeof patch === 'object') {
      const data = patch as Record<string, unknown>
      if (typeof data.enabled === 'boolean') clean.enabled = data.enabled
    }
    const previous = contextMenuSettings()
    const next = saveContextMenuSettings(clean)
    // `enabled` gobierna las claves del Explorador → sincroniza en caliente.
    if (!('enabled' in clean)) return next
    try {
      await syncContextMenu(next)
      return next
    } catch {
      // Alta/baja fallida: revierte los ajustes y limpia claves parciales.
      saveContextMenuSettings(previous)
      await syncContextMenu(previous).catch(() => undefined)
      throw new Error('REGISTRY_FAILED')
    }
  })

  // Peticiones del menú contextual pendientes de consumo en el renderer
  // (arranque en frío o eventos tempranos; ver emitCtxRequest).
  ipcMain.handle('ctxmenu:drain', () => {
    const requests = undrainedCtxRequests
    undrainedCtxRequests = []
    return requests
  })
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return // segunda instancia: ya salió arriba

  // Activación desde el instalador (`--ctx-activate`): registra el menú sin
  // abrir ventana y termina con el código de estado correspondiente.
  if (process.argv.includes('--ctx-activate')) {
    const previous = contextMenuSettings()
    saveContextMenuSettings({ enabled: true })
    syncContextMenu(contextMenuSettings())
      .then(() => app.exit(0))
      .catch((error) => {
        console.error('[menú contextual] activación desde el instalador:', error)
        saveContextMenuSettings(previous)
        app.exit(1)
      })
    return
  }

  registerIpc()
  // Bandeja del sistema: el cierre de la ventana la oculta aquí (sin salir).
  createTray()
  // Menú contextual: si quedó activo, re-sincroniza las claves al arrancar
  // (recuperación tras reinstalación/cambio de versión). No-op fuera de
  // Windows empaquetado (§4.7 del plan).
  syncContextMenu(contextMenuSettings()).catch((error) =>
    console.error('[menú contextual] sync al arrancar:', error)
  )
  // Splash primero: tapa la ventana oscura hasta que la interfaz esté lista.
  splashWindow = createSplashWindow()
  // Cierre de seguridad: si la app nunca termina de cargar, no bloqueamos.
  splashTimer = setTimeout(closeSplash, SPLASH_MAX_MS)
  createWindow()

  // Petición en frío del menú contextual (§4.5): la ventana se trae al frente
  // y el renderer la drenará al montar (buffer `undrainedCtxRequests`).
  const coldRequest = parseContextArgv(process.argv)
  if (coldRequest) {
    enqueueContextRequest(coldRequest)
    focusMainWindow()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Cierre real (incluido el apagado del sistema): no preguntamos y nos
// aseguramos de que el splash no pueda quedar vivo bloqueando la salida.
app.on('before-quit', () => {
  isQuitting = true
  closeSplash()
  // La bandeja no debe sobrevivir al proceso (Windows la limpiaría tarde).
  tray?.destroy()
  tray = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
