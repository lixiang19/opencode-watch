#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import net from "node:net";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const localBackendBin = path.join(projectRoot, "scripts", "local-backend.js");
const require = createRequire(import.meta.url);

const viteBin = resolvePackageFile("vite", "bin/vite.js");
const vueTscBin = resolvePackageFile("vue-tsc", "bin/vue-tsc.js");

const command = process.argv[2] ?? "dev";
const extraArgs = process.argv.slice(3);

if (["help", "--help", "-h"].includes(command)) {
  printHelp();
  process.exit(0);
}

try {
  switch (command) {
    case "dev":
      await runDev(extraArgs);
      break;
    case "web":
      await runWeb(extraArgs);
      break;
    case "build":
      await runNodeTool(vueTscBin, ["-b"]);
      await runNodeTool(viteBin, ["build", ...extraArgs]);
      break;
    case "preview":
      await runPreview(extraArgs);
      break;
    case "doctor":
      await runDoctor();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function runDev(args) {
  const webChild = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", vitePort(), "--strictPort", ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });

  const backendChild = spawnLocalBackend({ OPCHAT_STATIC_MODE: "off" });
  const opencodeChild = await ensureOpencodeServe();
  await runManagedProcesses([backendChild, webChild, opencodeChild].filter(Boolean));
}

async function runWeb(args) {
  await runNodeTool(vueTscBin, ["-b"]);
  await runNodeTool(viteBin, ["build", ...args]);

  const opencodeChild = await ensureOpencodeServe();
  await runManagedProcesses([
    spawnLocalBackend({ OPCHAT_STATIC_MODE: "on" }),
    opencodeChild,
  ].filter(Boolean));
}

async function runPreview(args) {
  const opencodeChild = await ensureOpencodeServe();
  await runManagedProcesses([
    spawnLocalBackend({ OPCHAT_STATIC_MODE: "on" }),
    opencodeChild,
  ].filter(Boolean));
}

function spawnLocalBackend(extraEnv = {}) {
  return spawn(process.execPath, [localBackendBin], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
}

function spawnOpencodeServe() {
  return spawn("opencode", buildOpencodeServeArgs(), {
    cwd: opencodeRoot(),
    stdio: "inherit",
    env: process.env,
  });
}

async function ensureOpencodeServe() {
  if (await canReachOpencodeServer()) {
    console.log(`[opchat] reuse existing opencode serve on ${opencodeBaseUrl()}`);
    return null;
  }

  if (await isPortOccupied(opencodePort())) {
    throw new Error(`端口 ${opencodePort()} 已被占用，但现有服务不是可用的 opencode serve，请先释放端口或修改 OPENCODE_SERVER_PORT。`);
  }

  const child = spawnOpencodeServe();
  await waitForOpencodeReady(child);
  return child;
}

async function runManagedProcesses(children) {
  let exiting = false;

  const cleanup = (signal) => {
    if (exiting) {
      return;
    }

    exiting = true;
    for (const child of children) {
      if (!child.killed) {
        child.kill(signal);
      }
    }
  };

  process.on("SIGINT", () => cleanup("SIGINT"));
  process.on("SIGTERM", () => cleanup("SIGTERM"));
  process.on("exit", () => cleanup("SIGTERM"));

  await Promise.race(children.map((child) => waitForExit(child)));
  cleanup("SIGTERM");
}

async function runDoctor() {
  const checks = [
    {
      label: "Node.js",
      ok: Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10) >= 18,
      detail: `v${process.versions.node}`,
    },
    {
      label: "vite bin",
      ok: fs.existsSync(viteBin),
      detail: viteBin,
    },
    {
      label: "vue-tsc bin",
      ok: fs.existsSync(vueTscBin),
      detail: vueTscBin,
    },
    {
      label: "local backend",
      ok: fs.existsSync(localBackendBin),
      detail: localBackendBin,
    },
    {
      label: "opencode",
      ...(await commandStatus("opencode", ["--version"])),
    },
    {
      label: "OPCHAT_BACKEND_PORT",
      ok: isPort(backendPort()),
      detail: backendPort(),
    },
    {
      label: "VITE_PORT",
      ok: isPort(vitePort()),
      detail: vitePort(),
    },
    {
      label: "OPENCODE_SERVER_PORT",
      ok: isPort(opencodePort()),
      detail: opencodePort(),
    },
    {
      label: "OPENCODE_SERVER_ROOT",
      ok: fs.existsSync(opencodeRoot()),
      detail: opencodeRoot(),
    },
  ];

  for (const check of checks) {
    console.log(`${check.ok ? "OK" : "FAIL"}  ${check.label}: ${check.detail}`);
  }

  if (checks.some((check) => !check.ok)) {
    process.exit(1);
  }
}

function runNodeTool(binPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: projectRoot,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Command exited with signal ${signal}`));
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command exited with code ${code ?? 1}`));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForOpencodeReady(child) {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.killed) {
      throw new Error(`opencode serve 启动失败，退出码 ${child.exitCode ?? 1}`);
    }

    if (await canReachOpencodeServer()) {
      console.log(`[opchat] opencode serve ready on ${opencodeBaseUrl()}`);
      return;
    }

    await wait(400);
  }

  child.kill("SIGTERM");
  throw new Error(`等待 opencode serve 就绪超时：${opencodeBaseUrl()}`);
}

