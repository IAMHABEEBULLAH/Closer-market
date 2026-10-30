import { config } from './config.js';

const base = () => `https://graph.facebook.com/${config.wa.graphVersion}`;
const auth = () => ({ Authorization: `Bearer ${config.wa.token}` });

async function check(res, what) {
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${await res.text()}`);
  return res;
}

export function createWhatsApp() {
  const messages = (payload) =>
    fetch(`${base()}/${config.wa.phoneId}/messages`, {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });

  return {
    async sendText(to, body) {
      await check(await messages({ to, type: 'text', text: { body } }), 'sendText');
    },

    /** Upload OGG/Opus and send it as a native voice note. */
    async sendVoice(to, oggBuffer) {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', 'audio/ogg');
      form.append('file', new Blob([oggBuffer], { type: 'audio/ogg' }), 'voice.ogg');
      const up = await check(
        await fetch(`${base()}/${config.wa.phoneId}/media`, { method: 'POST', headers: auth(), body: form }),
        'uploadMedia',
      );
      const { id } = await up.json();
      await check(await messages({ to, type: 'audio', audio: { id, voice: true } }), 'sendVoice');
    },

    /** Two-step download: media id -> temporary URL -> bytes (both need the bearer token). */
    async downloadMedia(mediaId) {
      const meta = await (await check(await fetch(`${base()}/${mediaId}`, { headers: auth() }), 'mediaMeta')).json();
      const res = await check(await fetch(meta.url, { headers: auth() }), 'mediaDownload');
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
