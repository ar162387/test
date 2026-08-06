// Browser-only. Converts a MediaRecorder blob (webm/opus) into 16 kHz mono 16-bit WAV.
//
// Why this exists: Gemini's documented audio inputs are WAV, MP3, AIFF, AAC, OGG and FLAC —
// webm is NOT among them. Sending raw webm produced badly garbled transcripts ("Hello?" came
// back as "How many did you shoot?"). Decoding to PCM and re-wrapping as WAV removes that
// whole class of error. 16 kHz mono is ample for speech and keeps the upload ~3x smaller than
// the 48 kHz stereo the browser records at.

const TARGET_SAMPLE_RATE = 16000;

export async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();

  // Decode with a throwaway context; the recording context's own rate is irrelevant here.
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    decodeCtx.close();
  }

  const mono = downmixToMono(decoded);
  const resampled =
    decoded.sampleRate === TARGET_SAMPLE_RATE
      ? mono
      : resampleLinear(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);

  return wavBase64FromFloat32(resampled, TARGET_SAMPLE_RATE);
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

// Linear interpolation is more than adequate for speech headed to an ASR model, and avoids
// pulling in a resampling dependency.
function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
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

function wavBase64FromFloat32(samples: Float32Array, sampleRate: number): string {
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

  // Chunked conversion — String.fromCharCode(...bytes) blows the call stack on long clips.
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
