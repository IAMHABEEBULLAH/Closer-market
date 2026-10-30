const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  // Public HTTPS URL of this server. 9jaLingo speech-to-text fetches audio from a URL,
  // so the server must be reachable from the internet (ngrok/cloudflared locally, or a host).
  publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),

  wa: {
    token: env.WHATSAPP_TOKEN,
    phoneId: env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || 'closer-market-verify',
    appSecret: env.WHATSAPP_APP_SECRET, // optional but recommended: verifies webhook signatures
    graphVersion: env.GRAPH_VERSION || 'v23.0',
  },

  // Pilot guard: comma-separated trader numbers (digits only, with country code). Empty = open.
  allowedNumbers: (env.ALLOWED_NUMBERS || '').split(',').map((s) => s.trim()).filter(Boolean),

  anthropicKey: env.ANTHROPIC_API_KEY,
  translateModel: env.TRANSLATE_MODEL || 'claude-haiku-5-5',

  // 9jaLingo speaker IDs (swap for any ID from client.tts.listSpeakers()).
  speakers: {
    ha: env.SPEAKER_HA || 'aisha_ha',
    ig: env.SPEAKER_IG || 'adaeze_ig',
    yo: env.SPEAKER_YO || 'adeola_yo',
    pcm: env.SPEAKER_PCM || 'ada_pcm',
  },

  dataDir: env.DATA_DIR || './data',
  // The speech-to-text engine sleeps when idle and can take minutes to wake.
  // Set to e.g. 8 during pilot hours to ping it and keep it warm (0 = off).
  warmupMinutes: Number(env.WARMUP_MINUTES || 0),
};
