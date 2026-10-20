import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AiChunk, AnalyzeProgress, AppApi } from '../shared/types'

const api: AppApi = {
  pickArchive: () => ipcRenderer.invoke('dialog:pick-archive'),

  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
    test: (settings) => ipcRenderer.invoke('settings:test', settings)
  },

  analysis: {
    run: (request) => ipcRenderer.invoke('analysis:run', request),
    runDir: (request) => ipcRenderer.invoke('analysis:run-dir', request),
    pickDir: () => ipcRenderer.invoke('dialog:pick-game-dir'),
    ai: (request) => ipcRenderer.invoke('analysis:ai', request),
    cancel: () => ipcRenderer.invoke('analysis:cancel'),
    lines: (request) => ipcRenderer.invoke('analysis:lines', request),
    onProgress: (cb: (event: AnalyzeProgress) => void) => {
      const listener = (_event: unknown, payload: AnalyzeProgress): void => cb(payload)
      ipcRenderer.on('analysis:progress', listener)
      return () => ipcRenderer.removeListener('analysis:progress', listener)
    },
    onAiChunk: (cb: (chunk: AiChunk) => void) => {
      const listener = (_event: unknown, payload: AiChunk): void => cb(payload)
      ipcRenderer.on('analysis:chunk', listener)
      return () => ipcRenderer.removeListener('analysis:chunk', listener)
    }
  },

  launcher: {
    pick: () => ipcRenderer.invoke('dialog:pick-launcher'),
    get: () => ipcRenderer.invoke('launcher:get'),
    refresh: (integration) => ipcRenderer.invoke('launcher:refresh', integration)
  },

  java: {
    list: () => ipcRenderer.invoke('java:list'),
    scan: () => ipcRenderer.invoke('java:scan')
  },

  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
