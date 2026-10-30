export const LANGS = {
  ig: 'Igbo',
  yo: 'Yoruba',
  ha: 'Hausa',
  pcm: 'Pidgin',
  en: 'English',
};

const MENU = '1 - Igbo\n2 - Yoruba\n3 - Hausa\n4 - Pidgin\n5 - English';
const CHOICES = {
  1: 'ig', igbo: 'ig',
  2: 'yo', yoruba: 'yo',
  3: 'ha', hausa: 'ha',
  4: 'pcm', pidgin: 'pcm',
  5: 'en', english: 'en',
};

const WELCOME =
  'Welcome to *Closer Translator* 👋\nI help you talk to customers who speak a different language.\n\nWhich language do *YOU* speak?\n' +
  `${MENU}\n\nReply with a number.`;

/**
 * Conversation logic, independent of the web server so it can be tested with fakes.
 * deps: { store, wa, stt, translate, tts, audio }
 *   stt(wav, lang) -> text   translate(text, from, to) -> text   tts(text, lang) -> ogg Buffer | null
 */
export function createFlow({ store, wa, stt, translate, tts, audio, now = Date.now }) {
  const ask = (to, body) => wa.sendText(to, body);

  async function register(from, t, text) {
    const choice = CHOICES[text.toLowerCase()];
    if (!choice) return ask(from, `Please reply with a number from the list:\n${MENU}`);

    if (t.state === 'self') {
      store.set(from, { ...t, state: 'customer', self: choice });
      return ask(from, `Got it: you speak *${LANGS[choice]}*.\n\nWhich language do your *CUSTOMERS* speak?\n${MENU}`);
    }

    if (choice === t.self) return ask(from, 'Pick a different language from yours, or send "reset" to start over.');
    store.set(from, { ...t, state: 'ready', customer: choice, expect: 'customer', turns: 0 });
    return ask(
      from,
      `Ready ✅\nYou: *${LANGS[t.self]}*  ↔  Customer: *${LANGS[choice]}*\n\n` +
        `How to use:\n1. Hold your phone to the customer. Record what they say as a voice note and send it.\n` +
        `2. I reply with the ${LANGS[t.self]} translation (voice + text).\n` +
        `3. Record your answer and send it. I reply with a ${LANGS[choice]} voice note: play it to the customer.\n\n` +
        `If I mix up who is speaking, send *swap*. To change languages, send *reset*.`,
    );
  }

  async function translateAndReply(from, t, heard, speaker, started, timings) {
    const customerSpeaking = speaker === 'customer';
    const fromLang = customerSpeaking ? t.customer : t.self;
    const toLang = customerSpeaking ? t.self : t.customer;

    let t1 = now();
    const translated = await translate(heard, fromLang, toLang);
    timings.translate = now() - t1;

    if (!translated || translated.includes('[unclear]')) {
      await ask(from, "Sorry, I couldn't understand that. Please move the phone closer and send it again 🎤");
      store.log({ trader: from, event: 'unclear', speaker, heard });
      return;
    }

    // Text goes out first so the trader sees the meaning while the voice is still being made.
    const label = customerSpeaking
      ? `🗣 Customer (${LANGS[fromLang]}): ${heard}\n✅ ${LANGS[toLang]}: ${translated}`
      : `🗣 You (${LANGS[fromLang]}): ${heard}\n🔊 ${LANGS[toLang]}: ${translated}`;
    const hint = (t.turns || 0) < 2 ? `\n\n👉 Next: ${customerSpeaking ? 'you answer' : 'customer speaks'}` : '';
    await ask(from, label + hint);

    t1 = now();
    const ogg = await tts(translated, toLang);
    timings.tts = now() - t1;
    if (ogg) await wa.sendVoice(from, ogg);

    store.set(from, { ...t, expect: customerSpeaking ? 'trader' : 'customer', turns: (t.turns || 0) + 1 });
    store.log({
      trader: from, event: 'translated', speaker, from: fromLang, to: toLang,
      heard, translated, voice: Boolean(ogg), ms: { ...timings, total: now() - started },
    });
  }

  async function handle(msg) {
    const { from } = msg;
    const text = msg.type === 'text' ? (msg.text || '').trim() : null;
    const cmd = text ? text.toLowerCase() : null;
    let t = store.get(from);

    // New trader, or explicit restart.
    if (!t || cmd === 'reset' || cmd === 'change') {
      store.set(from, { state: 'self' });
      return ask(from, WELCOME);
    }

    if (t.state !== 'ready') {
      if (text === null) return ask(from, 'Let’s finish setup first. Please reply with a number from the list 🙏');
      return register(from, t, text);
    }

    // Ready state commands.
    if (cmd === 'swap') {
      const expect = t.expect === 'customer' ? 'trader' : 'customer';
      store.set(from, { ...t, expect });
      return ask(from, expect === 'customer' ? '🔄 OK. Next voice note = customer speaking.' : '🔄 OK. Next voice note = you speaking.');
    }
    if (cmd === 'help') {
      return ask(
        from,
        `You: ${LANGS[t.self]} ↔ Customer: ${LANGS[t.customer]}\nSend the customer's words as a voice note, then record your answer.\n` +
          'Commands: *swap* (flip who speaks), *reset* (change languages).',
      );
    }

    const started = now();
    const timings = {};
    try {
      if (msg.type === 'audio') {
        const speaker = t.expect || 'customer';
        const lang = speaker === 'customer' ? t.customer : t.self;

        let t1 = now();
        const wav = await audio.toWav16k(await wa.downloadMedia(msg.audioId));
        timings.download = now() - t1;

        t1 = now();
        const heard = await stt(wav, lang);
        timings.stt = now() - t1;

        if (!heard) {
          await ask(from, "I didn't hear anything. Please move the phone closer and send it again 🎤");
          store.log({ trader: from, event: 'silence', speaker });
          return;
        }
        return await translateAndReply(from, t, heard, speaker, started, timings);
      }

      if (msg.type === 'text') {
        // Typed text is always the trader speaking: translate to the customer's language and voice it.
        return await translateAndReply(from, t, text, 'trader', started, timings);
      }

      return ask(from, 'Please send a voice note 🎤 (or type a message to translate).');
    } catch (err) {
      console.error('flow error:', err);
      store.log({ trader: from, event: 'error', message: String(err.message || err).slice(0, 300) });
      return ask(from, 'Sorry, something went wrong on my side. Please send that again 🙏');
    }
  }

  return { handle };
}
