import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  BatchOptions,
  BatchProgress,
  BatchSummary,
  EngineProgress,
  ConvertDocOptions,
  ConvertDocResult,
  ConvertImageOptions,
  ConvertImageResponse,
  DocumentFormat,
  ImageFormat,
  ImageInfo,
  UpdaterState
} from '../shared/types'

export type WindowAppearance = {
  transparency: number
  color: string
  blur: number
}

const api = {
  app: {
    /** Versión del software (package.json / ejecutable empaquetado). */
    version: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
    /** Idioma de la UI para los diálogos nativos del proceso principal. */
    setLocale: (locale: string): void => ipcRenderer.send('app:set-locale', locale)
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    setAppearance: (appearance: WindowAppearance): Promise<void> =>
      ipcRenderer.invoke('window:set-appearance', appearance),
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('window:pick-directory')
  },
  shell: {
    openPath: (path: string): Promise<string> => ipcRenderer.invoke('shell:open-path', path),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url)
  },
  images: {
    info: (filePath: string): Promise<ImageInfo> => ipcRenderer.invoke('images:info', filePath),
    convert: (options: ConvertImageOptions): Promise<ConvertImageResponse> =>
      ipcRenderer.invoke('images:convert', options),
    isImage: (filePath: string): Promise<boolean> => ipcRenderer.invoke('images:is-image', filePath),
    /** Destinos disponibles para un archivo concreto según los motores instalados. */
    targets: (filePath: string): Promise<ImageFormat[]> =>
      ipcRenderer.invoke('images:targets', filePath)
  },
  dialog: {
    pickFiles: (kind: 'imagenes' | 'documentos'): Promise<string[]> =>
      ipcRenderer.invoke('dialog:pick-files', kind)
  },
  /** Resuelve la ruta en disco de un File soltado por drag & drop. */
  dnd: {
    getPathForFile: (file: File): string => webUtils.getPathForFile(file)
  },
  docs: {
    isDocument: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke('docs:is-document', filePath),
    targets: (filePath: string): Promise<DocumentFormat[]> => ipcRenderer.invoke('docs:targets', filePath),
    convert: (options: ConvertDocOptions): Promise<
      { ok: true; result: ConvertDocResult } | { ok: false; error: { code: string; message: string } }
    > => ipcRenderer.invoke('docs:convert', options),
    merge: (paths: string[], outputPath: string): Promise<{ ok: boolean; result?: unknown; error?: unknown }> =>
      ipcRenderer.invoke('docs:merge', paths, outputPath),
    split: (inputPath: string, outputDir: string): Promise<{ ok: boolean; result?: unknown; error?: unknown }> =>
      ipcRenderer.invoke('docs:split', inputPath, outputDir)
  },
  binaries: {
    status: (): Promise<Record<string, boolean>> => ipcRenderer.invoke('binaries:status')
  },
  /** Descarga integrada de motores externos (sin abrir el navegador). */
  engines: {
    download: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('engine:download', id),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke('engine:cancel', id),
    onProgress: (callback: (progress: EngineProgress) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, progress: EngineProgress): void =>
        callback(progress)
      ipcRenderer.on('engine:progress', listener)
      return () => ipcRenderer.removeListener('engine:progress', listener)
    }
  },
  /** Actualizaciones: chequeo contra las GitHub Releases e instalación. */
  updater: {
    /** Snapshot actual: estado, preferencia y si el updater está activo. */
    state: (): Promise<{ state: UpdaterState; enabled: boolean; active: boolean }> =>
      ipcRenderer.invoke('updater:state'),
    /** Comprobación manual inmediata. */
    check: (): Promise<void> => ipcRenderer.invoke('updater:check'),
    /** Activa o desactiva las comprobaciones (persistido en el proceso main). */
    setEnabled: (enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke('updater:set-enabled', enabled),
    /** Instala la versión ya descargada y reinicia la app. */
    install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
    onState: (callback: (state: UpdaterState) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, next: UpdaterState): void => callback(next)
      ipcRenderer.on('updater:state-changed', listener)
      return () => ipcRenderer.removeListener('updater:state-changed', listener)
    }
  },
  batch: {
    run: (options: BatchOptions): Promise<
      { ok: true; summary: BatchSummary } | { ok: false; error: { code: string; message: string } }
    > => ipcRenderer.invoke('batch:run', options),
    cancel: (): Promise<void> => ipcRenderer.invoke('batch:cancel'),
    onProgress: (callback: (progress: BatchProgress) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, progress: BatchProgress): void => callback(progress)
      ipcRenderer.on('batch:progress', listener)
      return () => ipcRenderer.removeListener('batch:progress', listener)
    },
    onDone: (callback: (summary: BatchSummary) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, summary: BatchSummary): void => callback(summary)
      ipcRenderer.on('batch:done', listener)
      return () => ipcRenderer.removeListener('batch:done', listener)
    }
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
