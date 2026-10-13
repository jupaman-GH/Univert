# Cómo publicar una versión

Flujo completo para que los usuarios reciban la actualización **desde dentro de la
app**, sin entrar a GitHub.

## Prerrequisitos (una sola vez)

1. Crear la organización en GitHub y el repositorio `universal-converter`.
2. Editar los nombres en dos lugares:
   - [electron-builder.yml](../electron-builder.yml) → bloque `publish`
     (`owner` / `repo`).
   - [package.json](../package.json) → campo `repository`.
3. El workflow [.github/workflows/release.yml](../.github/workflows/release.yml)
   usa el `GITHUB_TOKEN` automático: no hay que crear secrets manualmente.

## Publicar una versión

1. Bumpear la versión en `package.json` (SemVer: `patch` para arreglos,
   `minor` para funcionalidad nueva, `major` para cambios grandes).
2. Commit + etiqueta + push:

   ```bash
   git add package.json package-lock.json
   git commit -m "v0.2.0: <resumen>"
   git tag v0.2.0
   git push origin main --tags
   ```

3. La action **Release** corre en `windows-latest`: typecheck → build →
   `electron-builder --win --publish always`.
4. En la GitHub Release aparecen: instalador NSIS (`Universal Converter Setup
   0.2.0.exe`), `latest.yml` y `*.blockmap`.

## Qué reciben los usuarios

- Al iniciar (y cada 4 h) la app consulta `latest.yml` de la Release más
  reciente de ese repo.
- Si hay versión nueva, **descarga en segundo plano** y muestra un aviso:
  "Versión X lista para instalar → Reiniciar e instalar".
- El switch **Ajustes → Actualizaciones** activa/desactiva las comprobaciones.

## Comprobación local del pipeline

```bash
npm run typecheck
npm run dist:win
```

Verificar en `dist/`:

- `win-unpacked/resources/app-update.yml` → contiene `owner`/`repo` del publish.
- `latest.yml` en la raíz de `dist/` → generado por el target NSIS.

### Prueba funcional de punta a punta

1. Subir el repo a GitHub y publicar una Release de prueba con versión mayor
   (ej. `v9.9.9`).
2. Empaquetar e instalar la app con versión menor (`0.1.0`).
3. Abrir la app: debe pasar por *checking → available → downloading → ready*
   (visible en Ajustes) y al pulsar "Reiniciar e instalar" debe instalar y
   reabrirse con la versión nueva.

## Notas

- **Rate limit**: la API sin token permite 60 req/h por IP; el chequeo es cada
  4 h, holgado. No embeber tokens en la app.
- **Firma de código**: `win.verifyUpdateCodeSignature: false` es temporal (el
  build no está firmado). Al conseguir certificado, ponerlo en `true` y firmar
  el instalador; ver TODO en `electron-builder.yml`.
- Los errores de red o de la API se muestran como "No se pudo comprobar" y se
  reintenta en el próximo ciclo; nunca bloquean la app.
