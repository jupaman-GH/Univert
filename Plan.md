# Plan — Conversor Universal de Imágenes y Documentos

Plan de implementación derivado de [Idea.md](Idea.md). Este documento contiene el análisis
técnico solicitado (alternativas de shell, motores de conversión, empaquetado) y la
descomposición en fases ordenadas para implementar el proyecto de forma incremental.

**Decisiones validadas:**

| Decisión | Elección |
|---|---|
| Shell de escritorio | **Electron** |
| Frontend | **React + shadcn/ui** (Vite + TypeScript + Tailwind) |
| Plataforma de distribución | **Windows primero** (multiplataforma en fase futura) |
| LibreOffice (ofimática) | **Fase tardía/opcional**; las fases iniciales cubren imágenes y documentos ligeros |

---

## 1. Alcance y funcionalidades

- Conversor universal de imágenes y documentos: convertir la mayoría de formatos entre sí.
- **Sección Imágenes**: seleccionar un archivo de imagen y el formato de imagen de destino.
- **Sección Documentos**: seleccionar un documento y el formato de documento de destino.
- Las secciones están **separadas**; cada una solo acepta archivos de su tipo.
- **Drag & drop global**: detecta el tipo de archivo y navega a la sección apropiada.
- Muestra la **ruta origen** de lectura del archivo.
- Conversión **por defecto en la misma ruta** del archivo origen; opcionalmente un
  directorio de salida distinto (habilitable).
- Conversión **vectorial (SVG)** incluida en la sección de imágenes.
- **Calidad de salida 0–100%** cuando el formato destino lo permite.
- **Conversión por lotes** con dos modalidades:
  1. Varios archivos → un mismo formato de salida.
  2. Varios archivos → formato individual por archivo.
  - Antes de agregar archivos hay que **declarar si el lote es de imágenes o de
    documentos** (no se mezclan).
- Entorno gráfico **futurista**: animaciones, iluminación de botones, y ajuste de
  **transparencias, colores y blur** de la ventana principal.
- **Todo empaquetado**: no requiere software de terceros instalado en la PC.

---

## 2. Análisis de alternativas de shell

### 2.1 Comparativa

| Criterio (prioridad) | **Electron** | Tauri | NW.js | WebView2 + WinUI |
|---|---|---|---|---|
| UI HTML/CSS/JS + efectos (blur, animaciones) | **Muy buena y consistente**: Chromium incluido | Buena; el WebView cambía por SO (WebView2/WKWebView/WebKitGTK) | Buena; Chromium integrado | Muy buena en Windows (Edge/Chromium) |
| Ejecutar herramientas de conversión | **La más sencilla**: Node.js en el proceso principal, procesos hijo + IPC | Buena con *sidecars*, pero empaquetado por arquitectura y permisos/capacidades | Directa desde JS, pero sin separación UI/privilegios | Requiere host C#/C++ |
| Tamaño de distribución | Grande (Chromium + Node) | **El menor** (usa WebView del sistema) | Grande (runtime redistribuido) | Pequeño con Evergreen; ~100–250 MB con Fixed Version |
| Drag & drop y acceso a ficheros | Buena (DnD HTML5 + IPC al proceso principal) | Buena; en Windows hay que probar la config de DnD de WebView2 | Directa | Buena vía host |
| Multiplataforma | **Sí** (Win/macOS/Linux) | Sí (con motor web distinto por SO) | Sí | **No**: solo Windows |
| Ecosistema y madurez para proyecto nuevo | **El mayor** | Creciente | Menor actualidad | Nicho Windows |

