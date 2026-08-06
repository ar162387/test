"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CallRecorder } from "@/lib/voice/callRecorder";
import {
  MonoAudio,
  STT_SAMPLE_RATE,
  decodeBlobToMono,
  wavBase64FromFloat32,
  wavBase64ToMono,
} from "@/lib/voice/encodeWav";
import { createBrowserClient } from "@/lib/supabase/client";
import { STAGE_LABELS } from "@/lib/script";

interface TranscriptEntry {
  role: "agent" | "homeowner";
  text: string;
  stage?: string;
  intent?: string;
  objectionKey?: string;
}

// "transcribing" and "thinking" are separate so the operator can see which leg is slow instead
// of staring at one undifferentiated "Thinking…" for the whole chain.
type Phase = "idle" | "transcribing" | "thinking";

// Reads a fetch Response as JSON, but never throws on an empty/non-JSON body (e.g. a
// serverless timeout or crash returns nothing) — returns a normalized {ok, data, error}.
async function readJson(res: Response): Promise<{ ok: boolean; data: any; error?: string }> {
  const raw = await res.text();
  if (!raw) {
    return { ok: false, data: null, error: `Empty response (HTTP ${res.status})` };
  }
  try {
    const data = JSON.parse(raw);
    return { ok: res.ok, data, error: res.ok ? undefined : data.error || `HTTP ${res.status}` };
  } catch {
    return { ok: false, data: null, error: `Non-JSON response (HTTP ${res.status})` };
  }
}

