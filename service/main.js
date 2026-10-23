// service/main.ts
import http from "node:http";
import { spawn } from "node:child_process";
import fsp2 from "node:fs/promises";
import path2 from "node:path";

// src/apps.ts
var MAC_APPS = [
  { id: "vscode", name: "Visual Studio Code", icon: "vscode", macApp: "Visual Studio Code", command: "code", preferCommand: true },
  { id: "cursor", name: "Cursor", icon: "cursor", macApp: "Cursor", command: "cursor", preferCommand: true },
  { id: "zed", name: "Zed", icon: "zed", macApp: "Zed", command: "zed", preferCommand: true },
  { id: "sublime-text", name: "Sublime Text", icon: "sublime-text", macApp: "Sublime Text", command: "subl", preferCommand: true },
  { id: "textmate", name: "TextMate", icon: "textmate", macApp: "TextMate" },
  { id: "antigravity", name: "Antigravity", icon: "antigravity", macApp: "Antigravity" },
  { id: "xcode", name: "Xcode", icon: "xcode", macApp: "Xcode" },
  { id: "android-studio", name: "Android Studio", icon: "android-studio", macApp: "Android Studio" },
  { id: "iterm2", name: "iTerm2", icon: "iterm2", macApp: "iTerm" },
  { id: "ghostty", name: "Ghostty", icon: "ghostty", macApp: "Ghostty", command: "ghostty" },
  { id: "warp", name: "Warp", icon: "warp", macApp: "Warp", command: "warp" },
  { id: "terminal", name: "Terminal", labelKey: "app.terminal", icon: "terminal", macApp: "Terminal" },
  { id: "file-manager", name: "Finder", labelKey: "app.fileManager", icon: "file-manager", macApp: "Finder" }
];
var WINDOWS_APPS = [
  { id: "vscode", name: "Visual Studio Code", icon: "vscode", command: "code" },
  { id: "cursor", name: "Cursor", icon: "cursor", command: "cursor" },
  { id: "zed", name: "Zed", icon: "zed", command: "zed" },
  { id: "sublime-text", name: "Sublime Text", icon: "sublime-text", command: "subl" },
  { id: "powershell", name: "PowerShell", icon: "powershell", command: "powershell" },
  { id: "file-manager", name: "File Explorer", labelKey: "app.fileManager", icon: "file-manager", command: "explorer" }
];
var LINUX_APPS = [
  { id: "vscode", name: "Visual Studio Code", icon: "vscode", command: "code" },
  { id: "cursor", name: "Cursor", icon: "cursor", command: "cursor" },
  { id: "zed", name: "Zed", icon: "zed", command: "zed" },
  { id: "sublime-text", name: "Sublime Text", icon: "sublime-text", command: "subl" },
  { id: "file-manager", name: "Files", labelKey: "app.fileManager", icon: "file-manager", command: "xdg-open" }
];
var appsForOS = (os) => {
  if (os === "macos")
    return MAC_APPS;
  if (os === "windows")
    return WINDOWS_APPS;
  if (os === "linux")
    return LINUX_APPS;
  return [];
};
var findApp = (os, id) => appsForOS(os).find((app) => app.id === id) ?? null;

// service/logger.ts
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
var LOG_DIR = path.join(os.homedir(), ".config", "openchamber-openwith", "logs");
var LOG_FILE = path.join(LOG_DIR, "service.log");
var MAX_BYTES = 10 * 1024 * 1024;
var MAX_BACKUPS = 3;
var size = -1;
var queue = Promise.resolve();
var rotate = async () => {
  for (let i = MAX_BACKUPS - 1;i >= 1; i -= 1) {
    await fsp.rename(`${LOG_FILE}.${i}`, `${LOG_FILE}.${i + 1}`).catch(() => {
      return;
    });
  }
  await fsp.rename(LOG_FILE, `${LOG_FILE}.1`).catch(() => {
    return;
  });
};
var append = async (line) => {
  try {
    if (size < 0) {
      await fsp.mkdir(LOG_DIR, { recursive: true });
      size = (await fsp.stat(LOG_FILE).catch(() => null))?.size ?? 0;
    }
    const bytes = Buffer.byteLength(line);
    if (size + bytes > MAX_BYTES) {
      await rotate();
      size = 0;
    }
    await fsp.appendFile(LOG_FILE, line);
    size += bytes;
  } catch {}
};
var log = (message) => {
  const line = `${new Date().toISOString()} ${message}
`;
  process.stderr.write(`[openwith] ${message}
`);
  queue = queue.then(() => append(line));
};

