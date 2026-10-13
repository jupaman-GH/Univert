import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
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
import type { BatchOptions } from '../shared/types'
import type { ConvertImageOptions, ConvertImageResponse, ConvertDocOptions } from '../shared/types'

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

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let splashTimer: NodeJS.Timeout | null = null

/** Un cierre real (app.quit / apagado del sistema) está en marcha. */
let isQuitting = false
/** Evita abrir dos diálogos de cierre a la vez. */
let closePromptOpen = false

type AppLocale = 'es' | 'en'
/** Idioma elegido en la UI, comunicado por el renderer (null = idioma del sistema). */
let rendererLocale: AppLocale | null = null

/** Textos del diálogo de cierre (nativo, vive en el proceso principal). */
const CLOSE_STRINGS: Record<
  AppLocale,
  { title: string; message: string; detail: string; close: string; minimize: string; cancel: string }
> = {
  es: {
    title: 'Universal Converter',
    message: '¿Cerrar o minimizar?',
    detail:
      'Si minimizas, Universal Converter sigue en la barra de tareas y puedes volver a ella cuando quieras.',
    close: 'Cerrar aplicación',
    minimize: 'Minimizar a la barra de tareas',
    cancel: 'Cancelar'
  },
  en: {
    title: 'Universal Converter',
    message: 'Close or minimize?',
    detail:
      'If you minimize, Universal Converter stays in the taskbar and you can come back to it anytime.',
    close: 'Close application',
    minimize: 'Minimize to taskbar',
    cancel: 'Cancel'
  }
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

function promptClose(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  closePromptOpen = true
  const s = CLOSE_STRINGS[dialogLocale()]
  dialog
    .showMessageBox(mainWindow, {
      type: 'question',
      buttons: [s.close, s.minimize, s.cancel],
      defaultId: 0,
      cancelId: 2,
      title: s.title,
      message: s.message,
      detail: s.detail,
      noLink: true
    })
    .then(({ response }) => {
      closePromptOpen = false
      if (response === 0) {
        // Cerrar de verdad: desbloqueamos el evento 'close' y salimos.
        isQuitting = true
        app.quit()
      } else if (response === 1 && mainWindow && !mainWindow.isDestroyed()) {
        // Minimizar a la barra de tareas: la app sigue en segundo plano.
        mainWindow.minimize()
      }
      // Cancelar (botón o Esc): la ventana simplemente se queda abierta.
    })
    .catch(() => {
      closePromptOpen = false
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
  // barra de tareas) pasa por la pregunta: ¿cerrar o minimizar?
  mainWindow.on('close', (event) => {
    if (isQuitting) return // salida real en curso: dejamos cerrar sin preguntar
    event.preventDefault()
    if (closePromptOpen) return // ya hay un diálogo abierto
    promptClose()
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
    if (locale === 'es' || locale === 'en') rendererLocale = locale
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

  // Selector de archivos por tipo (imágenes o documentos) para las secciones.
  ipcMain.handle('dialog:pick-files', async (_event, kind: unknown) => {
    if (!mainWindow) return []
    const filters =
      kind === 'documentos'
        ? [{ name: 'Documentos', extensions: ['pdf', 'docx', 'odt', 'rtf', 'txt', 'md', 'html', 'epub', 'csv'] }]
        : [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'tif', 'tiff', 'gif', 'bmp', 'ico', 'heic', 'raw', 'svg'] }]
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters
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
}

app.whenReady().then(() => {
  registerIpc()
  // Splash primero: tapa la ventana oscura hasta que la interfaz esté lista.
  splashWindow = createSplashWindow()
  // Cierre de seguridad: si la app nunca termina de cargar, no bloqueamos.
  splashTimer = setTimeout(closeSplash, SPLASH_MAX_MS)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Cierre real (incluido el apagado del sistema): no preguntamos y nos
// aseguramos de que el splash no pueda quedar vivo bloqueando la salida.
app.on('before-quit', () => {
  isQuitting = true
  closeSplash()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
