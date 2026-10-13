<p align="center">
<img src="Assets/UnivertLogo.png" width="500" alt="UNIVERT">
</p>

# Universal Converter

Conversor universal de imágenes y documentos de escritorio. Frontend en React +
Electron; conversiones locales empaquetadas, sin requerir software de terceros
instalado para los formatos principales.

## Funcionalidad

- **Secciones separadas** para Imágenes y Documentos; cada una solo acepta su tipo.
- **Drag & drop global**: suelta un archivo en cualquier punto y la app detecta su
  tipo y navega a la sección adecuada.
- Muestra la **ruta origen** y convierte **por defecto junto al archivo**, con opción
  de un directorio de salida distinto.
- **Calidad 0–100%** en los formatos que la admiten.
- **Conversión por lotes** con dos modalidades: un formato para todos, o un formato
  por archivo. El tipo (imágenes/documentos) se declara antes de agregar.
- Entorno gráfico oscuro con animaciones, y ajuste en vivo de **transparencia, color
  y blur** de la ventana.

## Desarrollo

```bash
npm install
npm run dev        # arranca con HMR
npm run build      # compila main/preload/renderer a out/
npm run typecheck  # tsc en main/preload y renderer
```

### Verificaciones del motor

```bash
npm run verify:images   # matriz de conversión de imágenes, dimensiones, calidad, rutas
npm run verify:docs     # operaciones PDF (unir/partir) y degradación de motores
```

### Empaquetar (Windows)

```bash
npm run dist:win
```

## Matriz de formatos (real, verificada)

`npm run verify:images` valida la columna de imágenes en cada build.

### Imágenes — motor `sharp`/`resvg`, incluido en la app (sin binarios)

| Origen ↓ / Destino → | PNG | JPEG | WebP | AVIF | TIFF | GIF | BMP |
|---|---|---|---|---|---|---|---|
| PNG | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| JPEG | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| WebP | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ |
| AVIF | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| TIFF | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| GIF | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| BMP | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| SVG | ✓ (resvg) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

- **Calidad 0–100%** aplicable en PNG, JPEG, WebP, AVIF, TIFF y GIF (se oculta el
  slider en BMP, sin parámetro de calidad).
- **SVG** se rasteriza con `resvg` (WASM/Rust, sin binarios del sistema). SVG como
  formato de *salida* vectorial no está soportado en esta fase (limitación
  documentada; requiere un trazador vectorial).

### Imágenes raras — requieren ImageMagick (binario opcional, Fase 6)

HEIC/HEIF, RAW (CR2/NEF/DNG), ICO, PSD. Sin el binario, la app responde
`UNSUPPORTED_FORMAT` y la UI lo indica. Ver `resources/bin/README.md`.

### Documentos

| Operación | Motor | Incluido sin instalar nada |
|---|---|---|
| Unir PDF | `pdf-lib` | **Sí** |
| Partir PDF | `pdf-lib` | **Sí** |
| MD ↔ HTML ↔ TXT ↔ RTF ↔ DOCX ↔ ODT ↔ EPUB | Pandoc | No (binario opcional) |
| PDF → imagen (PNG) | Ghostscript | No (binario opcional) |
| XLSX, PPTX, PDF con formato | LibreOffice headless | No (binario opcional, Fase 7) |

Si falta un motor, la conversión afectada devuelve un error claro
(`MOTOR_MISSING`) y el resto de la app sigue funcionando. En **Ajustes** se muestra
el estado de cada motor.

## Arquitectura

- `src/main/` — proceso principal de Electron: ventana, IPC y motores
  (`imageConverter.ts`, `docConverter.ts`, `batchProcessor.ts`, `binaries.ts`).
- `src/preload/` — puente `contextBridge` con `window.api` tipado.
- `src/renderer/` — UI React (secciones Imágenes, Documentos, Lotes, Ajustes).
- `src/shared/` — tipos compartidos entre los tres procesos.

Toda conversión corre en el **proceso main**; el renderer solo habla por IPC. Los
binarios externos se ejecutan como procesos hijo con `execFile` (sin shell) y
límites de tiempo.

## Limitaciones conocidas

- SVG como salida vectorial no soportado (solo rasterización de entrada).
- El blur de ventana usa `backdrop-filter` sobre el contenido de la app; Windows no
  permite desenfocar el escritorio detrás de la ventana sin técnicas nativas.
- El soporte real de HEIC/RAW/AI depende del build de ImageMagick que se empaquete.

## Licencias de binarios redistribuidos

Si empaquetas los binarios opcionales en `resources/bin`, incluye sus licencias:

- ImageMagick: https://imagemagick.org/license/ (requiere atribución).
- Pandoc: GPL-2. Ghostscript: AGPL. LibreOffice: MPL-2.0.
