// Text-to-speech leg via Gemini's native TTS.
// Behind a narrow interface so swapping providers later is a one-file change.

const API_KEY = process.env.GEMINI_API_KEY;
const VOICE = process.env.GEMINI_TTS_VOICE || "Kore";

// Each Gemini TTS model has its own free-tier allowance, and they are small:
// gemini-2.5-flash-preview-tts caps at TEN requests/day. Rather than depend on one model (or
// on a correctly-configured GEMINI_TTS_MODEL env var — a stale value there silently pins us to
// an exhausted model), try them in order and move on whenever one reports quota exhaustion.
const MODEL_CHAIN = Array.from(
  new Set(
    [
      process.env.GEMINI_TTS_MODEL,
      "gemini-3.1-flash-tts-preview",
      "gemini-2.5-pro-preview-tts",
      "gemini-2.5-flash-preview-tts",
    ].filter(Boolean) as string[]
  )
);

export interface TTSResult {
  wavBase64: string;
  mimeType: "audio/wav";
}

// 429 RESOURCE_EXHAUSTED (allowance spent) and 403 PERMISSION_DENIED (key disabled / billing
// off) are both terminal for the rest of the session — retrying either just wastes time. The
// client answers both by muting server TTS and telling the operator to read the written reply.
export class TTSQuotaError extends Error {
  readonly quota = true;
  readonly status: number;
  constructor(message: string, status = 429) {
    super(message);
    this.status = status;
  }
}

// Preview TTS models intermittently return "Model tried to generate text, but it should only be
// used for TTS" (400) on an otherwise-identical request. A short retry absorbs that.
// Quota errors (429) are NEVER retried — retrying burns the remaining allowance 3x faster.
const MAX_ATTEMPTS = 3;

export async function synthesizeSpeech(text: string): Promise<TTSResult> {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not set");

  let quotaExhausted = 0;
  let quotaStatus = 429;
  let lastError: Error | null = null;

  for (const model of MODEL_CHAIN) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await synthesizeOnce(text, model);
      } catch (e: any) {
        lastError = e;
        if (e instanceof TTSQuotaError) {
          quotaExhausted++;
          quotaStatus = e.status;
          break; // this model is spent — don't retry it, move to the next
        }
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 200 * attempt));
        }
      }
    }
  }

  // Every model out of quota is a distinct condition from a transport failure: the client
  // reacts to it by switching to browser speech synthesis instead of surfacing an error.
  if (quotaExhausted === MODEL_CHAIN.length) {
    throw new TTSQuotaError(
      `All Gemini TTS models are unavailable (${quotaStatus})`,
      quotaStatus
    );
  }
  throw lastError ?? new Error("Gemini TTS failed");
}

async function synthesizeOnce(text: string, model: string): Promise<TTSResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429 || res.status === 403) {
      throw new TTSQuotaError(
        `Gemini TTS refused ${model} with ${res.status}`,
        res.status
      );
    }
    throw new Error(`Gemini TTS failed: ${res.status} ${errText}`);
  }

  const json = await res.json();
  const part = json?.candidates?.[0]?.content?.parts?.[0];
  const pcmBase64: string | undefined = part?.inlineData?.data;
  const mimeType: string = part?.inlineData?.mimeType || "audio/L16;codec=pcm;rate=24000";
  if (!pcmBase64) throw new Error("Gemini TTS returned no audio");

  const sampleRate = parseRate(mimeType);
  const wavBase64 = pcmToWavBase64(pcmBase64, sampleRate);
  return { wavBase64, mimeType: "audio/wav" };
}

function parseRate(mimeType: string): number {
  const match = mimeType.match(/rate=(\d+)/);
  return match ? parseInt(match[1], 10) : 24000;
}

// Gemini TTS returns raw 16-bit signed little-endian PCM, mono. Browsers can't play raw PCM
// directly, so wrap it in a minimal WAV (RIFF) header — no re-encoding needed.
function pcmToWavBase64(pcmBase64: string, sampleRate: number): string {
  const pcm = Buffer.from(pcmBase64, "base64");
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]).toString("base64");
}
