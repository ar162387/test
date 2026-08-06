"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CallRecorder } from "@/lib/voice/callRecorder";
import { blobToWavBase64 } from "@/lib/voice/encodeWav";
import { createBrowserClient } from "@/lib/supabase/client";

interface TranscriptEntry {
  role: "agent" | "homeowner";
  text: string;
  stage?: string;
  intent?: string;
  objectionKey?: string;
}

const STAGE_LABELS: Record<string, string> = {
  opening: "Opening",
  reason_for_call: "Reason for Call",
  qualifying: "Qualifying Questions",
  bill_swap: "Bill Swap",
  decision_makers: "Decision Makers",
  set_appointment: "Set Appointment",
  lock_confirm: "Lock & Confirm",
  recap_close: "Recap & Close",
};

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
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [ending, setEnding] = useState(false);
  // loadError blocks the whole page (session missing / mic denied) — nothing recoverable.
  const [loadError, setLoadError] = useState<string | null>(null);
  // turnError is a dismissible banner for a single failed turn — the call stays usable.
  const [turnError, setTurnError] = useState<string | null>(null);

  const recorderRef = useRef<CallRecorder | null>(null);
  const turnRecorderRef = useRef<MediaRecorder | null>(null);
  const turnChunksRef = useRef<Blob[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  // State updates are asynchronous. This ref closes the small window where a second pointer
  // event could start/submit another turn before `busy` has re-rendered the button disabled.
  const turnInFlightRef = useRef(false);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

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
      const openingTurn = (data.turns || []).find((t: any) => t.turn_index === 0);
      if (openingTurn && savedTranscript.length === 1) {
        await playText(openingTurn.transcript, () =>
          setTranscript(savedTranscript)
        );
      } else {
        // A resumed/refreshed call should restore every turn without replaying the greeting.
        setTranscript(savedTranscript);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Fetches TTS audio and plays it. `onReady` fires on the audio element's "playing" event —
  // i.e. the instant sound actually reaches the speakers — so the transcript bubble appears in
  // step with the voice rather than seconds ahead of it. If audio can't play at all we still
  // fire it once, so a failed TTS never leaves a line missing from the transcript.
  async function playText(text: string, onReady: () => void) {
    let revealed = false;
    const revealOnce = () => {
      if (!revealed) {
        revealed = true;
        onReady();
      }
    };

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const { ok, data } = await readJson(res);
      if (!ok) {
        // Server TTS unavailable (most often a Gemini quota 429). Speak with the browser voice
        // rather than showing a silent line.
        revealOnce();
        if (data?.quota) setTurnError("Gemini TTS quota reached — using the browser voice.");
        await speakWithBrowser(text);
        return;
      }

      const audioEl = new Audio(`data:${data.mimeType};base64,${data.audioBase64}`);
      recorderRef.current?.routePlaybackElement(audioEl);
      audioEl.addEventListener("playing", revealOnce, { once: true });

      // Playback is routed through the recorder's AudioContext so the call recording captures
      // the agent's side. If that context is suspended (browser autoplay policy) the audio is
      // silently swallowed, so make sure it's running first.
      await recorderRef.current?.ensureRunning();

      await audioEl.play();
      await new Promise((resolve) => {
        audioEl.onended = resolve;
        audioEl.onerror = resolve;
      });
    } catch {
      // Real TTS unavailable (quota, autoplay block, decode error) — fall back to the browser's
      // built-in voice so the call is never silently mute. Lower quality, but always available.
      revealOnce();
      await speakWithBrowser(text);
    } finally {
      revealOnce();
    }
  }

  function startTurnRecording() {
    const micStream = recorderRef.current?.getMicStream();
    if (!micStream || busy || turnInFlightRef.current || callStatus !== "in_progress") return;
    setTurnError(null);
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
    mr.onstop = async () => {
      const blob = new Blob(turnChunksRef.current, { type: "audio/webm" });
      if (blob.size < 500) return; // too short to be real speech
      try {
        // Convert to WAV — Gemini doesn't officially accept webm, and feeding it webm
        // produced badly wrong transcripts.
        const wavBase64 = await blobToWavBase64(blob);
        await handleTurn(wavBase64, "audio/wav");
      } catch {
        setTurnError("Couldn't process that recording — please try again.");
      }
    };
    mr.stop();
  }

  async function handleTurn(audioBase64: string, mimeType: string) {
    if (turnInFlightRef.current) return;
    turnInFlightRef.current = true;
    setBusy(true);
    setTurnError(null);
    try {
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, audioBase64, mimeType }),
      });
      const { ok, data, error } = await readJson(res);
      if (!ok) throw new Error(error || "Turn failed");

      setTranscript((t) => [...t, { role: "homeowner", text: data.homeownerText || "(inaudible)" }]);
      setStage(data.stage);
      setCallStatus(data.callStatus);

      await playText(data.reply, () =>
        setTranscript((t) => [
          ...t,
          { role: "agent", text: data.reply, stage: data.stage, intent: data.intent, objectionKey: data.objectionKey },
        ])
      );
    } catch (e: any) {
      setTurnError(e.message || "That turn failed — you can try again.");
    } finally {
      turnInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function endCall() {
    setEnding(true);
    try {
      const blob = await recorderRef.current?.stop();
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

  const ended = callStatus !== "in_progress";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-medium">{contact?.full_name || "Loading…"}</div>
          <div className="text-neutral-500 text-sm">{contact?.address}</div>
        </div>
        <div className="text-right space-y-1">
          <span className="inline-block px-2 py-1 rounded bg-neutral-800 text-xs">
            {STAGE_LABELS[stage] || stage}
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

      {turnError && (
        <div className="flex items-center justify-between rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          <span>{turnError}</span>
          <button onClick={() => setTurnError(null)} className="text-red-400 hover:text-red-200 ml-3">
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
        {busy && <div className="text-xs text-neutral-500">Thinking…</div>}
        <div ref={transcriptEndRef} />
      </div>

      <div className="flex items-center gap-3">
        <button
          onMouseDown={startTurnRecording}
          onMouseUp={stopTurnRecording}
          onTouchStart={startTurnRecording}
          onTouchEnd={stopTurnRecording}
          disabled={busy || ended}
          className={`flex-1 py-4 rounded-lg font-medium text-sm select-none ${
            recording ? "bg-red-600" : "bg-neutral-800 hover:bg-neutral-700"
          } disabled:opacity-40`}
        >
          {busy ? "Thinking…" : recording ? "Release to send" : "Hold to talk (as homeowner)"}
        </button>
        <button
          onClick={endCall}
          disabled={ending}
          className="px-4 py-4 rounded-lg border border-neutral-700 hover:bg-neutral-900 text-sm"
        >
          {ending ? "Ending…" : "End Call"}
        </button>
      </div>
    </div>
  );
}

// Last-resort voice: the browser's built-in speech synthesis. Free, offline, no quota — so the
// agent always has a voice even when the TTS API is exhausted. Resolves when speech finishes
// (or immediately if the browser has no synthesis support) so call pacing is unchanged.
function speakWithBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05; // a touch quicker than default reads more naturally on a call
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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
