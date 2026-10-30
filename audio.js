import { spawn } from "node:child_process";

function ffmpeg(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
    const out = [];
    const err = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else
        reject(
          new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString()}`)
        );
    });
    p.stdin.on("error", () => {});
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

/** Any input audio (WhatsApp ogg/opus) -> 16 kHz mono WAV for speech-to-text. */
export const toWav16k = (buf) =>
  ffmpeg(
    ["-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"],
    buf
  );

/** * Any input audio -> mono OGG/Opus, the only format WhatsApp accepts as a voice note. * 24 kbps keeps typical replies well under the 512 KB limit for the play button. */
export const toOggOpus = (buf) =>
  ffmpeg(
    [
      "-i",
      "pipe:0",
      "-ac",
      "1",
      "-ar",
      "24000",
      "-c:a",
      "libopus",
      "-b:a",
      "24k",
      "-application",
      "voip",
      "-f",
      "ogg",
      "pipe:1",
    ],
    buf
  );

/** One second of silence as WAV (used to keep the speech engine warm). */
export const silenceWav = () =>
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=16000:cl=mono",
    "-t",
    "1",
    "-f",
    "wav",
    "pipe:1",
  ]);