export default function CallPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const [contact, setContact] = useState<any>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [stage, setStage] = useState("opening");
  const [callStatus, setCallStatus] = useState("in_progress");
  const [phase, setPhase] = useState<Phase>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [ending, setEnding] = useState(false);
  const [draft, setDraft] = useState("");
  // loadError blocks the whole page (session missing / mic denied) — nothing recoverable.
  const [loadError, setLoadError] = useState<string | null>(null);
  // turnError is a dismissible banner for a single failed turn — the call stays usable.
  const [turnError, setTurnError] = useState<string | null>(null);
  // hint is a quiet, non-alarming note (e.g. a clip with no speech in it).
  const [hint, setHint] = useState<string | null>(null);
  // Once either voice leg reports a rate limit / permission denial, it stays down for the rest
  // of the session and the UI routes the operator to text instead of retrying into the wall.
  const [sttBlocked, setSttBlocked] = useState<number | null>(null);
  const [ttsBlocked, setTtsBlocked] = useState<number | null>(null);

  const recorderRef = useRef<CallRecorder | null>(null);
  const turnRecorderRef = useRef<MediaRecorder | null>(null);
  const turnChunksRef = useRef<Blob[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  // State updates are asynchronous. This ref closes the small window where a second pointer
  // event could start/submit another turn before the button has re-rendered as disabled.
  const turnInFlightRef = useRef(false);
  // Async callbacks capture state at creation time; these refs give them the live value.
  const sttBlockedRef = useRef<number | null>(null);
  const ttsBlockedRef = useRef<number | null>(null);
  // Playback bookkeeping: the element currently on the speakers, and a monotonic token so a
  // superseded (or barged-in) playback can detect that it is no longer the current one.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackSeqRef = useRef(0);

  const busy = phase !== "idle";
  const ended = callStatus !== "in_progress";

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Losing the mic mid-call should put the cursor where the operator now has to work.
  useEffect(() => {
    if (sttBlocked) composerRef.current?.focus();
  }, [sttBlocked]);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/session/${sessionId}`);
      const { ok, data, error } = await readJson(res);
      if (!ok) {
        setLoadError(error || "Failed to load session");
        return;
      }
      setContact(data.contact);
      setStage(data.session.current_stage);
      setCallStatus(data.session.status);

      const rec = new CallRecorder();
      recorderRef.current = rec;
      try {
        await rec.start();
      } catch {
        setLoadError("Microphone access is required to run this call.");
        return;
      }

      const savedTranscript: TranscriptEntry[] = (data.turns || []).map((t: any) => ({
        role: t.role,
        text: t.transcript,
        stage: t.stage,
        intent: t.intent,
        objectionKey: t.objection_key,
      }));
      // Every line goes up straight away; only a fresh call (greeting only) also gets spoken,
      // so a refresh restores the transcript without replaying the opener.
      setTranscript(savedTranscript);
      const openingTurn = (data.turns || []).find((t: any) => t.turn_index === 0);
      if (openingTurn && savedTranscript.length === 1) {
        void speak(openingTurn.transcript);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ---------------------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------------------

  // Stops whatever the agent is saying right now. Called when the operator starts talking
  // (barge-in) and before any new reply, so two replies can never overlap on the speakers.
  function stopPlayback() {
    playbackSeqRef.current += 1;
    const el = audioRef.current;
    if (el) {
      el.pause();
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }

  /**
   * Speaks a reply. Deliberately NOT awaited by the turn flow: the reply text is already on
   * screen by the time this runs, so audio latency no longer holds up the transcript or the
   * mic button — the two happen alongside each other rather than one after the other.
   */
  async function speak(text: string) {
    const seq = ++playbackSeqRef.current;
    const isCurrent = () => playbackSeqRef.current === seq;
    // Claimed synchronously so the agent's line holds its place on the tape even though the
    // audio itself is still several hundred milliseconds away.
    const slot = recorderRef.current?.reserveSlot();
    setSpeaking(true);

    try {
      if (ttsBlockedRef.current) {
        // Browser speech can't be captured — the slot stays empty and drops out of the tape.
        await speakWithBrowser(text, isCurrent);
        return;
      }

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const { ok, data } = await readJson(res);
      if (!isCurrent()) return;

      if (!ok) {
        if (data?.quota) {
          const status = data.status || res.status;
          ttsBlockedRef.current = status;
          setTtsBlocked(status);
        }
        // The written reply is already visible, so a dead TTS leg never loses information —
        // the browser voice just keeps the call audible while the banner explains why.
        await speakWithBrowser(text, isCurrent);
        return;
      }

      // Taped from the synthesized WAV rather than from the speakers, so the review copy is
      // clean regardless of output device, volume, or the operator talking over it.
      if (slot !== undefined) {
        recorderRef.current?.addClip(slot, wavBase64ToMono(data.audioBase64));
      }

      const audioEl = new Audio(`data:${data.mimeType};base64,${data.audioBase64}`);
      audioRef.current = audioEl;
      await audioEl.play();
      await new Promise<void>((resolve) => {
        audioEl.onended = () => resolve();
        audioEl.onerror = () => resolve();
      });
    } catch {
      // Autoplay block, decode error, network drop — fall back to the browser's built-in voice
      // so the call is never silently mute.
      if (isCurrent()) await speakWithBrowser(text, isCurrent);
    } finally {
      if (isCurrent()) {
        audioRef.current = null;
        setSpeaking(false);
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // Capture
  // ---------------------------------------------------------------------------------------

  function startTurnRecording() {
    const micStream = recorderRef.current?.getMicStream();
    if (!micStream || busy || turnInFlightRef.current || ended || sttBlocked) return;
    stopPlayback(); // barge-in: the operator talking cuts the agent off, as on a real call
    setTurnError(null);
    setHint(null);
    turnChunksRef.current = [];
    const mr = new MediaRecorder(micStream, { mimeType: "audio/webm" });
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) turnChunksRef.current.push(e.data);
    };
    mr.start();
    turnRecorderRef.current = mr;
    setRecording(true);
  }

  function stopTurnRecording() {
    const mr = turnRecorderRef.current;
    if (!mr || mr.state === "inactive") return;
    // Clear before calling stop: touch devices can emit a follow-up mouseup for the same press.
    turnRecorderRef.current = null;
    setRecording(false);
    mr.onstop = () => {
      const blob = new Blob(turnChunksRef.current, { type: "audio/webm" });
      if (blob.size < 500) return; // too short to be real speech
      void submitAudioClip(blob);
    };
    mr.stop();
  }

  // ---------------------------------------------------------------------------------------
  // Turn flow
  // ---------------------------------------------------------------------------------------

  /**
   * Transcribes a clip. Returns an empty `text` for every outcome where the operator said
   * nothing usable — empty audio, a rate limit, a transport error. The caller renders and sends
   * nothing in that case, which is the whole point: a clip that wasn't understood must not put
   * a bubble on screen or send a phantom line to the model.
   *
   * `clip` is the decoded PCM, handed back so the tape can reuse it instead of decoding the
   * same audio a second time.
   */
  async function transcribeClip(blob: Blob): Promise<{ text: string; clip: MonoAudio | null }> {
    let clip: MonoAudio;
    let wavBase64: string;
    try {
      // Convert to WAV — Gemini doesn't officially accept webm, and feeding it webm
      // produced badly wrong transcripts.
      const samples = await decodeBlobToMono(blob, STT_SAMPLE_RATE);
      clip = { samples, sampleRate: STT_SAMPLE_RATE };
      wavBase64 = wavBase64FromFloat32(samples, STT_SAMPLE_RATE);
    } catch {
      setTurnError("Couldn't process that recording — please try again.");
      return { text: "", clip: null };
    }

    let res: Response;
    try {
      res = await fetch("/api/stt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: wavBase64, mimeType: "audio/wav" }),
      });
    } catch {
      setTurnError("Transcription request failed — check your connection and try again.");
      return { text: "", clip: null };
    }

    const { ok, data, error } = await readJson(res);
    if (!ok) {
      if (data?.rateLimited) {
        const status = data.status || res.status;
        sttBlockedRef.current = status;
        setSttBlocked(status);
      } else {
        setTurnError(error || "Transcription failed — please try again.");
      }
      return { text: "", clip: null };
    }

    const text = (data.text || "").trim();
    if (!text) setHint("No speech detected in that clip — nothing was sent.");
    return { text, clip };
  }

  async function submitAudioClip(blob: Blob) {
    if (turnInFlightRef.current) return;
    turnInFlightRef.current = true;
    setTurnError(null);
    setHint(null);
    setPhase("transcribing");
    try {
      const { text, clip } = await transcribeClip(blob);
      if (!text) return; // nothing understood — no bubble, no turn, nothing on the tape
      // Only clips that became a real turn go on the tape, so it stays in step with the
      // transcript instead of collecting discarded false starts.
      const slot = recorderRef.current?.reserveSlot();
      if (slot !== undefined && clip) recorderRef.current?.addClip(slot, clip);
      // The homeowner line goes up the moment it exists, without waiting on the model.
      setTranscript((t) => [...t, { role: "homeowner", text }]);
      await runTurn(text);
    } finally {
      turnInFlightRef.current = false;
      setPhase("idle");
    }
  }

  async function sendTyped() {
    const text = draft.trim();
    if (!text || turnInFlightRef.current || ended) return;
    turnInFlightRef.current = true;
    setDraft("");
    setTurnError(null);
    setHint(null);
    stopPlayback();
    setTranscript((t) => [...t, { role: "homeowner", text }]);
    try {
      await runTurn(text);
    } finally {
      turnInFlightRef.current = false;
      setPhase("idle");
    }
  }

  async function runTurn(text: string) {
    setPhase("thinking");
    try {
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, text }),
      });
      const { ok, data, error } = await readJson(res);
      if (!ok) throw new Error(error || "Turn failed");

      setStage(data.stage);
      setCallStatus(data.callStatus);
      setTranscript((t) => [
        ...t,
        {
          role: "agent",
          text: data.reply,
          stage: data.stage,
          intent: data.intent,
          objectionKey: data.objectionKey,
        },
      ]);
      // Fire-and-forget on purpose — see speak(). The reply is readable now; the voice follows.
      void speak(data.reply);
    } catch (e: any) {
      setTurnError(e.message || "That turn failed — you can try again.");
    }
  }

  async function endCall() {
    setEnding(true);
    stopPlayback();
    try {
      // Stitching happens here, from clips already in memory — no encoder to drain, so this is
      // effectively instant even on a long call.
      const blob = recorderRef.current?.finish();
      if (blob && blob.size > 0) {
        const signRes = await fetch("/api/recording/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const { ok, data } = await readJson(signRes);
        if (ok) {
          const supabase = createBrowserClient();
          await supabase.storage.from("call-recordings").uploadToSignedUrl(data.path, data.token, blob);
        }
      }
      await fetch("/api/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } finally {
      router.push(`/sessions/${sessionId}`);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <div className="text-red-400">{loadError}</div>
        <button
          onClick={() => router.push("/")}
          className="px-4 py-2 rounded-md border border-neutral-700 hover:bg-neutral-900 text-sm"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  const micLabel = sttBlocked
    ? "Mic unavailable — type below"
    : phase === "transcribing"
    ? "Transcribing…"
    : phase === "thinking"
    ? "Thinking…"
    : recording
    ? "Release to send"
    : "Hold to talk (as homeowner)";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-medium">{contact?.full_name || "Loading…"}</div>
          <div className="text-neutral-500 text-sm">{contact?.address}</div>
        </div>
        <div className="text-right space-y-1">
          <span className="inline-block px-2 py-1 rounded bg-neutral-800 text-xs">
            {STAGE_LABELS[stage as keyof typeof STAGE_LABELS] || stage}
          </span>
          <div>
            <span
              className={`inline-block px-2 py-1 rounded text-xs ${
                callStatus === "booked"
                  ? "bg-emerald-800 text-emerald-200"
                  : callStatus === "disqualified"
                  ? "bg-red-900 text-red-200"
                  : "bg-neutral-800 text-neutral-300"
              }`}
            >
              {callStatus}
            </span>
          </div>
        </div>
      </div>

      {sttBlocked && (
        <div className="rounded-md border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
          Speech-to-text limit reached ({sttBlocked}). Please type the homeowner&apos;s reply in
          the box below — the call keeps running.
        </div>
      )}

      {ttsBlocked && (
        <div className="rounded-md border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
          Voice limit reached ({ttsBlocked}). Please continue with the written text — replies are
          still shown in full above.
        </div>
      )}

      {turnError && (
        <div className="flex items-center justify-between rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          <span>{turnError}</span>
          <button onClick={() => setTurnError(null)} className="text-red-400 hover:text-red-200 ml-3">
            ✕
          </button>
        </div>
      )}

      {hint && (
        <div className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm text-neutral-400">
          <span>{hint}</span>
          <button onClick={() => setHint(null)} className="text-neutral-500 hover:text-neutral-300 ml-3">
            ✕
          </button>
        </div>
      )}

      <div className="border border-neutral-800 rounded-lg h-96 overflow-y-auto p-4 space-y-3">
        {transcript.map((t, i) => (
          <div key={i} className={t.role === "agent" ? "text-left" : "text-right"}>
            <div
              className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                t.role === "agent" ? "bg-neutral-800" : "bg-blue-900"
              }`}
            >
              {t.text}
            </div>
            {t.objectionKey && (
              <div className="text-[10px] text-neutral-500 mt-0.5">objection: {t.objectionKey}</div>
            )}
          </div>
        ))}
        {phase === "transcribing" && <div className="text-xs text-neutral-500">Transcribing…</div>}
        {phase === "thinking" && <div className="text-xs text-neutral-500">Thinking…</div>}
        {phase === "idle" && speaking && (
          <div className="text-xs text-neutral-500">Speaking… (hold the mic to interrupt)</div>
        )}
        <div ref={transcriptEndRef} />
      </div>

      <div className="flex items-center gap-3">
        <button
          onMouseDown={startTurnRecording}
          onMouseUp={stopTurnRecording}
          onTouchStart={startTurnRecording}
          onTouchEnd={stopTurnRecording}
          disabled={busy || ended || !!sttBlocked}
          className={`flex-1 py-4 rounded-lg font-medium text-sm select-none ${
            recording ? "bg-red-600" : "bg-neutral-800 hover:bg-neutral-700"
          } disabled:opacity-40`}
        >
          {micLabel}
        </button>
        <button
          onClick={endCall}
          disabled={ending}
          className="px-4 py-4 rounded-lg border border-neutral-700 hover:bg-neutral-900 text-sm"
        >
          {ending ? "Ending…" : "End Call"}
        </button>
      </div>

      {/* Always available, not just as a fallback: typing is the fastest possible turn, and it
          is the only route left when the STT allowance is spent mid-call. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendTyped();
        }}
        className="flex items-center gap-2"
      >
        <input
          ref={composerRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy || ended}
          placeholder={
            sttBlocked
              ? "Type the homeowner's reply and press Enter"
              : "…or type the homeowner's reply"
          }
          className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-3 text-sm outline-none focus:border-neutral-600 disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={busy || ended || !draft.trim()}
          className="px-4 py-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

// Leaving `utterance.voice` unset makes the browser fall back to its cheapest local voice —
// on Windows/Linux Chrome that's the flat, robotic "Microsoft David"-style default that reads
// everything in the same dead monotone (the "vampire" voice). Every engine also ships at least
// one considerably more natural voice; picking it explicitly is the whole fix.
//
// Preference order, checked as a substring against the voice name:
//   Google voices (Chrome's network TTS) > OS "Natural"/"Neural" voices (Edge on Windows 11,
//   newer Safari) > known good OS voices (Samantha/Ava/Zira are the least robotic locally
//   installed options on Mac/Windows) > any other English voice > engine default.
const PREFERRED_VOICE_NAMES = [
  "Google US English",
  "Google UK English Female",
  "Natural",
  "Neural",
  "Samantha",
  "Ava",
  "Zira",
  "Aria",
  "Jenny",
];

let cachedVoice: SpeechSynthesisVoice | null | undefined; // undefined = not resolved yet

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = english.length ? english : voices;
  for (const name of PREFERRED_VOICE_NAMES) {
    const match = pool.find((v) => v.name.includes(name));
    if (match) return match;
  }
  return pool[0] ?? voices[0] ?? null;
}

// Voice list loads asynchronously and is often empty on the very first call — `voiceschanged`
// fires once the engine has actually enumerated its voices, so wait for that rather than
// racing it (a race would silently fall back to the robotic default on a fast page load).
function getPreferredVoice(): Promise<SpeechSynthesisVoice | null> {
  if (cachedVoice !== undefined) return Promise.resolve(cachedVoice);

  const synth = window.speechSynthesis;
  const existing = synth.getVoices();
  if (existing.length > 0) {
    cachedVoice = pickVoice(existing);
    return Promise.resolve(cachedVoice);
  }

  return new Promise((resolve) => {
    const onVoices = () => {
      synth.removeEventListener("voiceschanged", onVoices);
      cachedVoice = pickVoice(synth.getVoices());
      resolve(cachedVoice);
    };
    synth.addEventListener("voiceschanged", onVoices);
    // Some engines never fire the event at all — don't hang the call waiting for it.
    setTimeout(() => {
      synth.removeEventListener("voiceschanged", onVoices);
      if (cachedVoice === undefined) cachedVoice = pickVoice(synth.getVoices());
      resolve(cachedVoice);
    }, 500);
  });
}

// Last-resort voice: the browser's built-in speech synthesis. Free, offline, no quota — so the
// agent still has a voice even when the TTS API is exhausted. Resolves when speech finishes
// (or immediately if the browser has no synthesis support) so call pacing is unchanged.
// `isCurrent` lets a barge-in cut it off instead of talking over the next turn.
async function speakWithBrowser(text: string, isCurrent: () => boolean): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis || !isCurrent()) return;

  const voice = await getPreferredVoice();
  if (!isCurrent()) return;

  return new Promise((resolve) => {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      if (voice) utterance.voice = voice;
      // The flat default pitch is a big part of what reads as robotic/creepy — a hair above
      // neutral plus a touch more pace lands closer to a real person on a call.
      utterance.pitch = 1.05;
      utterance.rate = 1.02;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
      // Safety net: some browsers never fire onend for long strings.
      setTimeout(resolve, Math.min(30000, 400 + text.length * 70));
    } catch {
      resolve();
    }
  });
}
