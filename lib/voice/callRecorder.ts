// Browser-only. Owns the microphone for the length of the call and the tape the recording is
// assembled from.
//
// Note what it no longer does: there is no always-on MediaRecorder and no AudioContext mixing
// playback back into a capture graph. Nothing is being recorded between turns, so the silence
// between them never exists in the first place — see CallTape for why.
import { CallTape } from "./callTape";
import { MonoAudio } from "./encodeWav";

export class CallRecorder {
  private micStream: MediaStream | null = null;
  private tape = new CallTape();

  async start() {
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }

  // The push-to-talk MediaRecorder in the call page records off this stream directly.
  getMicStream() {
    return this.micStream;
  }

  // Claim the next position on the tape. Call this the moment a turn begins — the audio can be
  // handed over later, out of order, and still land where it belongs.
  reserveSlot(): number {
    return this.tape.reserve();
  }

  addClip(slot: number, clip: MonoAudio) {
    this.tape.fill(slot, clip);
  }

  // Releases the mic and returns the stitched call, or null if nothing was ever captured.
  finish(): Blob | null {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    return this.tape.render();
  }
}