Fuentes: [Electron: introducción](https://www.electronjs.org/docs/latest) ·
[Electron: modelo de procesos](https://www.electronjs.org/docs/latest/tutorial/process-model) ·
[Tauri: proceso y WebViews](https://v2.tauri.app/concept/process-model/) ·
[Tauri: sidecars](https://v2.tauri.app/develop/sidecar/) ·
[NW.js: empaquetar y distribuir](https://docs.nwjs.io/For%20Users/Package%20and%20Distribute/) ·
[Microsoft: distribución de WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

### 2.2 Veredicto: **Electron**

1. **Electron** — mejor ajuste para UI HTML/CSS/JS cuidada y para orquestar varios
   binarios de conversión desde Node. Coste: runtime base grande.
2. **Tauri** — alternativa si el tamaño del instalador pasa a pesar más que la
   simplicidad; añade trabajo de sidecars/permisos por arquitectura.
3. **WebView2 + WinUI** — solo si el producto fuese exclusivamente Windows y el equipo
   asumiera un host nativo.
4. **NW.js** — no recomendado: acceso de Node desde el DOM sin separación clara.

Nota: el tamaño final estará dominado por los **motores de conversión**, no por el
runtime; conviene medir el instalador real antes de decidir migrar a Tauri.

---

## 3. Matriz de conversión: formato → motor

Convenciones: **npm** = se instala como dependencia (puede llevar binarios propios);
**binario** = ejecutable a empaquetar con `extraResources`; **fase** = fase del plan donde
se integra.

### 3.1 Imágenes raster

| Formato | Motor | Tipo | Fase |
|---|---|---|---|
| PNG, JPEG, WebP, AVIF, TIFF, GIF | `sharp` (libvips) | npm (nativos) | Fase 2 |
| BMP, ICO | `sharp` (BMP) / ImageMagick (ICO) | npm / binario | 2 / 6 |
| HEIC/HEIF | `sharp` si el build incluye libheif; si no ImageMagick | npm / binario | 6 |
| RAW fotográfico (CR2, NEF, DNG…) | ImageMagick con delegates | binario | 6 |
| PSD | ImageMagick | binario | 6 |

- `sharp` cubre las conversiones habituales con máximo rendimiento.
- Verificar el soporte real del build: `magick identify -list format`
  ([ImageMagick: formatos](https://imagemagick.org/formats/),
  [Sharp: entrada](https://sharp.pixelplumbing.com/api-constructor/),
  [Sharp: instalación](https://sharp.pixelplumbing.com/install/)).

### 3.2 Imágenes vectoriales y PDF→imagen

| Formato | Motor | Tipo | Fase |
|---|---|---|---|
| SVG (entrada) | `@resvg/resvg-wasm` o `resvg-js`; también `sharp` | npm (WASM/nativo) | Fase 2 |
| SVG (salida) | conversión desde raster no es fiable; salida SVG limitada a recrear/emitir | npm | Fase 6 |
| PDF → imagen | Ghostscript (rasteriza páginas) | binario | Fase 4 |
| EPS / AI | Ghostscript / ImageMagick (AI≈PDF-compatible) | binario | Fase 6 |
| PDF crear/modificar/partir | `pdf-lib` | npm puro | Fase 4 |
| PDF visualización/raster en UI | `pdfjs-dist` (PDF.js) | npm | Fase 4 |

[Ghostscript](https://ghostscript.readthedocs.io/en/latest/Use.html) ·
[pdf-lib](https://pdf-lib.js.org/) ·
[PDF.js](https://mozilla.github.io/pdf.js/examples/) ·
[resvg-js](https://github.com/thx/resvg-js)

### 3.3 Documentos

| Formato | Motor | Tipo | Fase |
|---|---|---|---|
| TXT, MD, HTML, RTF | Pandoc | binario | Fase 4 |
| DOCX, ODT, EPUB | Pandoc (con pérdida de formato avanzado) | binario | Fase 4 |
| PDF → texto/MD | extracción con PDF.js | npm | Fase 4 |
| XLSX, CSV, PPTX, ofimática con formato | LibreOffice headless (`soffice --headless --convert-to`) | binario (grande) | Fase 7 |
| PDF → DOCX/ODT con formato | LibreOffice | binario | Fase 7 |
| PDF→PDF estructural (optimizar/cifrar) | `qpdf` | binario | Fase 6 |

[LibreOffice: filtros](https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html) ·
[Pandoc: manual](https://pandoc.org/MANUAL.html) ·
[qpdf: CLI](https://qpdf.readthedocs.io/en/stable/cli.html)

**Claves:**
- No existe una librería npm pura que cubra todo; la cobertura máxima combina
  `sharp`/`resvg` (npm) + Pandoc + Ghostscript/ImageMagick + LibreOffice.
- Antes de anunciar un formato, probar **entrada y salida por separado** con archivos
  reales; en motores con delegates, el nombre del formato no garantiza el soporte del
  build empaquetado.

---

## 4. Estrategia de empaquetado ("sin software de terceros")

- **Binarios** (Pandoc, Ghostscript, ImageMagick, qpdf, LibreOffice) se copian con
  `extraResources` de `electron-builder` y se resuelven con `process.resourcesPath`
  ([electron-builder: contents](https://www.electron.build/docs/contents/)).
- **`sharp`**: excluir `sharp` y `@img/*` del ASAR con `asarUnpack`
  ([Sharp: instalación](https://sharp.pixelplumbing.com/install/)).
- **`resvg-wasm`**: incluir el `.wasm` como recurso; evita addons nativos.
- **Licencias**: incluir copia de las licencias de todos los binarios redistribuidos
  (ImageMagick exige licencia + atribución:
  [licencia](https://imagemagick.org/license/); revisar Pandoc, Ghostscript, qpdf,
  LibreOffice).
- **Seguridad**: política de ImageMagick con límites de memoria/tiempo/coders para
  archivos no confiables ([política](https://imagemagick.org/security-policy/)).
- **Proceso**: toda conversión corre en el proceso **main** (o un worker), nunca en el
  renderizador; el renderer solo habla por `contextBridge`/IPC con una API pequeña.

---

## 5. Fases de implementación

Orden pensado para entregas incrementales funcionales: cada fase deja la app usable.

### Fase 0 — Andamiaje del proyecto
**Objetivo:** app Electron vacía pero correcta arquitectónicamente.

Tareas:
- `package.json` con Vite + React + TypeScript + Tailwind + shadcn/ui + Electron +
  `electron-builder`.
- Estructura de procesos: `main/` (ventana, servicios), `preload/` (`contextBridge`),
  `renderer/` (React).
- Ventana frameless con soporte de transparencia; configuración IPC de ventana.
- Scripts: `dev` (HMR del renderer + Electron), `build`, `dist`.

**Criterios:** la app abre con el layout base (sidebar de secciones), el preload expone
`window.api` tipado, y `npm run build` genera un ejecutable de desarrollo.

### Fase 1 — Sistema de diseño y entorno gráfico
**Objetivo:** la estética futurista y los ajustes de ventana pedidos en Idea.md.

Tareas:
- Tema global: paleta oscura con acentos neón, tipografía, glow.
- Componentes shadcn usados: `Tabs`, `Slider`, `Switch`, `Select`, `Dialog`, `Toast`,
  `Progress`, `Sidebar`, `Card`, `Button`, `Tooltip`, `Empty`, `Spinner`, `Skeleton`.
- Botones con animaciones e **iluminación** (hover/focus, glow, transiciones).
- Panel **Ajustes** con controles en vivo de: **transparencia**, **color** y **blur** de
  la ventana (IPC → `setBackgroundColor`/CSS `backdrop-filter`/vibrancy).
- Navegación entre secciones: Imágenes · Documentos · Lotes · Ajustes.

**Criterios:** mover los sliders cambia la ventana en tiempo real; todas las secciones
navegan sin recargas; sin estilos crudos fuera del tema.

### Fase 2 — Motor de conversión de imágenes (backend)
**Objetivo:** convertir imágenes de forma fiable desde Node, sin UI todavía acoplada.

Tareas:
- Servicio `convertImage(file, targetFormat, quality)` en main con `sharp` + `resvg`.
- Tabla de **calidad 0–100%** por formato de salida (JPEG/WebP/AVIF: `quality`;
  PNG: `compressionLevel`; TIFF: `compress`; GIF: `effort`...). Formatos sin parámetro de
  calidad ocultan el slider.
- Resolución de rutas: origen (siempre visible), salida por defecto **en la misma
  ruta** con estrategia de nombre (`foto.png` → `foto_converted.webp`), y **directorio
  de salida alternativo** opcional (selector de carpeta vía diálogo IPC).
- Detección de formato por extensión/magic bytes; validación de compatibilidad
  entrada→salida (p. ej. raster→SVG solo si hay ruta definida).

**Criterios:** tests/manual de cada formato de la Fase 2 (PNG↔JPEG↔WebP↔AVIF↔TIFF↔GIF,
SVG→PNG) conserva dimensiones, respetando calidad y escribiendo en la ruta correcta.

### Fase 3 — Sección Imágenes (UI)
**Objetivo:** flujo completo de usuario para imágenes.

Tareas:
- Selector de archivo + **drag & drop** (con overlay de drop).
- Muestra de **ruta origen**, formato detectado, preview del archivo.
- Selector de formato destino, slider de calidad 0–100%, toggle "directorio de salida".
- Progreso + toast de éxito/error; botón "abrir carpeta de destino".
- Enrutado del DnD global: una imagen soltada en cualquier punto abre esta sección.

**Criterios:** convertir desde UI y desde DnD funciona de punta a punta; la ruta origen
se muestra siempre; por defecto escribe junto al origen.

### Fase 4 — Sección Documentos (sin LibreOffice)
**Objetivo:** documentos con motores ligeros.

Tareas:
- Integrar **Pandoc** empaquetado (TXT, MD, HTML, RTF, DOCX, ODT, EPUB).
- **PDF**: `pdf-lib` (crear/unir/partir), `pdfjs-dist` (preview y extracción de texto),
  Ghostscript para **PDF→imagen**.
- UI de la sección Documentos con el mismo flujo que Imágenes (DnD, rutas, progreso).
- Enrutado del DnD: documentos soltados abren esta sección.

**Criterios:** matriz documental mínima probada (MD↔DOCX↔HTML↔TXT↔RTF↔EPUB,
PDF→PNG, unir/partir PDF); el binario de Pandoc se resuelve desde `resources` sin
instalar nada.

### Fase 5 — Conversión por lotes
**Objetivo:** las dos modalidades pedidas.

Tareas:
- Flujo que **fuerza a declarar "Imágenes" o "Documentos"** antes de agregar archivos;
  una vez declarado, el picker/DnD solo acepta ese tipo.
- **Modalidad 1**: varios archivos → un mismo formato de salida.
- **Modalidad 2**: por cada archivo, formato individual (fila editable); "Convertir"
  aplica el formato de cada fila.
- Cola con concurrencia limitada (p. ej. 2–4), progreso **global y por archivo**,
  cancelación, resumen final de éxitos/fallos y opción de reintentar fallidos.
- Misma lógica de rutas de salida que las secciones individuales.

**Criterios:** ambas modalidades funcionan con 20+ archivos, no se mezclan tipos, el
progreso es visible y la cancelación detiene la cola.

### Fase 6 — Ampliación de formatos de imagen (binarios)
**Objetivo:** cubrir los formatos raros con binarios empaquetados.

Tareas:
- Sidecar **ImageMagick** (HEIC, ICO, RAW, PSD) y **Ghostscript** (EPS, AI, PDF→alto
  formato); `qpdf` para PDF→PDF.
- Política de seguridad de ImageMagick (límites de memoria/tiempo/coders).
- Detección de binario ausente → mensaje claro y formatos ocultos en la UI (degradación
  elegante).
- Salida **SVG** limitada a los casos soportados, documentados.

**Criterios:** matriz de formatos ampliada probada con archivos reales; si un binario
falta, la app sigue funcionando y avisa.

### Fase 7 — LibreOffice headless (ofimática)
**Objetivo:** formatos de oficina completos. Fase opcional/tardía por el tamaño.

Tareas:
- Integrar `soffice --headless --convert-to <filtro>` con rutas y timeouts.
- Soporte XLSX, CSV, PPTX, ODT↔DOCX con formato, PDF de oficina.
- Configuración de la ruta a LibreOffice (embebido o detectado), y empaquetado opcional
  (build "full").
- UI: formatos ofimáticos visibles solo si el motor está disponible.

**Criterios:** DOCX↔PDF↔ODT y XLSX↔CSV conservan formato razonablemente; el build sin
LibreOffice sigue siendo funcional y ligero.

### Fase 8 — Empaquetado y distribución (Windows)
**Objetivo:** instalador que cumpla "sin software de terceros instalado".

Tareas:
- `electron-builder` NSIS: `extraResources` (binarios), `asarUnpack` (`sharp`, `@img`),
  icono, metadatos, versión.
- Incluir copias de licencias de todos los binarios redistribuidos.
- Prueba en **máquina limpia** sin Node, sin Pandoc, sin ImageMagick, sin LibreOffice.
- Instalador mínimo (sin LO) y build "full".

**Criterios:** en una VM limpia de Windows, instalar y convertir imágenes + documentos
sin instalar nada más; el instalador abre sin errores y desinstala limpio.

### Fase 9 — QA, pulido y documentación
**Objetivo:** calidad final.

Tareas:
- **Matriz de pruebas entrada/salida** con archivos de muestra reales por formato
  (multi-página, transparencias, tamaños grandes).
- Manejo de errores uniforme (toasts), límites de memoria, timeouts.
- Rendimiento en lotes grandes; cancelación robusta.
- README: uso, formatos soportados reales por motor, licencias.
- (Fase futura) Multiplataforma: builds macOS/Linux y evaluación de Tauri si el tamaño
  lo exige.

**Criterios:** matriz completa en verde o con limitación documentada; sin fugas de
procesos tras cancelar; documentación que refleja el soporte real.

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Instalador muy grande (runtimes + binarios + LO) | Builds "mínimo" y "full"; LO opcional; medir antes de plantear Tauri |
| Formato "soportado" que falla en el build empaquetado | Probar entrada/salida con muestras reales en Fase 9; lista real en README |
| Licencias de binarios redistribuidos | Revisión y copia de licencias en Fase 8 |
| RAW/AI modernos no garantizados | Documentar limitaciones; degradación elegante (Fase 6) |
| Archivos no confiables (política de ImageMagick) | Política de recursos y validación previa (Fase 6) |

## 7. Referencias técnicas principales

- [Electron docs](https://www.electronjs.org/docs/latest) · [Tauri sidecars](https://v2.tauri.app/develop/sidecar/)
- [Sharp](https://sharp.pixelplumbing.com/) · [resvg-js](https://github.com/thx/resvg-js)
- [ImageMagick formatos](https://imagemagick.org/formats/) · [Ghostscript](https://ghostscript.readthedocs.io/en/latest/Use.html)
- [LibreOffice filtros](https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html) · [Pandoc](https://pandoc.org/MANUAL.html)
- [pdf-lib](https://pdf-lib.js.org/) · [PDF.js](https://mozilla.github.io/pdf.js/examples/) · [qpdf](https://qpdf.readthedocs.io/en/stable/cli.html)
- [electron-builder contents](https://www.electron.build/docs/contents/) · [shadcn/ui](https://ui.shadcn.com/docs/components)
