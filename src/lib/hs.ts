/** preload 暴露的 IPC 接口的类型包装。 */

export type InstalledMap = Record<string, string | boolean>;

export type InstallResult = {
  ok: boolean;
  code: number;
  out: string;
  timedOut: boolean;
  installed: InstalledMap;
  error?: string;
};

/** 重启 Codex：out 是 PowerShell 的原样输出，失败时 error 里带可读原因。 */
export type RestartResult = { ok: boolean; code?: number; out?: string; error?: string };

export type Skill = { name: string; desc: string; enabled: boolean };

export type AppState = {
  installed: InstalledMap;
  autoInstall: boolean;
  version: string;
  upload: UploadSettings;
};

export type UploadSettings = {
  enabled: boolean;
  watch: boolean;
  endpoint: string;
  tokenConfigured: boolean;
  directory: string;
};

export type LogPayload = { label: string; text: string };
export type StatusPayload = { label: string; state: "running" | "idle" };
export type NotifyPayload = { level: "info" | "warn"; text: string };

export type HsApi = {
  state(): Promise<AppState>;
  install(targetId: string, promptFile: string): Promise<InstallResult>;
  uninstall(targetId: string): Promise<InstallResult>;
  restartCodex(): Promise<RestartResult>;
  listSkills(): Promise<Skill[]>;
  saveSkills(disabled: string[]): Promise<{ ok: boolean; error?: string }>;
  setAutoInstall(value: boolean): Promise<{ autoInstall: boolean }>;
  setUploadSettings(settings: {
    enabled?: boolean;
    watch?: boolean;
    endpoint?: string;
    token?: string;
  }): Promise<{ ok: boolean; upload?: UploadSettings; error?: string }>;
  openQQ(url: string): Promise<{ ok: boolean }>;
  quit(): Promise<{ ok: boolean }>;
  win(action: "minimize" | "maximize" | "close"): Promise<{ ok: boolean }>;
  onLog(cb: (p: LogPayload) => void): () => void;
  onStatus(cb: (p: StatusPayload) => void): () => void;
  onNotify(cb: (p: NotifyPayload) => void): () => void;
};

declare global {
  interface Window {
    hs: HsApi;
  }
}

export const hs: HsApi = window.hs;
