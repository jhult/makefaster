import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { lighthouseSpawnSpec, startMeasurementBroker } from "../lib/measurementBroker.js";

function fakeSpawner(records) {
  return (command, args, options) => {
    records.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => child.emit("close", null, "SIGTERM");
    setImmediate(() => {
      child.stdout.end('{"categories":{"performance":{"score":1}}}\n');
      child.stderr.end("lighthouse notice\n");
      child.emit("close", 0, null);
    });
    return child;
  };
}

test("the broker exposes one authenticated URL-only Lighthouse operation", async () => {
  const records = [];
  const broker = await startMeasurementBroker({
    cwd: "/repo",
    env: { PATH: "/usr/bin", CHROME_PATH: "/Applications/Google Chrome" },
    spawnImpl: fakeSpawner(records),
  });

  try {
    const unauthorized = await fetch(broker.env.MAKEFASTER_MEASUREMENT_URL, {
      method: "POST",
      body: JSON.stringify({ url: "http://localhost:3000/" }),
    });
    assert.equal(unauthorized.status, 401);

    const response = await fetch(broker.env.MAKEFASTER_MEASUREMENT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${broker.env.MAKEFASTER_MEASUREMENT_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "http://localhost:3000/" }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.exitCode, 0);
    assert.match(Buffer.from(result.stdout, "base64").toString(), /"performance"/);
    assert.equal(Buffer.from(result.stderr, "base64").toString(), "lighthouse notice\n");

    assert.equal(records.length, 1);
    assert.equal(records[0].command, "npx");
    assert.deepEqual(records[0].args, [
      "--yes",
      "lighthouse",
      "http://localhost:3000/",
      "--output=json",
      "--quiet",
      "--chrome-flags=--headless=new --user-data-dir=./.makefaster/chrome-profile --no-first-run --no-default-browser-check",
    ]);
    assert.equal(records[0].options.cwd, "/repo");
    assert.equal(records[0].options.shell, false);
    assert.equal(records[0].options.env.CHROME_PATH, "/Applications/Google Chrome");
  } finally {
    await broker.close();
  }
});

test("the Lighthouse spawn contract rejects non-web URLs", () => {
  assert.throws(() => lighthouseSpawnSpec({ url: "file:///etc/passwd", cwd: "/repo" }), /http or https/);
  assert.throws(() => lighthouseSpawnSpec({ url: "javascript:alert(1)", cwd: "/repo" }), /http or https/);
});
