/**
 * Run Lighthouse in the outer makefaster process, not in the agent process.
 *
 * Agent CLIs may sandbox their command children. On macOS, unified headless
 * Chrome still registers with LaunchServices, so a Chrome inherited from a
 * workspace-only Seatbelt sandbox aborts before Lighthouse can connect. This
 * loopback broker keeps the coding agent sandboxed while giving it one narrow
 * operation outside that sandbox: audit one http(s) URL with makefaster's
 * fixed, isolated Chrome profile.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const BODY_LIMIT = 8 * 1024;
const OUTPUT_LIMIT = 32 * 1024 * 1024;

export const MEASUREMENT_URL_ENV = "MAKEFASTER_MEASUREMENT_URL";
export const MEASUREMENT_TOKEN_ENV = "MAKEFASTER_MEASUREMENT_TOKEN";

function authorized(header, token) {
  const supplied = Buffer.from(String(header || ""));
  const expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("measurement request is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("measurement request must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function validateUrl(value) {
  if (typeof value !== "string" || value.length > 4096) {
    throw new Error("measurement URL must be a string no longer than 4096 characters");
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("measurement URL must use http or https");
  }
  return parsed.href;
}

/** The exact Lighthouse invocation owned by makefaster. */
export function lighthouseSpawnSpec({ url, cwd, env = process.env, platform = process.platform }) {
  const chromeFlags = [
    "--headless=new",
    "--user-data-dir=./.makefaster/chrome-profile",
    "--no-first-run",
    "--no-default-browser-check",
  ].join(" ");
  return {
    command: platform === "win32" ? "npx.cmd" : "npx",
    args: ["--yes", "lighthouse", validateUrl(url), "--output=json", "--quiet", `--chrome-flags=${chromeFlags}`],
    options: {
      cwd,
      env: { ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    },
  };
}

function runLighthouse({ url, cwd, env, spawnImpl, children }) {
  return new Promise((resolve) => {
    const spec = lighthouseSpawnSpec({ url, cwd, env });
    let child;
    try {
      child = spawnImpl(spec.command, spec.args, spec.options);
    } catch (error) {
      resolve({ exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`${error.message}\n`) });
      return;
    }

    children.add(child);
    const stdout = [];
    const stderr = [];
    let outputSize = 0;
    let outputExceeded = false;

    const collect = (target) => (chunk) => {
      outputSize += chunk.length;
      if (outputSize > OUTPUT_LIMIT) {
        outputExceeded = true;
        child.kill("SIGTERM");
        return;
      }
      target.push(chunk);
    };
    child.stdout?.on("data", collect(stdout));
    child.stderr?.on("data", collect(stderr));

    let settled = false;
    const finish = (exitCode, error = null) => {
      if (settled) return;
      settled = true;
      children.delete(child);
      if (error) stderr.push(Buffer.from(`${error.message}\n`));
      if (outputExceeded) stderr.push(Buffer.from(`Lighthouse output exceeded ${OUTPUT_LIMIT} bytes\n`));
      resolve({
        exitCode: outputExceeded ? 1 : exitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    };
    child.on("error", (error) => finish(1, error));
    child.on("close", (code, signal) => finish(code ?? (signal ? 1 : 0)));
  });
}

function writeJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

/**
 * Start the loopback-only broker and return the two environment variables the
 * agent's copied measurement client needs.
 */
export async function startMeasurementBroker({ cwd, env = process.env, spawnImpl = spawn } = {}) {
  const token = randomBytes(32).toString("hex");
  const children = new Set();
  let queue = Promise.resolve();

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/lighthouse") {
      writeJson(response, 404, { error: "not found" });
      return;
    }
    if (!authorized(request.headers.authorization, token)) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    try {
      const payload = await readJson(request);
      const url = validateUrl(payload?.url);
      const pending = queue.then(() => runLighthouse({ url, cwd, env, spawnImpl, children }));
      queue = pending.catch(() => {});
      const result = await pending;
      writeJson(response, 200, {
        exitCode: result.exitCode,
        stdout: result.stdout.toString("base64"),
        stderr: result.stderr.toString("base64"),
      });
    } catch (error) {
      if (!response.headersSent) writeJson(response, 400, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}/lighthouse`;

  return {
    env: {
      [MEASUREMENT_URL_ENV]: endpoint,
      [MEASUREMENT_TOKEN_ENV]: token,
    },
    async close() {
      for (const child of children) child.kill("SIGTERM");
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