async function canReachOpencodeServer() {
  try {
    const response = await fetch(`${opencodeBaseUrl()}/global/health`);
    return response.status < 500;
  } catch {
    return false;
  }
}

function isPortOccupied(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: Number(port) });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

function commandStatus(commandName, args) {
  return new Promise((resolve) => {
    const child = spawn(commandName, args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let output = "";

    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });

    child.on("error", () => {
      resolve({ ok: false, detail: "command not found" });
    });

    child.on("exit", (code) => {
      resolve({
        ok: code === 0,
        detail: output.trim() || `exit code ${code ?? 1}`,
      });
    });
  });
}

function isPort(value) {
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function vitePort() {
  return process.env.VITE_PORT ?? "9000";
}

function backendPort() {
  return process.env.OPCHAT_BACKEND_PORT ?? "9001";
}

function opencodePort() {
  return process.env.OPENCODE_SERVER_PORT ?? "4096";
}

function opencodeBaseUrl() {
  return `http://127.0.0.1:${opencodePort()}`;
}

function opencodeRoot() {
  return process.env.OPENCODE_SERVER_ROOT ?? process.env.HOME ?? projectRoot;
}

function buildOpencodeServeArgs() {
  const args = ["serve", "--hostname", "0.0.0.0", "--port", opencodePort()];
  for (const origin of opencodeCorsOrigins()) {
    args.push("--cors", origin);
  }

  return args;
}

function opencodeCorsOrigins() {
  const origins = new Set([
    `http://localhost:${vitePort()}`,
    `http://127.0.0.1:${vitePort()}`,
    `http://localhost:${backendPort()}`,
    `http://127.0.0.1:${backendPort()}`,
    "http://localhost:5173",
  ]);

  for (const origin of extraOpencodeCorsOrigins()) {
    origins.add(origin);
  }

  return [...origins].filter(Boolean);
}

function extraOpencodeCorsOrigins() {
  const raw = process.env.OPCHAT_OPENCODE_CORS ?? "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePackageFile(packageName, relativePath) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  return path.join(path.dirname(packageJsonPath), relativePath);
}

function printHelp() {
  console.log(`opchat <command>\n\nCommands:\n  dev      Start local backend, Vite dev server, and opencode serve\n  web      Build and start the production web server plus opencode serve\n  build    Type-check and build the web app\n  preview  Start the production web server plus opencode serve\n  doctor   Check local runtime dependencies\n  help     Show this help message`);
}
