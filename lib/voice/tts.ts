// Text-to-speech leg via Gemini's native TTS (gemini-2.5-flash-preview-tts).
// Behind a narrow interface so swapping providers (e.g. Deepgram Aura-2) later is a one-file change.

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const VOICE = process.env.GEMINI_TTS_VOICE || "Kore";

export interface TTSResult {
  wavBase64: string;
  mimeType: "audio/wav";
}

// gemini-2.5-flash-preview-tts is a preview model that intermittently returns
// "Model tried to generate text, but it should only be used for TTS" (HTTP 400) on an
// otherwise-identical request — confirmed by replaying the exact same body back-to-back.
// A short retry absorbs this rather than surfacing a broken turn to the caller.
const MAX_ATTEMPTS = 3;

export async function synthesizeSpeech(text: string): Promise<TTSResult> {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not set");

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await synthesizeOnce(text);
    } catch (e: any) {
      lastError = e;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }
    }
  }
  throw lastError ?? new Error("Gemini TTS failed after retries");
}

async function synthesizeOnce(text: string): Promise<TTSResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
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
