import { app, BrowserWindow, desktopCapturer, ipcMain, safeStorage, session, shell, systemPreferences } from "electron";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { boardToHtml, designCard, gateBoard, planBoard, setProduct, type BoardItem, type CardMeta, type PlanOp } from "./board";
import { loadProduct } from "./product";

// Dev convenience: load API keys from a gitignored .env next to package.json (packaged builds use Settings).
if (!app.isPackaged) {
  try {
    for (const line of readFileSync(path.join(app.getAppPath(), ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const recordingsRoot = () => path.join(app.getPath("documents"), "Bestie");
const configPath = () => path.join(app.getPath("userData"), "config.json");

type KeyName = "elevenlabs" | "groq" | "anthropic" | "openrouter";
const ENV_KEYS: Record<KeyName, string> = {
  elevenlabs: "ELEVENLABS_API_KEY",
  groq: "GROQ_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

interface Config {
  keys?: Partial<Record<KeyName, string>>; // encrypted with safeStorage, base64
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

async function getApiKey(name: KeyName): Promise<string> {
  const fromEnv = process.env[ENV_KEYS[name]];
  if (fromEnv) return fromEnv;
  const apiKey = (await readConfig()).keys?.[name];
  if (!apiKey) return "";
  try {
    return safeStorage.decryptString(Buffer.from(apiKey, "base64"));
  } catch {
    return "";
  }
}

let currentFolder: string | null = null;
let lastFolder: string | null = null;
let currentTitle = "";

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function registerIpc() {
  ipcMain.handle("settings:get", async () => {
    const config = await readConfig();
    return {
      hasElevenLabsKey: (await getApiKey("elevenlabs")) !== "",
      hasGroqKey: (await getApiKey("groq")) !== "",
      hasAnthropicKey: (await getApiKey("anthropic")) !== "",
      hasOpenRouterKey: (await getApiKey("openrouter")) !== "",
      language: config.language ?? "auto",
    };
  });

  ipcMain.handle("settings:set-api-key", async (_e, name: KeyName, key: string) => {
    const config = await readConfig();
    config.keys = { ...config.keys, [name]: key ? safeStorage.encryptString(key).toString("base64") : undefined };
    await writeConfig(config);
  });

  ipcMain.handle("settings:set-language", async (_e, language: string) => {
    await writeConfig({ ...(await readConfig()), language });
  });

  // The renderer's WebSocket can't send the xi-api-key header, so it connects with a single-use token instead.
  ipcMain.handle("scribe:token", async () => {
    const apiKey = await getApiKey("elevenlabs");
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
    currentTitle = `Spotkanie ${stamp}`;
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

  // Without an OpenRouter key there is no gate: every change goes straight to the planner.
  ipcMain.handle("board:gate", async (_e, recent: string, board: CardMeta[]) => {
    const apiKey = await getApiKey("openrouter");
    return apiKey ? gateBoard(apiKey, recent, board) : null;
  });

  ipcMain.handle("board:plan", async (_e, transcript: string, board: CardMeta[], hint: string) => {
    const keys = { groq: await getApiKey("groq"), anthropic: await getApiKey("anthropic") };
    if (!keys.groq && !keys.anthropic) throw new Error("Brak klucza Claude ani Groq — tablica wyłączona.");
    return planBoard(keys, transcript, board, hint);
  });

  // One in-flight drawing per card; a newer version of the same card cancels the old one.
  const drawing = new Map<string, AbortController>();
  ipcMain.handle("board:design", async (e, op: PlanOp, base: string, transcript: string) => {
    const keys = { groq: await getApiKey("groq"), anthropic: await getApiKey("anthropic") };
    drawing.get(op.id)?.abort();
    const controller = new AbortController();
    drawing.set(op.id, controller);
    try {
      return await designCard(
        keys,
        op,
        base,
        transcript,
        (html) => !controller.signal.aborted && e.sender.send("board:partial", op.id, html),
        controller.signal,
      );
    } catch (err) {
      if (controller.signal.aborted) return null; // superseded
      throw err;
    } finally {
      if (drawing.get(op.id) === controller) drawing.delete(op.id);
    }
  });

  ipcMain.handle("product:load", async (_e, url: string) => {
    const product = await loadProduct(/^https?:\/\//.test(url) ? url : `https://${url}`);
    setProduct(product);
    return product;
  });
  ipcMain.handle("product:clear", () => setProduct(null));

  ipcMain.handle("board:save", async (_e, board: BoardItem[]) => {
    if (!currentFolder) return;
    await writeFile(path.join(currentFolder, "tablica.json"), JSON.stringify(board, null, 2));
    await writeFile(path.join(currentFolder, "tablica.html"), boardToHtml(currentTitle, board));
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
    width: 1360,
    height: 820,
    minWidth: 820,
    minHeight: 420,
    title: "Bestie",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // The window is usually hidden behind the call app; timers must keep running for the board and replay.
      backgroundThrottling: false,
    },
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
