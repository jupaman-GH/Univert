# Menú contextual del Explorador de Windows (v2)

> **Diseño v2 (simplificado).** El menú ya **no** muestra submenús de formatos
> (ni «Convertir por lotes…»). Hay **un único verbo** «Convertir con Univert»
> para cualquier archivo compatible (imagen o documento) que **abre la
> aplicación con los archivos cargados**; allí se elige el formato único de
> salida o un formato por archivo. Ver `src/main/contextMenu.ts`.

## 1. Flujo

1. El usuario activa el menú en **Ajustes → General → Menú contextual del
   Explorador** (opt-in; solo en el build empaquetado).
2. El proceso main registra un verbo `UnivertConvert` en
   `HKCU\Software\Classes` (sin administrador) y avisa a Explorer con
   `SHChangeNotify(SHCNE_ASSOCCHANGED)`.
3. Al hacer clic derecho sobre un archivo compatible → «Convertir con
   Univert» (en Windows 11, bajo «Mostrar más opciones»).
4. Explorer lanza `Univert.exe --ctx convert "<archivo>"` (un proceso por
   archivo si hay selección múltiple). Si la app ya está abierta, la segunda
   instancia entrega el argv por `second-instance`; si no, arranca en frío.
5. El main **fusiona** las invocaciones de la ventana de ~500 ms en una sola
   petición, trae la ventana al frente y el renderer abre **Convertir** con
   todos los archivos ya cargados (detección de tipo y formatos por archivo).
6. El usuario elige formato (único o por archivo) y convierte en la UI.

## 2. Dónde se escribe el verbo (verificado empíricamente, Win11)

El verbo se registra en **tres tipos de ubicación** (todas con la misma
entrada simple `verbo + command`):

| Ubicación | Cubre |
| --- | --- |
| `HKCU\Software\Classes\SystemFileAssociations\image\shell\UnivertConvert` | Todas las extensiones percibidas como imagen (incluso con UserChoice). |
| `HKCU\Software\Classes\<ext>\shell\UnivertConvert` (por cada extensión soportada) | Archivos sin asociación elegida por el usuario (extensión virgen). |
| `HKCU\Software\Classes\<ProgId efectivo>\shell\UnivertConvert` | Archivos **con UserChoice** (p. ej. `.txt`→Notepad AppX, `.pdf`→ASC.Pdf): con UserChoice, Explorer **ignora** `\<ext>\shell` y solo lee el ProgId. |

Extensiones compatibles = imágenes (png, jpg, jpeg, webp, avif, tif, tiff,
gif, bmp, ico, heic, raw, svg) + documentos (pdf, docx, odt, rtf, txt, md,
markdown, html, htm, epub). `.csv` queda fuera (sin destinos de conversión).

### Estructura de cada clave

```
HKCU\Software\Classes\<lugar>\shell\UnivertConvert
    (Default)        = ""                (MUIVerb manda la etiqueta)
    MUIVerb           = "Convertir con Univert" | "Convert with Univert"
    Icon              = "<Univert.exe>,0"
    MultiSelectModel  = "Player"          (hasta 100 archivos seleccionados)
    command\(Default) = "<Univert.exe>" --ctx convert "%1"
```

### Por qué NO hay submenús (cascadas)

Se comprobó empíricamente que **las cascadas (`ExtendedSubCommandsKey` y
`SubCommands` con hojas) no llegan a mostrarse** en Windows 11 cuando se
registran de nuevo (probado en extensión virgen, extensión con UserChoice,
ProgId, `SystemFileAssociations\image/text`, contenedor raíz y anidado,
comandos a ejecutables reales). Lo único que sí se muestra de forma fiable
es el **verbo simple** (mismo mecanismo que usan «Edit with Notepad++» etc.).
Por eso la app deja de depender del submenú: el formato se elige dentro.

## 3. Línea de comandos y parser

- Comando: `"Univert.exe" --ctx convert "%1"`.
- `parseContextArgv` es **tolerante al reordenamiento** de Windows: en
  `second-instance`, Chromium reagrupa los `--flags` al principio y deja los
  tokens posicionales al final en su orden original (verificado con probe en
  Electron 44). El parser busca la acción `convert`/`batch` entre los tokens
  no-flag y filtra como rutas solo los tokens con separador de path; además
  entiende los comandos antiguos con `--kind`/`--format` (se ignoran), así
  que una instalación anterior se sigue comportando bien.
- Selección múltiple: Explorer lanza un proceso por archivo (`Player`);
  el main los fusiona en `emitCtxRequest({ action: 'convert', paths })`.

## 4. Ajustes y persistencia

- `userData/context-menu.json`: `{ "enabled": boolean }` (patrón
  `updater.json`; los campos antiguos `quality`/`showBatch` se ignoran).
- **Ajustes → tarjeta «Menú contextual del Explorador»**: solo el switch de
  activación (el resto de controles se eliminó con los submenús).
- Alta/baja en caliente desde Ajustes; si el registro falla, se revierten los
  ajustes y se limpian las claves parciales (`REGISTRY_FAILED`).
- El sync al arrancar es **reparador**: borra todas las raíces y las vuelve a
  escribir, por lo que una instalación anterior con el estado inconsistente
  se autocura en el primer arranque de la nueva versión.

## 5. Verificación

`npm run verify:ctxmenu`:

- Fase A: saneado y persistencia de los parámetros (headless).
- Fase B1: plan puro (`buildRegistryPlan`): verbo en imagen + extensiones +
  ProgIds, comando con comillas y `%1`, deduplicación y raíces de borrado.
- Fase C: parser `--ctx` (incluido el argv reordenado de `second-instance` y
  comandos legados).
- Fase B2 (solo Windows): round-trip real con `reg.exe` usando un verbo de
  prueba (`UnivertConvertVerify`): alta → query → re-sync → baja → sin restos
  + guardia de desarrollo.
