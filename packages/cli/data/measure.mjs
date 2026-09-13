#!/usr/bin/env node

const endpoint = process.env.MAKEFASTER_MEASUREMENT_URL;
const token = process.env.MAKEFASTER_MEASUREMENT_TOKEN;
const [url, ...extra] = process.argv.slice(2);

function fail(message) {
  process.stderr.write(`makefaster measurement: ${message}\n`);
  process.exit(1);
}

if (!endpoint || !token) fail("the outer makefaster measurement broker is not running");
if (!url || extra.length > 0) fail("usage: node .makefaster/measure.mjs <http-or-https-url>");

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ url }),
  });
  const result = await response.json();
  if (!response.ok) fail(result?.error || `broker returned HTTP ${response.status}`);

  if (result.stderr) process.stderr.write(Buffer.from(result.stderr, "base64"));
  if (result.stdout) process.stdout.write(Buffer.from(result.stdout, "base64"));
  process.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : 1;
} catch (error) {
  fail(error.message);
}
