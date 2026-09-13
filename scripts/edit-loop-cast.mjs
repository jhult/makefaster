#!/usr/bin/env node
/**
 * Crop the Portainer asciinema capture to the makefaster loop and retime
 * it so the homepage plays through to the fastest run, then holds. The
 * source includes a restored zsh session, a failed `makefaster` command,
 * and a shell `exit` — none of that belongs on the homepage, and the raw
 * run is over an hour of idle dashboard.
 *
 * The capture's Terminal.app theme is light; the TUI paints its own dark
 * cells. The header is rewritten to a dark default so the shell around
 * the dashboard matches.
 *
 * Usage: node scripts/edit-loop-cast.mjs [source.cast] [out.cast]
 */
import { readFileSync, writeFileSync } from "node:fs";

const TARGET_SECONDS = 30;
const SOURCE = process.argv[2] || "/Users/j/code/portainer/portainer.cast";
const DEST = process.argv[3] || "frontend/assets/makefaster-loop.cast";

const REPLACEMENTS = [
  [/\/Users\/j\//g, "~/"],
  [/j@strago/g, "dev@portainer"],
  [/file:\/\/strago\/Users\/j\/code\/portainer/g, "file://host/portainer"],
];

/** Same ground as the TUI's 256-color screen (233 / 234). */
const DARK_THEME = {
  fg: "#e6e6e6",
  bg: "#121212",
  palette:
    "#000000:#c91b00:#00c200:#c7c400:#3b78ff:#ca30c7:#00c5c7:#c7c7c7:#686868:#ff6e67:#5ffa68:#fffc67:#6871ff:#ff77ff:#60fdff:#ffffff",
};

function sanitize(s) {
  if (typeof s !== "string") return s;
  for (const [from, to] of REPLACEMENTS) s = s.replace(from, to);
  return s;
}

function parse(text) {
  const lines = text.split(/\n/);
  const header = JSON.parse(lines[0]);
  const events = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    events.push(JSON.parse(line));
  }
  return { header, events };
}

function outputContains(ev, needle) {
  return ev[1] === "o" && typeof ev[2] === "string" && ev[2].includes(needle);
}

function findIndex(events, pred, from = 0) {
  for (let i = from; i < events.length; i++) if (pred(events[i], i)) return i;
  return -1;
}

function plain(s) {
  return String(s).replace(/\u001b\[[0-9;]*m/g, "");
}

function starsIn(ev) {
  if (ev[1] !== "o" || typeof ev[2] !== "string") return [];
  return [...plain(ev[2]).matchAll(/★(\d+)/g)].map((m) => Number(m[1]));
}

/** First event that paints the lowest starred run, plus the rest of that frame. */
function cropToFastestRun(events) {
  let min = Infinity;
  let at = -1;
  for (let i = 0; i < events.length; i++) {
    for (const value of starsIn(events[i])) {
      if (value < min) {
        min = value;
        at = i;
      }
    }
  }
  if (at < 0) throw new Error("could not find a starred run");
  let end = at;
  while (end + 1 < events.length && events[end + 1][0] === 0) end++;
  return { events: events.slice(0, end + 1), fastestMs: min, holdIndex: at };
}

function roundDelay(d) {
  return Math.round(d * 1000) / 1000;
}

function tAt(events, i) {
  let t = 0;
  for (let k = 0; k <= i; k++) t += events[k][0];
  return t;
}

const raw = parse(readFileSync(SOURCE, "utf8"));

// Start on the prompt after `zsh: command not found: makefaster`, which is
// the first moment the user types `npx makefaster`. Everything before that
// is a restored shell session.
const failed = findIndex(raw.events, (ev) => outputContains(ev, "command not found"));
if (failed < 0) throw new Error("could not find the failed makefaster command");
const start = findIndex(raw.events, (ev) => outputContains(ev, "portainer %"), failed + 1);
if (start < 0) throw new Error("could not find the prompt after the failed command");

// Slice through the summary so the 30-second retiming stays the same pace
// as the committed loop; the hold crop happens after that scale.
const cot = findIndex(raw.events, (ev) => outputContains(ev, "Chain of thought"));
if (cot < 0) throw new Error("could not find the chain-of-thought skip");
let end = cot;
while (end + 1 < raw.events.length) {
  const next = raw.events[end + 1];
  if (next[1] !== "o") break;
  const data = next[2] || "";
  if (data.includes("Saving session") || data.includes("portainer %") || data === "e") break;
  end++;
}

const dashboard = findIndex(raw.events, (ev) => outputContains(ev, "AGENT THINKING"), start);
const summary = findIndex(raw.events, (ev) => outputContains(ev, "session summary"), start);
if (dashboard < 0) throw new Error("could not find the dashboard");
if (summary < 0) throw new Error("could not find the session summary");

const sliced = raw.events.slice(start, end + 1).map((ev) => [ev[0], ev[1], sanitize(ev[2])]);
sliced[0][0] = 0.04;

// Intro (typing + picker) stays mostly real-time so `npx makefaster` reads.
// The hour of dashboard idle is clamped; the end screen is readable but brief.
const introUntil = dashboard - start;
const summaryAt = summary - start;

function retimedDelay(i, dt) {
  if (i === 0) return dt;
  if (i < introUntil) return Math.min(dt, 0.55) / 1.6;
  if (i < summaryAt) return Math.min(dt, 0.42);
  return Math.min(dt, 0.45);
}

const firstPass = sliced.map((ev, i) => retimedDelay(i, ev[0]));
const firstTotal = firstPass.reduce((a, d) => a + d, 0);
const scale = TARGET_SECONDS / firstTotal;
const delays = firstPass.map((d) => d * scale);

const scaled = sliced.map((ev, i) => [roundDelay(delays[i]), ev[1], ev[2]]);
const cropped = cropToFastestRun(scaled);
const outEvents = cropped.events;
const duration = outEvents.reduce((a, ev) => a + ev[0], 0);
const holdS = Math.round(tAt(outEvents, outEvents.length - 1) * 100) / 100;

const header = {
  version: 3,
  term: Object.assign({}, raw.header.term, { theme: DARK_THEME }),
  env: { SHELL: "/bin/zsh", TERM: "xterm-256color" },
};

const lines = [JSON.stringify(header), ...outEvents.map((ev) => JSON.stringify(ev))];
writeFileSync(DEST, lines.join("\n") + "\n");

console.log(
  JSON.stringify(
    {
      source: SOURCE,
      dest: DEST,
      events: outEvents.length,
      duration: Math.round(duration * 1000) / 1000,
      introS: Math.round(tAt(outEvents, Math.min(introUntil, outEvents.length - 1)) * 100) / 100,
      fastestMs: cropped.fastestMs,
      holdS,
      posterNpt: "npt:" + holdS.toFixed(2),
    },
    null,
    2
  )
);
