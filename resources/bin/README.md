# Binarios externos opcionales

Coloca aquí los ejecutables para ampliar la cobertura de conversión. La app los
detecta automáticamente al arrancar; si faltan, los formatos que dependen de ellos
se ocultan o devuelven un error claro, sin romper el resto de la aplicación.

| Herramienta | Habilita | Dónde obtenerla |
|---|---|---|
| `pandoc` / `pandoc.exe` | Documentos de texto/marcado: MD, HTML, TXT, RTF, DOCX, ODT, EPUB | https://pandoc.org/installing.html |
| `magick` / `magick.exe` (ImageMagick) | Imágenes raras: HEIC, RAW, ICO, PSD | https://imagemagick.org/script/download.php |
| `gswin64c.exe` / `gs` (Ghostscript) | PDF → imagen (PNG/JPEG), EPS, AI | https://www.ghostscript.com/download.html |
| `soffice.exe` / `soffice` (LibreOffice) | Ofimática completa: XLSX, PPTX, PDF con formato | https://libreoffice.org/download |

Notas:

- En **desarrollo** se leen de `resources/bin` del proyecto; en la app empaquetada,
  de `resources/bin` junto al ejecutable (copiado vía `extraResources`).
- También se busca en el `PATH` del sistema y en rutas de instalación comunes.
- Las conversiones de **imágenes** (PNG, JPEG, WebP, AVIF, TIFF, GIF, BMP, SVG) y las
  operaciones **PDF** (unir, partir) no necesitan ninguno de estos binarios: van
  incluidas en la app.