// service/main.ts
var PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN ?? "";
if (!PORT || !TOKEN) {
  process.stderr.write(`OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required
`);
  process.exit(1);
}
var os2 = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
var DETECTION_TTL_MS = 30000;
var detection = null;
var onPath = (command) => new Promise((resolve) => {
  const finder = process.platform === "win32" ? "where" : "which";
  let child;
  try {
    child = spawn(finder, [command], { stdio: "ignore", windowsHide: true });
  } catch {
    resolve(false);
    return;
  }
  child.on("error", () => resolve(false));
  child.on("close", (code) => resolve(code === 0));
});
var macBundleExists = async (name) => {
  const candidates = [
    `/Applications/${name}.app`,
    `/Applications/Utilities/${name}.app`,
    `/System/Applications/${name}.app`,
    `/System/Applications/Utilities/${name}.app`,
    `/System/Library/CoreServices/${name}.app`
  ];
  const home = process.env.HOME;
  if (home)
    candidates.push(path2.join(home, "Applications", `${name}.app`));
  for (const candidate of candidates) {
    try {
      if ((await fsp2.stat(candidate)).isDirectory())
        return true;
    } catch {}
  }
  return false;
};
var appInstalled = async (app) => {
  if (os2 === "macos") {
    if (app.macApp && await macBundleExists(app.macApp))
      return true;
    if (app.command && await onPath(app.command))
      return true;
    return false;
  }
  if (app.command)
    return onPath(app.command);
  return false;
};
var detect = async () => {
  const apps = appsForOS(os2);
  const flags = await Promise.all(apps.map((app) => appInstalled(app)));
  const installed = {};
  apps.forEach((app, index) => {
    installed[app.id] = flags[index];
  });
  detection = { at: Date.now(), installed };
  const found = apps.filter((app, index) => flags[index]).map((app) => app.id);
  log(`detected installed apps: ${found.length > 0 ? found.join(", ") : "(none)"}`);
  return detection;
};
var detectCached = (force) => {
  if (!force && detection && Date.now() - detection.at < DETECTION_TTL_MS) {
    return Promise.resolve(detection);
  }
  return detect();
};
var isWindowsBatch = (command) => new Promise((resolve) => {
  let child;
  try {
    child = spawn("where", [command], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  } catch {
    resolve(false);
    return;
  }
  let out = "";
  child.stdout?.on("data", (chunk) => {
    if (out.length < 4000)
      out += chunk.toString();
  });
  child.once("error", () => resolve(false));
  child.once("close", () => {
    resolve(out.split(/\r?\n/).some((line) => /\.(cmd|bat)\s*$/i.test(line)));
  });
});
var quoteWindows = (value) => `"${value.replace(/"/g, '""')}"`;
var planFor = async (command, args) => {
  if (os2 === "windows" && await isWindowsBatch(command)) {
    return {
      file: [command, ...args].map(quoteWindows).join(" "),
      args: [],
      shell: true,
      windowsHide: true
    };
  }
  return { file: command, args, shell: false, windowsHide: false };
};
var launchPlan = async (app, directory) => {
  if (app.command && (os2 !== "macos" || app.preferCommand)) {
    return planFor(app.command, [directory]);
  }
  if (os2 === "macos" && app.macApp) {
    return { file: "open", args: ["-a", app.macApp, directory], shell: false, windowsHide: false };
  }
  if (app.command)
    return planFor(app.command, [directory]);
  return null;
};
var DRY_RUN = process.env.OPENCHAMBER_OPENWITH_DRY_RUN === "1";
var LAUNCH_TIMEOUT_MS = 4000;
var launch = (plan) => new Promise((resolve, reject) => {
  if (DRY_RUN) {
    console.error(`[openwith] dry-run ${JSON.stringify(plan)}`);
    resolve();
    return;
  }
  let child;
  try {
    child = spawn(plan.file, plan.args, {
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
      shell: plan.shell,
      windowsHide: plan.windowsHide
    });
  } catch (error) {
    reject(error);
    return;
  }
  let settled = false;
  let timer;
  let stderr = "";
  const finish = (error) => {
    if (settled)
      return;
    settled = true;
    clearTimeout(timer);
    if (error) {
      reject(error);
    } else {
      child.unref();
      resolve();
    }
  };
  child.stderr?.on("data", (chunk) => {
    if (stderr.length < 4000)
      stderr += chunk.toString();
  });
  child.once("error", (error) => finish(error));
  child.once("exit", (code) => {
    if (code === 0)
      finish();
    else
      finish(new Error(stderr.trim() || `exited with code ${code}`));
  });
  timer = setTimeout(() => finish(), LAUNCH_TIMEOUT_MS);
  timer.unref?.();
});
var json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
var readBody = (req) => new Promise((resolve, reject) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1e6)
      reject(new Error("request too large"));
  });
  req.on("end", () => resolve(body));
  req.on("error", reject);
});
var resolveDirectory = (value) => {
  if (typeof value !== "string" || !value.trim())
    return null;
  const resolved = path2.resolve(value);
  return path2.isAbsolute(resolved) ? resolved : null;
};
var server = http.createServer((req, res) => {
  (async () => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      json(res, 200, { ok: true, pid: process.pid });
      return;
    }
    if (url.pathname === "/apps" && req.method === "GET") {
      const force = url.searchParams.get("refresh") === "1";
      const result = await detectCached(force);
      json(res, 200, { ok: true, os: os2, installed: result.installed, at: result.at });
      return;
    }
    if (url.pathname === "/open" && req.method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      const directory = resolveDirectory(body.directory);
      const appId = typeof body.app === "string" ? body.app : "";
      if (!directory || !appId) {
        log(`open refused: invalid-request (directory=${String(body.directory)} app=${appId || "(none)"})`);
        json(res, 400, { ok: false, error: "invalid-request" });
        return;
      }
      let stat;
      try {
        stat = await fsp2.stat(directory);
      } catch {
        log(`open refused: no-directory (${directory})`);
        json(res, 404, { ok: false, error: "no-directory" });
        return;
      }
      if (!stat.isDirectory()) {
        log(`open refused: not-a-directory (${directory})`);
        json(res, 400, { ok: false, error: "not-a-directory" });
        return;
      }
      const app = findApp(os2, appId);
      if (!app) {
        log(`open refused: unknown-app (${appId})`);
        json(res, 400, { ok: false, error: "unknown-app" });
        return;
      }
      const plan = await launchPlan(app, directory);
      if (!plan) {
        log(`open refused: unsupported (${app.id})`);
        json(res, 400, { ok: false, error: "unsupported" });
        return;
      }
      const state = await detectCached(false);
      if (!state.installed[app.id]) {
        log(`open refused: not-installed (${app.id})`);
        json(res, 409, { ok: false, error: "not-installed" });
        return;
      }
      try {
        log(`launching ${app.id}: ${plan.file} ${plan.args.join(" ")}`);
        await launch(plan);
        log(`launched ${app.id} for ${directory}`);
        json(res, 200, { ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`launch failed for ${app.id}: ${message}`);
        json(res, 502, { ok: false, error: message });
      }
      return;
    }
    json(res, 404, { error: "not-found" });
  })().catch((error) => {
    log(`request failed: ${error instanceof Error ? error.message : String(error)}`);
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : "failed" });
  });
});
server.listen(PORT, "127.0.0.1");
log(`service started (pid ${process.pid}, port ${PORT}, os ${os2}${DRY_RUN ? ", dry-run" : ""})`);
log(`logs: ${LOG_FILE}`);
var shutdown = () => {
  log("service stopping");
  server.close(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
