// Browser-only: mixes the mic input and every TTS playback into one MediaStream and records it
// for the duration of the call, so the review page has audio for both sides of the conversation.
export class CallRecorder {
  private ctx: AudioContext;
  private dest: MediaStreamAudioDestinationNode;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private micStream: MediaStream | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.dest = this.ctx.createMediaStreamDestination();
  }

  async start() {
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const micSource = this.ctx.createMediaStreamSource(this.micStream);
    micSource.connect(this.dest);

    this.recorder = new MediaRecorder(this.dest.stream, { mimeType: "audio/webm" });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
  }

  // Route a TTS playback element's audio into both the speakers and the recording mix.
  routePlaybackElement(audioEl: HTMLAudioElement) {
    const source = this.ctx.createMediaElementSource(audioEl);
    source.connect(this.ctx.destination); // audible to the operator
    source.connect(this.dest); // captured in the recording
  }

  getMicStream() {
    return this.micStream;
  }

  async stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.recorder) {
        resolve(new Blob());
        return;
      }
      this.recorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: "audio/webm" }));
        this.micStream?.getTracks().forEach((t) => t.stop());
      };
      this.recorder.stop();
    });
  }
}
