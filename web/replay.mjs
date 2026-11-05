// Feeds a `[mm:ss] Speaker: text` file into a running room, to test the board without microphones.
// Usage: ROOM=<key> node web/replay.mjs [file] [delayMs] [maxLines]

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || path.join(root, "..", "timeline", "data", "transcript.txt");
const delay = Number(process.argv[3] || 1000);
const limit = Number(process.argv[4] || Infinity);
const base = process.env.BASE || `http://127.0.0.1:${process.env.PORT || 4300}`;
const room = process.env.ROOM || readFileSync(path.join(root, ".room"), "utf8").trim();

const lines = readFileSync(file, "utf8")
  .split(/\r?\n/)
  .map((line) => line.match(/^\[\d+:\d+\]\s*([^:]+):\s*(.+)$/))
  .filter(Boolean)
  .slice(0, limit);

for (const [, speaker, text] of lines) {
  const res = await fetch(`${base}/api/line`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-room": room },
    body: JSON.stringify({ speaker, text }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  await new Promise((resolve) => setTimeout(resolve, delay));
}
console.log(`Odtworzono ${lines.length} wypowiedzi.`);
