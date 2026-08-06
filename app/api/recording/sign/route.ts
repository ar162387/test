import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

    const supabase = createServiceClient();
    // WAV, not webm: the client now stitches the call from decoded PCM clips rather than
    // draining a MediaRecorder, so what it uploads is a plain RIFF file.
    const path = `${sessionId}/recording.wav`;

    const { data, error } = await supabase.storage.from("call-recordings").createSignedUploadUrl(path);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await supabase.from("call_sessions").update({ recording_path: path }).eq("id", sessionId);

    return NextResponse.json({ signedUrl: data.signedUrl, path, token: data.token });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected server error" }, { status: 500 });
  }
}
