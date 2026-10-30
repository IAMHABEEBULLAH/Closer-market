import http from 'node:http';
import crypto from 'node:crypto';
import { config } from './config.js';
import { createStore } from './store.js';
import { createWhatsApp } from './whatsapp.js';
import { createStt } from './providers/stt.js';
import { createTts } from './providers/tts.js';
import { createTranslate } from './providers/translate.js';
import * as audio from './audio.js';
import * as tempAudio from './tempAudio.js';
import { createFlow } from './flow.js';

const store = createStore(config.dataDir);
const wa = createWhatsApp();
const sttProvider = createStt();
const flow = createFlow({
  store,
  wa,
  audio,
  stt: sttProvider.transcribe,
  translate: createTranslate(),
  tts: createTts(),
});

function validSignature(raw, header) {
  if (!config.wa.appSecret) return true; // not configured: skip (fine for local dev only)
  if (!header) return false;
  const expected = `sha256=${crypto.createHmac('sha256', config.wa.appSecret).update(raw).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Flatten a WhatsApp webhook payload into simple messages. */
function extractMessages(payload) {
  const out = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const m of change.value?.messages || []) {
        out.push({
          id: m.id,
          from: m.from,
          type: m.type === 'audio' ? 'audio' : m.type === 'text' ? 'text' : 'other',
          text: m.text,
          audioId: m.audio?.id,
        });
      }
    }
  }
  return out;
}

async function processMessage(msg) {
  if (store.isDuplicate(msg.id)) return;
  if (config.allowedNumbers.length && !config.allowedNumbers.includes(msg.from)) {
    await wa.sendText(msg.from, 'Closer Translator is in a private pilot right now. We will open it up soon 🙏');
    return;
  }
  await flow.handle(msg);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    return;
  }

  // Meta webhook verification handshake.
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const ok =
      url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === config.wa.verifyToken;
    if (ok) res.writeHead(200).end(url.searchParams.get('hub.challenge'));
    else res.writeHead(403).end();
    return;
  }

  // Incoming messages.
  if (req.method === 'POST' && url.pathname === '/webhook') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    if (!validSignature(raw, req.headers['x-hub-signature-256'])) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200).end(); // ack fast; WhatsApp retries if we are slow
    try {
      for (const msg of extractMessages(JSON.parse(raw.toString('utf8')))) {
        processMessage(msg).catch((e) => console.error('processMessage:', e));
      }
    } catch (e) {
      console.error('bad webhook payload:', e);
    }
    return;
  }

  // Temporary audio for 9jaLingo STT (random 128-bit token, expires in minutes).
  const m = req.method === 'GET' && url.pathname.match(/^\/tmp-audio\/([a-f0-9]{32})\.wav$/);
  if (m) {
    const buf = tempAudio.get(m[1]);
    if (!buf) res.writeHead(404).end();
    else res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': buf.length }).end(buf);
    return;
  }

  res.writeHead(404).end();
});

server.listen(config.port, () => console.log(`Closer Market listening on :${config.port}`));

if (config.warmupMinutes > 0) {
  sttProvider.warmup();
  setInterval(() => sttProvider.warmup(), config.warmupMinutes * 60_000).unref();
}
