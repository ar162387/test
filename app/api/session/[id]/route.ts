import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceClient();

  const { data: session, error } = await supabase.from("call_sessions").select("*").eq("id", id).single();
  if (error || !session) return NextResponse.json({ error: error?.message || "Not found" }, { status: 404 });

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, full_name, phone, address")
    .eq("id", session.contact_id)
    .single();

  const { data: turns } = await supabase
    .from("call_turns")
    .select("*")
    .eq("session_id", id)
    .order("turn_index", { ascending: true });

  let recordingUrl: string | null = null;
  if (session.recording_path) {
    const { data: signed } = await supabase.storage
      .from("call-recordings")
      .createSignedUrl(session.recording_path, 60 * 60);
    recordingUrl = signed?.signedUrl || null;
  }

  return NextResponse.json({ session, contact, turns: turns || [], recordingUrl });
}
