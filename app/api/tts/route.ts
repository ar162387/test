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
    // `quota: true` tells the client to stop calling this route for the rest of the session and
    // tell the operator to read the written reply — retrying a spent allowance only adds delay.
    if (e instanceof TTSQuotaError) {
      return NextResponse.json(
        { error: e.message, quota: true, status: e.status },
        { status: e.status }
      );
    }
    return NextResponse.json({ error: e?.message || "TTS failed" }, { status: 502 });
  }
}
