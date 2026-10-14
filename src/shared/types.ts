/** Formatos de imagen soportados en la Fase 2 (más los de binarios en Fase 6). */
export const IMAGE_FORMATS = [
  'png',
  'jpeg',
  'webp',
  'avif',
  'tiff',
  'gif',
  'bmp',
  'ico',
  'heic',
  'raw',
  'svg'
] as const

export type ImageFormat = (typeof IMAGE_FORMATS)[number]

/** Resultado del análisis de un archivo de imagen. */
export type ImageInfo = {
  format: ImageFormat
  width: number
  height: number
  hasAlpha: boolean
  sizeBytes: number
  path: string
}

/** Opciones de conversión de una imagen. */
export type ConvertImageOptions = {
  inputPath: string
  targetFormat: ImageFormat
  /** Calidad 0–100; se ignora en formatos sin parámetro de calidad. */
  quality?: number
  /** Directorio de salida; si no se indica, se escribe junto al origen. */
  outputDir?: string | null
}

export type ConvertImageResult = {
  outputPath: string
  width: number
  height: number
  sizeBytes: number
  /** Duración de la conversión en milisegundos. */
  durationMs: number
}

/** Error tipado devuelto al renderer desde el IPC de conversión. */
export type ConversionError = {
  code: 'UNSUPPORTED_FORMAT' | 'READ_ERROR' | 'WRITE_ERROR' | 'INVALID_ARGUMENT'
  message: string
}

export type ConvertImageResponse =
  | { ok: true; result: ConvertImageResult }
  | { ok: false; error: ConversionError }

/** Formatos de documento soportados. */
export const DOCUMENT_FORMATS = [
  'pdf',
  'docx',
  'odt',
  'rtf',
  'txt',
  'md',
  'html',
  'epub',
  'csv',
  'png'
] as const

export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number]

export type ConvertDocOptions = {
  inputPath: string
  targetFormat: DocumentFormat
  outputDir?: string | null
  firstPage?: number
  lastPage?: number
}

export type ConvertDocResult = {
  outputPath: string
  sizeBytes: number
  durationMs: number
}

export type DocConvertResponse =
  | { ok: true; result: ConvertDocResult }
  | { ok: false; error: { code: 'MOTOR_MISSING' | 'CONVERSION_FAILED'; message: string } }

/** Modalidad de conversión por lotes (Fase 5). */
export type BatchMode = 'single-format' | 'per-file'

/**
 * Formatos por defecto de conversión (Ajustes → General).
 * `null` = sin preferencia: la UI elige el primer formato disponible de cada
 * archivo. La preselección se aplica al cargar archivos en la sección
 * Convertir (incluidos los del menú contextual del Explorador).
 */
export type DefaultFormats = {
  image: ImageFormat | null
  document: DocumentFormat | null
}

/** Unidad de trabajo de un lote. */
export type BatchItem = {
  inputPath: string
  /** Solo en modalidad per-file. */
  targetFormat?: ImageFormat | DocumentFormat
}

export type BatchOptions = {
  kind: 'imagenes' | 'documentos'
  mode: BatchMode
  items: BatchItem[]
  /** Solo en modalidad single-format. */
  targetFormat?: ImageFormat | DocumentFormat
  quality?: number
  outputDir?: string | null
}

/** Estado individual de un ítem del lote. */
export type BatchItemStatus = {
  inputPath: string
  status: 'pending' | 'converting' | 'done' | 'error'
  outputPath?: string
  error?: string
}

/** Progreso emitido al renderer durante un lote. */
export type BatchProgress = {
  completed: number
  total: number
  current: BatchItemStatus
  /** Estado acumulado de todos los ítems. */
  items: BatchItemStatus[]
}

export type BatchSummary = {
  total: number
  succeeded: number
  failed: number
  items: BatchItemStatus[]
}

/**
 * Estado del actualizador, emitido por el proceso main al renderer.
 * - `inactive`: desarrollo sin empaquetar, o desactivado por el usuario.
 * - `not-available`: no hay versión más nueva que la instalada.
 */
export type UpdaterState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'not-available' }
  | { status: 'available'; version: string; notes?: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }
  | { status: 'inactive'; reason: 'development' | 'disabled' }

/**
 * Parámetros del menú contextual del Explorador de Windows.
 * Se persisten por IPC (Ajustes); `enabled` gobierna las claves que el
 * proceso main registra en el Explorador.
 *
 * El menú es un único verbo «Convertir con Univert» (simple, sin submenú):
 * al invocarlo la app se abre con los archivos cargados y la conversión se
 * elige en la interfaz (con el formato por defecto de Ajustes preseleccionado).
 */
export type ContextMenuSettings = {
  /** Registra (o borra) el menú en el Explorador al hacer sync. */
  enabled: boolean
}

/** Snapshot del menú contextual para la tarjeta de Ajustes. */
export type ContextMenuStatus = {
  settings: ContextMenuSettings
  /** Solo Windows soporta el menú (en otras plataformas la tarjeta no se muestra). */
  supported: boolean
  /** false en desarrollo: el registro debe apuntar al ejecutable empaquetado. */
  packaged: boolean
}

/**
 * Petición que llega de la línea de comandos al abrir la app desde el menú
 * contextual. El proceso main **fusiona** las invocaciones que llegan en la
 * ventana de ~500 ms (Explorer lanza un proceso por archivo seleccionado) y
 * el renderer la consume por `ctxmenu:onRequest`/`ctxmenu:drain` abriendo la
 * sección Convertir con todos los archivos ya cargados.
 */
export type ContextMenuRequest =
  | { action: 'convert'; paths: string[] }
  /** Aviso para el renderer (toast de error). */
  | { action: 'notice'; message: string }

/**
 * Estado de la descarga/instalación de un motor externo (Ajustes → General).
 * Emitido por el proceso main durante `engine:download`.
 */
export type EngineProgress = {
  id: string
  phase: 'downloading' | 'installing' | 'done' | 'error'
  /** 0–100 durante la descarga; null si el servidor no informa el total. */
  percent: number | null
  bytesReceived: number
  totalBytes: number
  /** Motivo del fallo (sólo phase='error'). */
  error?: string
}
