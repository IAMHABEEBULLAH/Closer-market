import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFlow } from "../src/flow.js";
import { createStore } from "../src/store.js";
import { toOggOpus, toWav16k } from "../src/audio.js";
import { execFileSync } from "node:child_process";

function setup({ sttText = "Wannan nawa ne?", translated = "Ego ole ka nke a bu?", ttsOgg = Buffer.from("ogg"), } = {}) {
  const sent = [];
  const voices = [];
  const calls = { stt: [], translate: [], tts: [] };
  const store = createStore(fs.mkdtempSync(path.join(os.tmpdir(), "closer-")));
  const flow = createFlow({
    store,
    audio: { toWav16k: async (b) => b },
    wa: {
      sendText: async (to, body) => sent.push({ to, body }),
      sendVoice: async (to, buf) => voices.push({ to, buf }),
      downloadMedia: async () => Buffer.from("audio-bytes"),
    },
    stt: async (wav, lang) => (calls.stt.push(lang), sttText),
    translate: async (text, from, to) => (
      calls.translate.push([text, from, to]), translated
    ),
    tts: async (text, lang) => (calls.tts.push([text, lang]), ttsOgg),
  });
  const say = (text) =>
    flow.handle({ from: "2348000000001", type: "text", text });
  const voice = () =>
    flow.handle({ from: "2348000000001", type: "audio", audioId: "m1" });
  return { flow, sent, voices, calls, say, voice, store };
}

async function registered(opts) {
  const s = setup(opts);
  await s.say("hi"); // welcome
  await s.say("1"); // I speak Igbo
  await s.say("3"); // customers speak Hausa
  s.sent.length = 0;
  return s;
}

test("registration walks through both language questions", async () => {
  const s = setup();
  await s.say("hi");
  assert.match(s.sent[0].body, /Which language do \*YOU\* speak/);
  await s.say("igbo");
  assert.match(s.sent[1].body, /CUSTOMERS/);
  await s.say("hausa");
  assert.match(s.sent[2].body, /Igbo.*Hausa/s);
  assert.deepEqual(
    { state: "ready", self: "ig", customer: "ha", expect: "customer" },
    (({ state, self, customer, expect }) => ({
      state,
      self,
      customer,
      expect,
    }))(s.store.get("2348000000001"))
  );
});

test("rejects bad answers and same language", async () => {
  const s = setup();
  await s.say("hi");
  await s.say("banana");
  assert.match(s.sent[1].body, /reply with a number/);
  await s.say("1");
  await s.say("1");
  assert.match(s.sent[3].body, /different language/);
});

test("customer voice -> trader language text + voice, then turn flips", async () => {
  const s = await registered();
  await s.voice();
  assert.deepEqual(s.calls.stt, ["ha"]);
  assert.deepEqual(s.calls.translate[0], ["Wannan nawa ne?", "ha", "ig"]);
  assert.deepEqual(s.calls.tts[0], ["Ego ole ka nke a bu?", "ig"]);
  assert.match(s.sent[0].body, /Customer \(Hausa\): Wannan nawa ne\?/);
  assert.equal(s.voices.length, 1);
  assert.equal(s.store.get("2348000000001").expect, "trader");
});

test("trader voice goes the other way (Igbo -> Hausa)", async () => {
  const s = await registered({
    sttText: "Puku abuo",
    translated: "Naira dubu biyu ne",
  });
  await s.voice(); // customer turn
  await s.voice(); // trader turn
  assert.deepEqual(s.calls.stt, ["ha", "ig"]);
  assert.deepEqual(s.calls.translate[1], ["Puku abuo", "ig", "ha"]);
  assert.deepEqual(s.calls.tts[1], ["Naira dubu biyu ne", "ha"]);
  assert.equal(s.store.get("2348000000001").expect, "customer");
});

test("swap flips who is speaking", async () => {
  const s = await registered();
  await s.say("swap");
  assert.equal(s.store.get("2348000000001").expect, "trader");
  await s.voice();
  assert.deepEqual(s.calls.stt, ["ig"]);
});

test("typed text is translated to the customer language", async () => {
  const s = await registered({ translated: "Naira dubu biyu ne" });
  await s.say("Puku abuo");
  assert.deepEqual(s.calls.translate[0], ["Puku abuo", "ig", "ha"]);
  assert.equal(s.voices.length, 1);
});

test("unclear speech asks to repeat and does not flip the turn", async () => {
  const s = await registered({ translated: "[unclear]" });
  await s.voice();
  assert.match(s.sent[0].body, /couldn't understand/);
  assert.equal(s.voices.length, 0);
  assert.equal(s.store.get("2348000000001").expect, "customer");
});

test("no voice for a language without TTS falls back to text only", async () => {
  const s = await registered({ ttsOgg: null });
  await s.voice();
  assert.equal(s.voices.length, 0);
  assert.equal(s.sent.length, 1);
});

test("provider failure gives a friendly message, not a crash", async () => {
  const s = setup();
  const flow = createFlow({
    store: s.store,
    audio: { toWav16k: async (b) => b },
    wa: {
      sendText: async (to, body) => s.sent.push({ to, body }),
      sendVoice: async () => {},
      downloadMedia: async () => Buffer.from("x"),
    },
    stt: async () => {
      throw new Error("boom");
    },
    translate: async () => "",
    tts: async () => null,
  });
  s.store.set("2348000000001", {
    state: "ready",
    self: "ig",
    customer: "ha",
    expect: "customer",
    turns: 0,
  });
  await flow.handle({ from: "2348000000001", type: "audio", audioId: "m1" });
  assert.match(s.sent.at(-1).body, /something went wrong/);
});

test("ffmpeg: produces mono OGG/Opus that WhatsApp accepts", async () => {
  const wav = execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=3",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "wav",
      "pipe:1",
    ],
    { maxBuffer: 1e7 }
  );
  const ogg = await toOggOpus(wav);
  assert.equal(ogg.subarray(0, 4).toString(), "OggS");
  assert.ok(ogg.length < 512 * 1024, "under the 512KB play-button limit");
  const info = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,channels",
      "-of",
      "csv=p=0",
      "-i",
      "pipe:0",
    ],
    { input: ogg }
  )
    .toString()
    .trim();
  assert.equal(info, "opus,1");
  const back = await toWav16k(ogg);
  assert.equal(back.subarray(0, 4).toString(), "RIFF");
});
