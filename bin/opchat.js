#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
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
      await runNodeTool(viteBin, ["--host", "0.0.0.0", "--port", vitePort(), "--strictPort", ...extraArgs]);
      break;
    case "build":
      await runNodeTool(vueTscBin, ["-b"]);
      await runNodeTool(viteBin, ["build", ...extraArgs]);
      break;
    case "preview":
      await runNodeTool(viteBin, ["preview", "--host", "0.0.0.0", "--port", vitePort(), "--strictPort", ...extraArgs]);
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
  const children = [];
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

  const opencodeChild = spawn(
    "opencode",
    [
      "serve",
      "--hostname=127.0.0.1",
      `--port=${opencodePort()}`,
      "--cors",
      `http://127.0.0.1:${vitePort()}`,
      "--cors",
      `http://localhost:${vitePort()}`,
    ],
    {
      cwd: opencodeRoot(),
      stdio: "inherit",
      env: process.env,
    },
  );

  const webChild = spawn(process.execPath, [viteBin, "--host", "0.0.0.0", "--port", vitePort(), "--strictPort", ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });

  children.push(opencodeChild, webChild);

  opencodeChild.on("error", () => {
    cleanup("SIGTERM");
    console.error("Failed to start `opencode serve`. Make sure the `opencode` command is installed.");
    process.exit(1);
  });

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
      label: "opencode",
      ...(await commandStatus("opencode", ["--version"])),
    },
    {
      label: "OPENCODE_SERVER_ROOT",
      ok: fs.existsSync(opencodeRoot()),
      detail: opencodeRoot(),
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

function opencodePort() {
  return process.env.OPENCODE_SERVER_PORT ?? "4096";
}

function opencodeRoot() {
  return process.env.OPENCODE_SERVER_ROOT ?? process.env.HOME ?? projectRoot;
}

function resolvePackageFile(packageName, relativePath) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  return path.join(path.dirname(packageJsonPath), relativePath);
}

function printHelp() {
  console.log(`opchat <command>\n\nCommands:\n  dev      Start opencode server and web dev server\n  web      Start only the web dev server\n  build    Type-check and build the web app\n  preview  Preview the production build\n  doctor   Check local runtime dependencies\n  help     Show this help message`);
}
