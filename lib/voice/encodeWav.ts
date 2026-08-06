// Browser-only audio plumbing: decoding capture blobs to mono PCM, and writing PCM back out
// as WAV.
//
// Why WAV for STT: Gemini's documented audio inputs are WAV, MP3, AIFF, AAC, OGG and FLAC —
// webm is NOT among them. Sending raw webm produced badly garbled transcripts ("Hello?" came
// back as "How many did you shoot?"). Decoding to PCM and re-wrapping as WAV removes that
// whole class of error. 16 kHz mono is ample for speech and keeps the upload ~3x smaller than
// the 48 kHz stereo the browser records at.

export const STT_SAMPLE_RATE = 16000;

/** A stretch of mono PCM in [-1, 1], plus the rate it was sampled at. */
export interface MonoAudio {
  samples: Float32Array;
  sampleRate: number;
}

/** Decodes any browser-playable blob (webm/opus, wav, mp3…) to mono PCM at `targetRate`. */
export async function decodeBlobToMono(
  blob: Blob,
  targetRate: number = STT_SAMPLE_RATE
): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();

  // Decode with a throwaway context; the playback context's own rate is irrelevant here.
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    decodeCtx.close();
  }

  const mono = downmixToMono(decoded);
  return decoded.sampleRate === targetRate
    ? mono
    : resampleLinear(mono, decoded.sampleRate, targetRate);
}

export async function blobToWavBase64(blob: Blob): Promise<string> {
  const samples = await decodeBlobToMono(blob, STT_SAMPLE_RATE);
  return wavBase64FromFloat32(samples, STT_SAMPLE_RATE);
}

/**
 * Reads a 16-bit PCM WAV back into mono samples — used for the TTS audio, which arrives as
 * base64 WAV and has to go onto the call tape. Parsed by walking the RIFF chunks rather than
 * assuming the canonical 44-byte header, so a provider that inserts a LIST/fact chunk doesn't
 * turn the agent's voice into static.
 */
export function wavBase64ToMono(wavBase64: string): MonoAudio {
  const bytes = base64ToBytes(wavBase64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let numChannels = 1;
  let sampleRate = 24000;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  // 12 bytes of "RIFF<size>WAVE", then a sequence of <id><size><payload> chunks.
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === "fmt ") {
      numChannels = view.getUint16(body + 2, true) || 1;
      sampleRate = view.getUint32(body + 4, true) || 24000;
      bitsPerSample = view.getUint16(body + 14, true) || 16;
    } else if (id === "data") {
      dataOffset = body;
      dataLength = Math.min(size, view.byteLength - body);
      break;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  if (dataOffset < 0 || bitsPerSample !== 16) {
    return { samples: new Float32Array(0), sampleRate };
  }

  const frameCount = Math.floor(dataLength / 2 / numChannels);
  const samples = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      sum += view.getInt16(dataOffset + (i * numChannels + ch) * 2, true) / 0x8000;
    }
    samples[i] = sum / numChannels;
  }
  return { samples, sampleRate };
}

export function wavBase64FromFloat32(samples: Float32Array, sampleRate: number): string {
  return bytesToBase64(new Uint8Array(buildWav(samples, sampleRate)));
}

export function wavBlobFromFloat32(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([buildWav(samples, sampleRate)], { type: "audio/wav" });
}

function downmixToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) return buffer.getChannelData(0);

  const out = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) out[i] += data[i];
  }
  for (let i = 0; i < length; i++) out[i] /= numberOfChannels;
  return out;
}

// Linear interpolation is more than adequate for speech headed to an ASR model or a review
// playback, and avoids pulling in a resampling dependency.
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.round(input.length / ratio);
  const out = new Float32Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = pos - left;
    out[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return out;
}

function buildWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  const dataSize = samples.length * bytesPerSample;
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return buffer;
}

// Chunked conversion — String.fromCharCode(...bytes) blows the call stack on long clips.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
