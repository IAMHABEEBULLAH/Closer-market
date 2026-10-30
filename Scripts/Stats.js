// Pilot scoreboard: node scripts/stats.js [data/events.jsonl]
import fs from "node:fs";

const file = process.argv[2] || "data/events.jsonl";
if (!fs.existsSync(file)) {
  console.log(`No log yet at ${file}`);
  process.exit(0);
}

const events = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const pct = (arr, p) =>
  arr.length
    ? [...arr].sort((a, b) => a - b)[
        Math.min(arr.length - 1, Math.floor(arr.length * p))
      ]
    : 0;

const by = {};
for (const e of events) {
  const t = (by[e.trader] ||= {
    translated: 0,
    unclear: 0,
    errors: 0,
    days: new Set(),
    total: [],
    pairs: {},
  });
  t.days.add(e.t.slice(0, 10));
  if (e.event === "translated") {
    t.translated++;
    t.total.push(e.ms.total);
    const pair = `${e.from}->${e.to}`;
    t.pairs[pair] = (t.pairs[pair] || 0) + 1;
  } else if (e.event === "unclear" || e.event === "silence") t.unclear++;
  else if (e.event === "error") t.errors++;
}

console.log(
  "trader".padEnd(16),
  "translations",
  "unclear",
  "errors",
  "days",
  "p50(s)",
  "p90(s)"
);
for (const [trader, t] of Object.entries(by)) {
  console.log(
    trader.padEnd(16),
    String(t.translated).padEnd(12),
    String(t.unclear).padEnd(7),
    String(t.errors).padEnd(6),
    String(t.days.size).padEnd(4),
    (pct(t.total, 0.5) / 1000).toFixed(1).padEnd(6),
    (pct(t.total, 0.9) / 1000).toFixed(1)
  );
}
const all = Object.values(by);
console.log(
  `\nTraders: ${all.length} | translations: ${all.reduce( (s, t) => s + t.translated, 0 )} | errors: ${all.reduce((s, t) => s + t.errors, 0)}`
);
