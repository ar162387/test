import { NextResponse } from "next/server";
import { transcribeAudio, STTRateLimitError } from "@/lib/voice/stt";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Transcription is its own round trip, separate from /api/turn.
 *
 * Why: the operator's own words are known the moment STT returns, but the reply is not known
 * until Kimi has also run. Folding both into one request meant the homeowner bubble could not
 * appear until the *whole* chain finished, so every turn felt like one long dead pause. Split
 * apart, the client renders the transcript immediately and starts the model turn in the same
 * tick — same total work, but the UI is never blank while it happens.
 *
 * A blank transcript is a 200 with an empty string, not an error: "I heard nothing" is a normal
 * outcome the client handles by showing nothing at all.
 */
export async function POST(req: Request) {
  try {
    const { audioBase64, mimeType } = await req.json();
    if (!audioBase64) {
      return NextResponse.json({ error: "audioBase64 required" }, { status: 400 });
    }

    const text = await transcribeAudio(audioBase64, mimeType || "audio/wav");
    return NextResponse.json({ text });
  } catch (e: any) {
    if (e instanceof STTRateLimitError) {
      // `rateLimited` tells the client to stop offering the mic and switch to typed input,
      // rather than showing a generic failure the operator would just retry into the same wall.
      return NextResponse.json(
        { error: e.message, rateLimited: true, status: e.status },
        { status: e.status }
      );
    }
    return NextResponse.json({ error: e?.message || "Transcription failed" }, { status: 502 });
  }
}
