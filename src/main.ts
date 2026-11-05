import { app, BrowserWindow, desktopCapturer, ipcMain, safeStorage, session, shell, systemPreferences } from "electron";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const recordingsRoot = () => path.join(app.getPath("documents"), "Bestie");
const configPath = () => path.join(app.getPath("userData"), "config.json");

interface Config {
  apiKey?: string; // encrypted with safeStorage, base64
  language?: string;
}

async function readConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(configPath(), "utf8"));
  } catch {
    return {};
  }
}

async function writeConfig(config: Config) {
  await mkdir(path.dirname(configPath()), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

async function getApiKey(): Promise<string> {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const { apiKey } = await readConfig();
  if (!apiKey) return "";
  try {
    return safeStorage.decryptString(Buffer.from(apiKey, "base64"));
  } catch {
    return "";
  }
}

let currentFolder: string | null = null;
let lastFolder: string | null = null;

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function registerIpc() {
  ipcMain.handle("settings:get", async () => {
    const config = await readConfig();
    return { hasApiKey: (await getApiKey()) !== "", language: config.language ?? "auto" };
  });

  ipcMain.handle("settings:set-api-key", async (_e, key: string) => {
    const config = await readConfig();
    config.apiKey = key ? safeStorage.encryptString(key).toString("base64") : undefined;
    await writeConfig(config);
  });

  ipcMain.handle("settings:set-language", async (_e, language: string) => {
    await writeConfig({ ...(await readConfig()), language });
  });

  // The renderer's WebSocket can't send the xi-api-key header, so it connects with a single-use token instead.
  ipcMain.handle("scribe:token", async () => {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("Brak klucza API ElevenLabs.");
    const res = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
    });
    if (!res.ok) throw new Error(`ElevenLabs token: HTTP ${res.status} ${await res.text()}`);
    const { token } = (await res.json()) as { token: string };
    return token;
  });

  ipcMain.handle("session:start", async () => {
    const stamp = timestamp();
    currentFolder = path.join(recordingsRoot(), stamp);
    await mkdir(currentFolder, { recursive: true });
    await writeFile(path.join(currentFolder, "transkrypcja.md"), `# Spotkanie ${stamp}\n\n`);
    return currentFolder;
  });

  ipcMain.handle("session:transcript", async (_e, line: string) => {
    if (currentFolder) await appendFile(path.join(currentFolder, "transkrypcja.md"), line);
  });

  ipcMain.handle("session:audio", async (_e, chunk: ArrayBuffer) => {
    if (currentFolder) await appendFile(path.join(currentFolder, "spotkanie.webm"), Buffer.from(chunk));
  });

  ipcMain.handle("session:finish", () => {
    lastFolder = currentFolder;
    currentFolder = null;
    return lastFolder;
  });

  ipcMain.handle("session:reveal", async () => {
    const target = lastFolder ?? recordingsRoot();
    await mkdir(target, { recursive: true });
    await shell.openPath(target);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 760,
    height: 620,
    minWidth: 520,
    minHeight: 420,
    title: "Bestie",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(async () => {
  registerIpc();

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "display-capture");
  });

  // getDisplayMedia() in the renderer → whole screen + system audio loopback, no picker.
  // On macOS 14.2+ Electron captures the audio via a Core Audio tap (needs NSAudioCaptureUsageDescription).
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const [screen] = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    callback(screen ? { video: screen, audio: "loopback" } : {});
  });

  if (process.platform === "darwin") {
    await systemPreferences.askForMediaAccess("microphone");
  }

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
