import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Language = 'es' | 'en'

const dictionaries: Record<Language, Record<string, string>> = {
  es: {
    // Navegación
    'nav.images': 'Imágenes',
    'nav.documents': 'Documentos',
    'nav.batches': 'Lotes',
    'nav.settings': 'Ajustes',
    'section.images.desc': 'Convertir imágenes entre formatos raster y vectoriales.',
    'section.documents.desc': 'Convertir documentos entre formatos de texto y oficina.',
    'section.batches.desc': 'Conversión por lotes con un formato por archivo o uno común.',
    'section.settings.desc': 'Preferencias de la aplicación.',
    'section.pending': 'Sección en preparación para las fases siguientes.',
    // Titlebar
    'window.minimize': 'Minimizar',
    'window.maximize': 'Maximizar',
    'window.close': 'Cerrar',
    // Imágenes
    'img.drop': 'Arrastra una imagen aquí o haz clic para elegir',
    'img.formats': 'PNG, JPEG, WebP, AVIF, TIFF, GIF, BMP, SVG, ICO, HEIC…',
    'img.noEngines': 'Ningún destino disponible: este formato de origen requiere ImageMagick (Ajustes → General → Descargar).',
    'img.preview': 'Vista previa',
    'img.origin': 'Origen',
    'img.dimensions': 'Dimensiones',
    'img.size': 'Tamaño',
    'img.convert': 'Convertir',
    'img.targetFormat': 'Formato de destino',
    'img.quality': 'Calidad',
    'img.customDir': 'Directorio de salida distinto',
    'img.customDirOn': 'Sin directorio seleccionado',
    'img.customDirOff': 'Se guarda junto al archivo de origen',
    'img.pickFolder': 'Elegir carpeta',
    'img.openFolder': 'Abrir carpeta',
    'img.converted': 'Imagen convertida',
    'img.convertError': 'Error al convertir',
    'img.readError': 'No se pudo leer la imagen',
    // Documentos
    'doc.drop': 'Arrastra un documento aquí o haz clic para elegir',
    'doc.formats': 'PDF, DOCX, ODT, RTF, TXT, Markdown, HTML, EPUB',
    'doc.convert': 'Convertir documento',
    'doc.targetFormat': 'Formato de destino',
    'doc.noEngines': 'Sin motores disponibles',
    'doc.noEngineInfo': 'Sin motor disponible para este formato',
    'doc.noEngineDesc': 'Instala Pandoc (texto/oficina) o Ghostscript (PDF→imagen) para habilitar conversiones.',
    'doc.customDir': 'Directorio de salida distinto',
    'doc.customDirOn': 'Sin directorio seleccionado',
    'doc.customDirOff': 'Se guarda junto al origen',
    'doc.pickFolder': 'Elegir carpeta',
    'doc.openFolder': 'Abrir carpeta',
    'doc.converted': 'Documento convertido',
    'doc.convertError': 'Error al convertir',
    // Lotes
    'batch.step1': '1 · Tipo de archivos',
    'batch.step1.desc': 'Declara el tipo antes de agregar: no se mezclan imágenes y documentos.',
    'batch.images': 'Imágenes',
    'batch.documents': 'Documentos',
    'batch.step2': '2 · Modalidad y archivos',
    'batch.modeSingle': 'Un mismo formato',
    'batch.modePerFile': 'Formato por archivo',
    'batch.outputForAll': 'Formato de salida para todos',
    'batch.quality': 'Calidad',
    'batch.addFiles': 'Agrega archivos ({count}) — clic o arrastrar',
    'batch.step3': '3 · Destino y ejecución',
    'batch.customDir': 'Directorio de destino distinto',
    'batch.customDirOn': 'Sin directorio seleccionado',
    'batch.customDirOff': 'Los archivos se guardan junto a cada archivo de origen',
    'batch.pickFolder': 'Elegir carpeta',
    'batch.converting': 'Convirtiendo…',
    'batch.cancel': 'Cancelar',
    'batch.start': 'Convertir {count} archivos',
    'batch.clear': 'Limpiar',
    'batch.done': 'Lote terminado: {succeeded}/{total}',
    'batch.canceling': 'Cancelando lote…',
    'batch.startError': 'No se pudo iniciar el lote',
    'batch.status.done': 'OK',
    'batch.status.error': 'Error',
    'batch.status.converting': 'convirtiendo',
    'batch.status.pending': 'pendiente',
    // Ajustes
    'settings.tab.general': 'General',
    'settings.tab.appearance': 'Apariencia',
    'settings.engines': 'Motores de conversión externos',
    'settings.engines.desc': 'La app funciona sin instalar nada para imágenes y PDF. Estos motores amplían la cobertura y se detectan automáticamente.',
    'settings.engine.pandoc': 'Pandoc — documentos de texto/marcado (DOCX, ODT, MD, HTML, RTF, EPUB)',
    'settings.engine.magick': 'ImageMagick — formatos raros de imagen (HEIC, RAW, ICO)',
    'settings.engine.gs': 'Ghostscript — PDF → imagen (EPS, AI)',
    'settings.engine.soffice': 'LibreOffice — ofimática completa (XLSX, PPTX, PDF con formato)',
    'settings.available': 'Disponible',
    'settings.notInstalled': 'No instalado',
    'settings.download': 'Descargar',
    'settings.dl.installing': 'Instalando…',
    'settings.dl.done': '{engine}: instalado correctamente',
    'settings.dl.failed': '{engine}: falló la descarga',
    'settings.binNote': 'Los motores descargados se instalan automáticamente en',
    'settings.binNote2': '; también puedes colocarlos manualmente (ver su README). Se detectan al reiniciar.',
    'settings.language': 'Idioma',
    'settings.language.desc': 'Idioma de la interfaz de la aplicación.',
    'settings.window': 'Ventana',
    'settings.window.desc': 'Los cambios se aplican en vivo a la ventana principal.',
    'settings.transparency': 'Transparencia',
    'settings.blur': 'Efecto blur',
    'settings.bgColor': 'Color de fondo',
    'settings.barColor': 'Color lateral',
    'settings.accentColor': 'Color de acento',
    'settings.customColor': 'Personalizado',
    'settings.contentTransparency': 'Transparencia del contenido',
    'settings.contentTransparency.desc': 'Permite ver el escritorio detrás de la ventana.',
    'settings.updates': 'Actualizaciones',
    'settings.updates.desc': 'Gestión de versiones del software.',
    'settings.autoUpdates': 'Actualizaciones automáticas',
    'settings.autoUpdates.note':
      'Busca nuevas versiones en GitHub al iniciar y cada 4 horas; la descarga corre en segundo plano.',
    'settings.updates.version': 'Versión instalada',
    'settings.updates.checkNow': 'Buscar actualizaciones',
    'settings.updates.install': 'Reiniciar e instalar',
    'settings.update.idle': 'Pendiente de comprobar',
    'settings.update.checking': 'Buscando actualizaciones…',
    'settings.update.notAvailable': 'Estás al día',
    'settings.update.available': 'Nueva versión {version} disponible; descargando…',
    'settings.update.downloading': 'Descargando {version}… {percent}%',
    'settings.update.ready': 'Versión {version} lista para instalar',
    'settings.update.error': 'No se pudo comprobar; se reintentará más tarde.',
    'settings.update.inactive.dev': 'Solo disponible en la versión empaquetada.',
    'settings.update.inactive.disabled': 'Comprobaciones desactivadas.',
    'settings.restore': 'Restaurar valores predeterminados',
    // Presets de color
    'preset.graphite': 'Grafito',
    'preset.indigo': 'Índigo',
    'preset.abyss': 'Abisal',
    'preset.plum': 'Ciruela',
    'preset.charcoal': 'Carbón',
    'preset.cyan': 'Cian',
    'preset.orange': 'Naranja',
    'preset.yellow': 'Amarillo',
    'preset.red': 'Rojo',
    'preset.green': 'Verde'
  },
  en: {
    'nav.images': 'Images',
    'nav.documents': 'Documents',
    'nav.batches': 'Batches',
    'nav.settings': 'Settings',
    'section.images.desc': 'Convert images between raster and vector formats.',
    'section.documents.desc': 'Convert documents between text and office formats.',
    'section.batches.desc': 'Batch conversion with a per-file or single shared format.',
    'section.settings.desc': 'Application preferences.',
    'section.pending': 'Section coming in the next phases.',
    'window.minimize': 'Minimize',
    'window.maximize': 'Maximize',
    'window.close': 'Close',
    'img.drop': 'Drag an image here or click to choose',
    'img.formats': 'PNG, JPEG, WebP, AVIF, TIFF, GIF, BMP, SVG, ICO, HEIC…',
    'img.noEngines': 'No targets available: this source format requires ImageMagick (Settings → General → Download).',
    'img.preview': 'Preview',
    'img.origin': 'Source',
    'img.dimensions': 'Dimensions',
    'img.size': 'Size',
    'img.convert': 'Convert',
    'img.targetFormat': 'Target format',
    'img.quality': 'Quality',
    'img.customDir': 'Different output directory',
    'img.customDirOn': 'No directory selected',
    'img.customDirOff': 'Saved next to the source file',
    'img.pickFolder': 'Choose folder',
    'img.openFolder': 'Open folder',
    'img.converted': 'Image converted',
    'img.convertError': 'Conversion error',
    'img.readError': 'Could not read the image',
    'doc.drop': 'Drag a document here or click to choose',
    'doc.formats': 'PDF, DOCX, ODT, RTF, TXT, Markdown, HTML, EPUB',
    'doc.convert': 'Convert document',
    'doc.targetFormat': 'Target format',
    'doc.noEngines': 'No engines available',
    'doc.noEngineInfo': 'No engine available for this format',
    'doc.noEngineDesc': 'Install Pandoc (text/office) or Ghostscript (PDF→image) to enable conversions.',
    'doc.customDir': 'Different output directory',
    'doc.customDirOn': 'No directory selected',
    'doc.customDirOff': 'Saved next to the source',
    'doc.pickFolder': 'Choose folder',
    'doc.openFolder': 'Open folder',
    'doc.converted': 'Document converted',
    'doc.convertError': 'Conversion error',
    'batch.step1': '1 · File type',
    'batch.step1.desc': 'Declare the type before adding: images and documents are not mixed.',
    'batch.images': 'Images',
    'batch.documents': 'Documents',
    'batch.step2': '2 · Mode and files',
    'batch.modeSingle': 'Single format',
    'batch.modePerFile': 'Format per file',
    'batch.outputForAll': 'Output format for all',
    'batch.quality': 'Quality',
    'batch.addFiles': 'Add files ({count}) — click or drag',
    'batch.step3': '3 · Destination and run',
    'batch.customDir': 'Different destination directory',
    'batch.customDirOn': 'No directory selected',
    'batch.customDirOff': 'Files are saved next to each source file',
    'batch.pickFolder': 'Choose folder',
    'batch.converting': 'Converting…',
    'batch.cancel': 'Cancel',
    'batch.start': 'Convert {count} files',
    'batch.clear': 'Clear',
    'batch.done': 'Batch finished: {succeeded}/{total}',
    'batch.canceling': 'Cancelling batch…',
    'batch.startError': 'Could not start the batch',
    'batch.status.done': 'OK',
    'batch.status.error': 'Error',
    'batch.status.converting': 'converting',
    'batch.status.pending': 'pending',
    'settings.tab.general': 'General',
    'settings.tab.appearance': 'Appearance',
    'settings.engines': 'External conversion engines',
    'settings.engines.desc': 'The app works with no installs for images and PDF. These engines extend coverage and are auto-detected.',
    'settings.engine.pandoc': 'Pandoc — text/markup documents (DOCX, ODT, MD, HTML, RTF, EPUB)',
    'settings.engine.magick': 'ImageMagick — rare image formats (HEIC, RAW, ICO)',
    'settings.engine.gs': 'Ghostscript — PDF → image (EPS, AI)',
    'settings.engine.soffice': 'LibreOffice — full office suite (XLSX, PPTX, formatted PDF)',
    'settings.available': 'Available',
    'settings.notInstalled': 'Not installed',
    'settings.download': 'Download',
    'settings.dl.installing': 'Installing…',
    'settings.dl.done': '{engine}: installed successfully',
    'settings.dl.failed': '{engine}: download failed',
    'settings.binNote': 'Downloaded engines are installed automatically into',
    'settings.binNote2': '; you can also place executables manually (see their README). They are detected after restart.',
    'settings.language': 'Language',
    'settings.language.desc': 'Language of the application interface.',
    'settings.window': 'Window',
    'settings.window.desc': 'Changes apply live to the main window.',
    'settings.transparency': 'Transparency',
    'settings.blur': 'Blur effect',
    'settings.bgColor': 'Background color',
    'settings.barColor': 'Side color',
    'settings.accentColor': 'Accent color',
    'settings.customColor': 'Custom',
    'settings.contentTransparency': 'Content transparency',
    'settings.contentTransparency.desc': 'Lets you see the desktop behind the window.',
    'settings.updates': 'Updates',
    'settings.updates.desc': 'Software version management.',
    'settings.autoUpdates': 'Automatic updates',
    'settings.autoUpdates.note':
      'Checks GitHub for new versions on startup and every 4 hours; downloads run in the background.',
    'settings.updates.version': 'Installed version',
    'settings.updates.checkNow': 'Check for updates',
    'settings.updates.install': 'Restart and install',
    'settings.update.idle': 'Not checked yet',
    'settings.update.checking': 'Checking for updates…',
    'settings.update.notAvailable': "You're up to date",
    'settings.update.available': 'New version {version} available; downloading…',
    'settings.update.downloading': 'Downloading {version}… {percent}%',
    'settings.update.ready': 'Version {version} ready to install',
    'settings.update.error': 'Could not check for updates; will retry later.',
    'settings.update.inactive.dev': 'Only available in the packaged version.',
    'settings.update.inactive.disabled': 'Checks disabled.',
    'settings.restore': 'Restore defaults',
    'preset.graphite': 'Graphite',
    'preset.indigo': 'Indigo',
    'preset.abyss': 'Abyss',
    'preset.plum': 'Plum',
    'preset.charcoal': 'Charcoal',
    'preset.cyan': 'Cyan',
    'preset.orange': 'Orange',
    'preset.yellow': 'Yellow',
    'preset.red': 'Red',
    'preset.green': 'Green'
  }
}

const STORAGE_KEY = 'uc.language'

type I18nContextValue = {
  language: Language
  setLanguage: (language: Language) => void
  /** Traduce una clave; acepta placeholders {name} sustituidos por `vars`. */
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function readStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'es' || stored === 'en') return stored
  } catch {
    // localStorage puede no estar disponible; usamos el idioma del sistema.
  }
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, language)
    } catch {
      // Persistencia opcional.
    }
    document.documentElement.lang = language
    // Los diálogos nativos del proceso principal (p. ej. el de cierre) se
    // muestran en el mismo idioma que la interfaz.
    window.api?.app?.setLocale?.(language)
  }, [language])

  const setLanguage = useCallback((next: Language) => setLanguageState(next), [])

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      let text = dictionaries[language][key] ?? dictionaries.es[key] ?? key
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(value))
        }
      }
      return text
    },
    [language]
  )

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n debe usarse dentro de I18nProvider')
  return context
}
