import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { sessionId, status } = await req.json();
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from("call_sessions")
    .select("started_at, status")
    .eq("id", sessionId)
    .single();

  const startedAt = existing?.started_at ? new Date(existing.started_at) : new Date();
  const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000));

  // Don't overwrite a terminal status (booked/disqualified) with a generic "abandoned" close.
  const finalStatus =
    status || (existing?.status === "in_progress" ? "abandoned" : existing?.status);

  const { data, error } = await supabase
    .from("call_sessions")
    .update({ ended_at: new Date().toISOString(), duration_seconds: durationSeconds, status: finalStatus })
    .eq("id", sessionId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}
