# Checklist: replicar el modelo en un software nuevo

Cada software de la organización sigue el mismo patrón: un repo, una Release por
versión y auto-update desde dentro de la app.

## 1. Repositorio

- [ ] Repo nuevo en la organización (ej. `tu-marca/nombre-app`).
- [ ] `package.json`: `name`, `productName`, `version` y campo
      `repository` apuntando al repo nuevo.
- [ ] README con descripción, instrucciones de uso y licencia.

## 2. Auto-update

- [ ] Dependencia: `npm install electron-updater`.
- [ ] `electron-builder.yml`:
      bloque `publish: { provider: github, owner, repo }` con los nombres del
      repo nuevo, y `win.verifyUpdateCodeSignature: false` mientras no haya
      certificado de firma.
- [ ] Módulo `src/main/updater.ts` (copiar de este repo: estados, preferencia
      persistida en `userData/updater.json`, chequeo al inicio + cada 4 h).
- [ ] IPC en el proceso main: `updater:state`, `updater:check`,
      `updater:set-enabled`, `updater:install` + evento `updater:state-changed`.
- [ ] Preload: objeto `updater` tipado en `window.api`.
- [ ] UI en Ajustes: switch + estado + botones "Buscar actualizaciones" y
      "Reiniciar e instalar" (ver `SettingsSection.tsx`).
- [ ] Tipo compartido `UpdaterState` en `src/shared/types.ts`.

## 3. Release pipeline

- [ ] Copiar `.github/workflows/release.yml` (usa el `GITHUB_TOKEN` automático;
      `permissions: contents: write`).
- [ ] Script `release:win` en `package.json`.

## 4. Verificación

- [ ] `npm run typecheck` y `npm run dist:win`.
- [ ] Existe `dist/win-unpacked/resources/app-update.yml` con el repo nuevo.
- [ ] Existe `dist/latest.yml`.
- [ ] Prueba de punta a punta con una Release `v9.9.9` de prueba (ver
      [RELEASE.md](RELEASE.md)).

## 5. Donaciones (opcional por app)

- [ ] Elegir plataformas según [DONACIONES.md](DONACIONES.md).
- [ ] Agregar links en el README y, si se desea, una tarjeta en Ajustes.

## Ideas de mantenimiento centralizado (futuro)

- Reutilizar el `updater.ts` como paquete compartido (`@tu-marca/updater`) si
  el número de apps crece.
- Workflow reusable (`workflow_call`) para que cada repo invoque el mismo
  pipeline de release sin copiar el YAML.
