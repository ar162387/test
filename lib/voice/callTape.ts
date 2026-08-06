// Browser-only. Assembles the call recording out of the audio that actually carried speech.
//
// The first version wrapped a MediaRecorder around a mic+playback mix and left it running from
// "call start" to "call end". That is faithful but almost unlistenable on review: every STT
// round trip, every model turn and every pause the operator took is in the file as dead air,
// and a five-minute recording might hold ninety seconds of talking.
//
// Instead each side contributes finished audio as it happens — the operator's push-to-talk
// clip (which is exactly as long as the button was held) and the WAV that came back from
// Gemini TTS — and they are stitched together in conversational order at the end. What you
// hear back is the conversation with the waiting removed.
import { MonoAudio, resampleLinear, wavBlobFromFloat32 } from "./encodeWav";

// The agent's voice is the bulk of the audio and arrives at 24 kHz, so render at its rate
// rather than dragging it down to the mic's 16 kHz.
const OUTPUT_RATE = 24000;
// A short beat between turns; back-to-back with no gap sounds like one person interrupting.
const GAP_MS = 180;

export class CallTape {
  // A slot is reserved when a turn *starts* and filled when its audio exists, so audio that
  // resolves out of order (TTS lands after its transcript is already on screen) still lands in
  // the right place. Slots that never get audio — a browser-voice fallback, a failed TTS
  // request — stay null and are simply skipped.
  private slots: (MonoAudio | null)[] = [];

  reserve(): number {
    this.slots.push(null);
    return this.slots.length - 1;
  }

  fill(slot: number, clip: MonoAudio) {
    if (slot >= 0 && slot < this.slots.length && clip.samples.length > 0) {
      this.slots[slot] = clip;
    }
  }

  render(): Blob | null {
    const clips = this.slots.filter(Boolean) as MonoAudio[];
    if (clips.length === 0) return null;

    const parts = clips.map((c) => resampleLinear(c.samples, c.sampleRate, OUTPUT_RATE));
    const gap = Math.round((OUTPUT_RATE * GAP_MS) / 1000);
    const total = parts.reduce((n, p) => n + p.length, 0) + gap * (parts.length - 1);

    const out = new Float32Array(total);
    let offset = 0;
    parts.forEach((part, i) => {
      if (i > 0) offset += gap; // the gap is already silence — Float32Array starts zeroed
      out.set(part, offset);
      offset += part.length;
    });

    return wavBlobFromFloat32(out, OUTPUT_RATE);
  }
}
