"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CallRecorder } from "@/lib/voice/callRecorder";
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
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<CallRecorder | null>(null);
  const turnRecorderRef = useRef<MediaRecorder | null>(null);
  const turnChunksRef = useRef<Blob[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/session/${sessionId}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to load session");
        return;
      }
      setContact(json.contact);
      setStage(json.session.current_stage);
      setCallStatus(json.session.status);

      const rec = new CallRecorder();
      recorderRef.current = rec;
      try {
        await rec.start();
      } catch {
        setError("Microphone access is required to run this call.");
        return;
      }

      const openingTurn = (json.turns || []).find((t: any) => t.turn_index === 0);
      if (openingTurn) {
        setTranscript([{ role: "agent", text: openingTurn.transcript, stage: "opening" }]);
        await playText(openingTurn.transcript);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function playText(text: string) {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (!res.ok) return;
      const audioEl = new Audio(`data:${json.mimeType};base64,${json.audioBase64}`);
      recorderRef.current?.routePlaybackElement(audioEl);
      await audioEl.play();
      await new Promise((resolve) => {
        audioEl.onended = resolve;
      });
    } catch {
      // Non-fatal — transcript still shows the line even if audio playback failed.
    }
  }

  function startTurnRecording() {
    const micStream = recorderRef.current?.getMicStream();
    if (!micStream || busy || callStatus !== "in_progress") return;
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
    if (!mr) return;
    setRecording(false);
    mr.onstop = async () => {
      const blob = new Blob(turnChunksRef.current, { type: "audio/webm" });
      if (blob.size < 500) return; // too short to be real speech
      const base64 = await blobToBase64(blob);
      await handleTurn(base64, "audio/webm");
    };
    mr.stop();
  }

  async function handleTurn(audioBase64: string, mimeType: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, audioBase64, mimeType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Turn failed");

      setTranscript((t) => [
        ...t,
        { role: "homeowner", text: json.homeownerText || "(inaudible)" },
        { role: "agent", text: json.reply, stage: json.stage, intent: json.intent, objectionKey: json.objectionKey },
      ]);
      setStage(json.stage);
      setCallStatus(json.callStatus);

      await playText(json.reply);
    } catch (e: any) {
      setError(e.message);
    } finally {
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
        const signJson = await signRes.json();
        if (signRes.ok) {
          const supabase = createBrowserClient();
          await supabase.storage.from("call-recordings").uploadToSignedUrl(signJson.path, signJson.token, blob);
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

  if (error) {
    return <div className="text-red-400">{error}</div>;
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
