import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The operational skill is the launch site for every Lighthouse cold/warm run:
// prepareSession copies it into .makefaster/SKILL.md and every provider's agent
// follows it verbatim. These tests pin the browser-isolation contract — the
// measurement browser is a dedicated headless Chrome with its own profile,
// never the user's everyday browser — so a future edit cannot quietly put
// Lighthouse tabs back into the user's open Chrome.
const SKILL_PATH = join(
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."),
  "packages", "skill", "SKILL.md",
);
const SKILL = readFileSync(SKILL_PATH, "utf8");
const BROKER = readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "lib", "measurementBroker.js"), "utf8");

test("the skill sends Lighthouse through the outer measurement broker", () => {
  assert.match(SKILL, /node \.makefaster\/measure\.mjs <url> > <report\.json>/);
  assert.match(SKILL, /outside the coding\s+agent's sandbox/);
  assert.match(SKILL, /Never replace\s+this command with `npx lighthouse`, Playwright, Puppeteer, a raw Chrome/);
});

test("the broker pins a dedicated headless Chrome with an isolated profile", () => {
  for (const flag of ["--headless=new", "--user-data-dir=./.makefaster/chrome-profile", "--no-first-run", "--no-default-browser-check"]) {
    assert.match(BROKER, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${flag} must be broker-owned`);
  }
  assert.match(BROKER, /shell: false/, "Lighthouse arguments must never pass through a shell");
});

test("the skill never reuses an existing Chrome debugging port or the user's profile", () => {
  // No example anywhere in the document may attach to an already-running
  // Chrome — that is exactly how measurement tabs end up in the user's browser.
  assert.doesNotMatch(SKILL, /lighthouse[^\n]*--port=\d/, "no Lighthouse example may attach by port");
  assert.match(SKILL, /[Nn]ever bypass the managed client or pass `--port`/, "the port-reuse ban must be explicit");
  assert.match(
    SKILL,
    /Never replace\s+this command with[^]*`connect`, or `connectOverCDP`/,
    "the agent must not bypass the managed browser path",
  );
  assert.match(
    SKILL,
    /must never attach to the user's everyday Chrome/,
    "the isolation requirement must be stated as a rule, not implied",
  );
});

test("CHROME_PATH still means our own headless launch with our own profile", () => {
  assert.match(
    SKILL,
    /`CHROME_PATH`[^]*?still launches it headless with the\s+isolated `--user-data-dir`/,
    "CHROME_PATH picks the binary; it must never mean reusing the user's session",
  );
});

test("the isolation rule covers every measurement, cold and warm, baseline and re-measure", () => {
  assert.match(SKILL, /cold and warm alike, baseline and re-measure alike/);
});
