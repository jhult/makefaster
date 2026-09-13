import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CAST_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "makefaster-loop.cast");
const DEMO_PATH = join(dirname(fileURLToPath(import.meta.url)), "../js/loop-demo.js");

function loadCast() {
  const lines = readFileSync(CAST_PATH, "utf8").trim().split("\n");
  const header = JSON.parse(lines[0]);
  const events = lines.slice(1).map((line) => JSON.parse(line));
  return { header, events };
}

function duration(events) {
  return events.reduce((sum, ev) => sum + ev[0], 0);
}

function plain(s) {
  return String(s).replace(/\u001b\[[0-9;]*m/g, "");
}

function outputText(events) {
  return events
    .filter((ev) => ev[1] === "o" && typeof ev[2] === "string")
    .map((ev) => ev[2])
    .join("");
}

function holdFrame(events) {
  let i = events.length - 1;
  while (i > 0 && events[i][0] === 0) i--;
  return events
    .slice(i)
    .filter((ev) => ev[1] === "o" && typeof ev[2] === "string")
    .map((ev) => plain(ev[2]))
    .join("");
}

test("the homepage recording is a short loop, not the raw hour", () => {
  const { header, events } = loadCast();
  assert.equal(header.version, 3);
  assert.equal(header.term.cols, 141);
  assert.equal(header.term.rows, 45);
  const seconds = duration(events);
  assert.ok(seconds > 15 && seconds < 20, "duration was " + seconds);
});

test("the recorded terminal is dark, not Terminal.app's light profile", () => {
  const theme = loadCast().header.term.theme;
  assert.equal(theme.bg.toLowerCase(), "#121212");
  assert.notEqual(theme.fg.toLowerCase(), "#000000");
});

test("zsh restore, the failed command, and the shell exit were cropped", () => {
  const text = outputText(loadCast().events);
  assert.equal(text.includes("Restored session"), false);
  assert.equal(text.includes("command not found"), false);
  assert.equal(text.includes("Saving session"), false);
  assert.equal(text.includes("exit\r"), false);
  assert.equal(text.includes("session summary"), false);
});

test("what remains is the makefaster loop through the fastest run", () => {
  const text = outputText(loadCast().events);
  assert.match(text, /npx/);
  assert.match(text, /makefaster/);
  assert.match(text, /AGENT THINKING/);
  assert.match(text, /27\.6%/);
  assert.match(holdFrame(loadCast().events), /★3001/);
});

test("local paths from the capture machine are not on the homepage", () => {
  const text = outputText(loadCast().events);
  assert.equal(text.includes("/Users/j/"), false);
  assert.equal(text.includes("j@strago"), false);
});

test("the player holds on the fastest run and does not loop", () => {
  const demo = readFileSync(DEMO_PATH, "utf8");
  assert.match(demo, /CAST_SRC = "\/assets\/makefaster-loop\.cast"/);
  assert.match(demo, /loop: false/);
  assert.match(demo, /HOLD = 17\.41/);
  const poster = demo.match(/POSTER = "(npt:[0-9.]+)"/);
  assert.ok(poster, "loop-demo.js must name a poster frame");
  const seconds = Number(poster[1].slice(4));
  const castSeconds = duration(loadCast().events);
  assert.ok(Math.abs(seconds - castSeconds) < 0.05, poster[1] + " vs cast " + castSeconds);
});

test("the homepage wraps the recording in a window, not page captions", () => {
  const demo = readFileSync(DEMO_PATH, "utf8");
  assert.match(demo, /loop-window-titlebar/);
  assert.equal(demo.includes("loop-demo-meta"), false);
  assert.equal(demo.includes(">The loop<"), false);
});
