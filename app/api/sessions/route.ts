import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("call_sessions")
    .select("id, status, dq_reason, current_stage, started_at, ended_at, duration_seconds, contact_id")
    .order("started_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const contactIds = Array.from(new Set((data || []).map((s) => s.contact_id)));
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, full_name")
    .in("id", contactIds.length ? contactIds : ["00000000-0000-0000-0000-000000000000"]);
  const contactMap = new Map((contacts || []).map((c) => [c.id, c.full_name]));

  const sessions = (data || []).map((s) => ({ ...s, contact_name: contactMap.get(s.contact_id) || "Unknown" }));
  return NextResponse.json({ sessions });
}
