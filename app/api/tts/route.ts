import { NextResponse } from "next/server";
import { synthesizeSpeech } from "@/lib/voice/tts";

export const runtime = "nodejs";
// synthesizeSpeech retries up to 3x on Gemini's intermittent TTS failure — give it headroom.
export const maxDuration = 60;

export async function POST(req: Request) {
  const { text } = await req.json();
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  try {
    const { wavBase64, mimeType } = await synthesizeSpeech(text);
    return NextResponse.json({ audioBase64: wavBase64, mimeType });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
