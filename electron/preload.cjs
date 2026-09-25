"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// 渲染进程唯一的对外通道；不开 nodeIntegration。
contextBridge.exposeInMainWorld("hs", {
  state: () => ipcRenderer.invoke("tool:state"),
  install: (targetId, promptFile) => ipcRenderer.invoke("tool:install", targetId, promptFile),
  uninstall: (targetId) => ipcRenderer.invoke("tool:uninstall", targetId),
  restartCodex: () => ipcRenderer.invoke("tool:restartCodex"),
  listSkills: () => ipcRenderer.invoke("tool:skills:list"),
  saveSkills: (disabled) => ipcRenderer.invoke("tool:skills:save", disabled),
  setAutoInstall: (v) => ipcRenderer.invoke("tool:autoInstall", v),
  setUploadSettings: (settings) => ipcRenderer.invoke("tool:upload:settings", settings),
  simulator: {
    state: () => ipcRenderer.invoke("tool:simulator:state"),
    createResult: (payload) => ipcRenderer.invoke("tool:simulator:create-result", payload),
    upload: () => ipcRenderer.invoke("tool:simulator:upload"),
    install: (targetId) => ipcRenderer.invoke("tool:simulator:install", targetId),
    uninstall: (targetId) => ipcRenderer.invoke("tool:simulator:uninstall", targetId),
  },
  openQQ: (url) => ipcRenderer.invoke("tool:openQQ", url),
  quit: () => ipcRenderer.invoke("tool:quit"),
  win: (action) => ipcRenderer.invoke("tool:win", action),

  onLog: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on("tool:log", h);
    return () => ipcRenderer.removeListener("tool:log", h);
  },
  onStatus: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on("tool:status", h);
    return () => ipcRenderer.removeListener("tool:status", h);
  },
  onNotify: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on("tool:notify", h);
    return () => ipcRenderer.removeListener("tool:notify", h);
  },
});
