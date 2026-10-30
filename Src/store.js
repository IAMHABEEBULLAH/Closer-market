import fs from 'node:fs';
import path from 'node:path';

/** Tiny JSON-file store: fine for a 10-shop pilot. Swap for SQLite/Postgres when you scale. */
export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'traders.json');
  const logFile = path.join(dir, 'events.jsonl');
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const seen = new Set();

  const flush = () => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  };

  return {
    get: (id) => data[id],
    set(id, value) {
      data[id] = value;
      flush();
    },
    /** WhatsApp retries webhooks; ignore message IDs we've already handled. */
    isDuplicate(messageId) {
      if (seen.has(messageId)) return true;
      seen.add(messageId);
      if (seen.size > 2000) seen.delete(seen.values().next().value);
      return false;
    },
    /** Append-only event log: this is how you measure the pilot. */
    log(event) {
      fs.appendFileSync(logFile, `${JSON.stringify({ t: new Date().toISOString(), ...event })}\n`);
    },
  };
}
