import { NextResponse } from "next/server";
import { synthesizeSpeech, TTSQuotaError } from "@/lib/voice/tts";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    const { wavBase64, mimeType } = await synthesizeSpeech(text);
    return NextResponse.json({ audioBase64: wavBase64, mimeType });
  } catch (e: any) {
    // `quota: true` tells the client to fall back to browser speech synthesis rather than
    // playing the turn silently — the call keeps its voice even with the API exhausted.
    if (e instanceof TTSQuotaError) {
      return NextResponse.json({ error: e.message, quota: true }, { status: 429 });
    }
    return NextResponse.json({ error: e?.message || "TTS failed" }, { status: 502 });
  }
}
