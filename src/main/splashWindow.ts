import { BrowserWindow } from 'electron'
import { SPLASH_LOGO_DATA_URI } from './splashAssets'

/**
 * Splash mostrado mientras la ventana principal carga su interfaz.
 *
 * Es una ventana sin marco, fija y centrada, que muestra el logo completo
 * (embebido como data URI para no depender de rutas de disco) y una barra de
 * progreso indeterminada con el color de acento de la aplicación. La cierra el
 * proceso principal en cuanto la ventana principal termina de pintarse.
 */
const SPLASH_WIDTH = 420
const SPLASH_HEIGHT = 330
/** Cierre de seguridad si la ventana principal nunca termina de cargar. */
export const SPLASH_MAX_MS = 15_000

const SPLASH_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body {
    margin: 0;
    height: 100%;
    overflow: hidden;
    background: #0b0f14;
    font-family: 'Segoe UI', system-ui, sans-serif;
    -webkit-user-select: none;
  }
  .wrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 34px;
  }
  .logo {
    width: 190px;
    height: auto;
    animation: fade-in 0.45s ease-out;
  }
  .track {
    width: 55%;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .fill {
    width: 30%;
    height: 100%;
    border-radius: 2px;
    /* oklch(0.75 0.18 195): color de acento (cian) de la app */
    background: #26b6cf;
    animation: slide 1.15s ease-in-out infinite;
  }
  @keyframes slide {
    0%   { transform: translateX(-110%); }
    100% { transform: translateX(440%); }
  }
  @keyframes fade-in {
    from { opacity: 0; transform: scale(0.96); }
    to   { opacity: 1; transform: scale(1); }
  }
</style>
</head>
<body>
  <div class="wrap">
    <img class="logo" src="${SPLASH_LOGO_DATA_URI}" alt="Universal Converter" />
    <div class="track"><div class="fill"></div></div>
  </div>
</body>
</html>`

/** Crea la ventana splash (sin mostrar; se muestra en `ready-to-show`). */
export function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    show: false,
    center: true,
    backgroundColor: '#0b0f14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  // Documento HTML autocontenido: no hay rutas de disco ni recursos externos.
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML))
  splash.once('ready-to-show', () => {
    if (!splash.isDestroyed()) splash.show()
  })
  return splash
}
