# Closer Market

A WhatsApp number traders save as **Closer Translator**. The trader records the customer's words as a voice note; the bot replies with the translation (text + voice). The trader records an answer; the bot replies with a voice note in the customer's language to play aloud.

```
customer speaks Hausa ──(trader records voice note)──▶ Closer
   Closer: speech-to-text (9jaLingo) → translate (Claude) → text-to-speech (9jaLingo)
trader hears/reads Igbo ◀──────────────────────────────┘
trader answers in Igbo ──(voice note)──▶ Closer ──▶ Hausa voice note ──▶ played to customer
```

Languages: Hausa, Igbo, Yoruba, Pidgin (speech in and out), English (speech in, text out).

## What's in the box

| File | Job |
|---|---|
| `src/server.js` | Webhook (verify, signature check), temp audio hosting |
| `src/flow.js` | Registration + turn-taking (customer / trader), commands |
| `src/whatsapp.js` | Send text, send voice note, download media |
| `src/providers/stt.js` `tts.js` `translate.js` | Swap any provider here without touching the flow |
| `src/audio.js` | ffmpeg: WhatsApp ogg → wav, TTS → ogg/opus mono |
| `scripts/stats.js` | Pilot scoreboard from `data/events.jsonl` |

## Setup (about 1 hour)

1. **Keys**
   - 9jaLingo key (`NAIJALINGO_API_KEY`) from 9jalingo.org/dashboard. Make sure it has the `stt` scope.
   - Anthropic key (`ANTHROPIC_API_KEY`).
2. **Meta**: developers.facebook.com → Create app (Business) → add **WhatsApp**. Copy the *Phone number ID* and a token. Use a System User permanent token for the pilot; the 24-hour test token will expire mid-pilot.
3. **Run locally with a public URL** (speech-to-text fetches audio from your server):
   ```bash
   cp .env.example .env      # fill it in
   npm install
   npx cloudflared tunnel --url http://localhost:3000   # or ngrok http 3000
   # put the https URL in PUBLIC_BASE_URL, then:
   npm start
   ```
   Requires Node 20+ and `ffmpeg` on the machine.
4. **Webhook**: Meta app → WhatsApp → Configuration → Callback URL `https://<your-url>/webhook`, Verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to **messages**.
5. **Try it**: message the test number from your phone: `hi` → pick languages → send a voice note.
6. **Deploy for the pilot**: the included `Dockerfile` works on Railway / Render / Fly. Mount a volume at `/app/data`, set the env vars, point the webhook at the real URL.

Tests: `npm test` (flow logic with fakes + a real ffmpeg check). Scoreboard: `npm run stats`.

## Things to know before you walk into Wuse

- **It's voice notes, not live.** Expect roughly 5–10 s per turn (download, transcribe, translate, speak). Say that to traders honestly: "record, send, wait a moment". The "under 2 seconds" target needs a streaming app later.
- **Speech engine cold starts.** 9jaLingo's docs say the speech-to-text engine sleeps when idle and can take a few minutes to wake. Set `WARMUP_MINUTES=8` during market hours and send a test note before you visit each shop. Ask 9jaLingo about a dedicated/warm plan if the pilot works.
- **Test number limit.** Meta's test number only messages a handful of pre-approved numbers. For 10 shops, register a real number to the Cloud API (one that isn't already on WhatsApp).
- **Accuracy is the product.** Run 20 real sentences per language pair (prices, "last price", "reduce small", quantities) before the pilot and look at `data/events.jsonl` (`heard` vs `translated`). If speech-to-text mishears a language, fix it at the provider level; the flow won't change.
- **Privacy.** Customer voices pass through 9jaLingo and Anthropic. Have the trader tell customers it's a translator, and don't keep audio (this code doesn't; it keeps only transcripts in the event log).
- **Pilot guard.** Put the 10 traders' numbers in `ALLOWED_NUMBERS` so a stranger can't run up your API bill.

## Pilot script (10 shops, 1 week)

1. Day 0: save the number in each trader's phone as "Closer Translator", register their languages with them, do one live sale together.
2. Day 1–6: check `npm run stats` each evening. Call any trader with zero translations or high `unclear`.
3. Day 7: ask each one: *"Did this help you sell something today?"* and *"Would you pay ₦___/week?"* One yes with a story = you have a business.


## Deploy on Render (Docker)

This repository includes a `render.yaml` blueprint and a Dockerfile. Before using it, review the costs of the selected Render plan and persistent disk in Render's current pricing. A persistent disk is important because the pilot stores trader registration and event logs in `/app/data`.

1. Push this folder to a GitHub repository. Do not commit `.env`, API keys, access tokens, or real customer data.
2. In Render, choose **New → Blueprint** and connect the repository containing `render.yaml`. Review the plan and disk charges before creating the service.
3. In the service's Environment settings, set these secrets: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `NAIJALINGO_API_KEY`, and `ANTHROPIC_API_KEY`. Add your allowed pilot WhatsApp numbers to `ALLOWED_NUMBERS` as comma-separated digits with country codes (no plus signs or spaces).
4. After Render assigns the service an HTTPS URL, set `PUBLIC_BASE_URL` to that exact URL, with no trailing slash, and redeploy. For example: `https://your-service.onrender.com`.
5. Open `https://your-service.onrender.com/health`. It should return `{"ok":true}`.
6. In Meta's WhatsApp webhook configuration, set the callback URL to `https://your-service.onrender.com/webhook`, and use the same `WHATSAPP_VERIFY_TOKEN` value shown in Render's environment settings. Subscribe to `messages`.
7. Send a test message, complete registration, then test a voice note in each direction. Confirm the 9jaLingo and Anthropic accounts have active API access and sufficient quota.

### Production safety notes

- Keep `WHATSAPP_APP_SECRET` configured. The server intentionally skips webhook signature verification if it is empty.
- Set `ALLOWED_NUMBERS` for a private pilot. An empty value leaves the bot open to anyone who can message the WhatsApp number and may create unexpected API costs.
- `DATA_DIR=/app/data` must match the mounted persistent disk. Without persistent storage, registration data and event logs may be lost when the service restarts or is redeployed.
- This small JSON-file store is intended for a limited pilot, not multiple service instances or a high-volume launch. Use a managed database before scaling.
- Never paste secrets into chat, GitHub, or screenshots. Set them directly in the hosting provider's environment settings.
