import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { renderOpeningLine, renderSecondOpeningLine } from "@/lib/render";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { contactId } = await req.json();
  if (!contactId) return NextResponse.json({ error: "contactId required" }, { status: 400 });

  const supabase = createServiceClient();
  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, full_name, phone, address")
    .eq("id", contactId)
    .single();
  if (contactErr || !contact) {
    return NextResponse.json({ error: contactErr?.message || "Contact not found" }, { status: 404 });
  }

  const { data: session, error: sessionErr } = await supabase
    .from("call_sessions")
    .insert({ contact_id: contact.id, status: "in_progress", current_stage: "opening" })
    .select()
    .single();
  if (sessionErr) return NextResponse.json({ error: sessionErr.message }, { status: 500 });

  const line1 = renderOpeningLine(contact);
  const line2 = renderSecondOpeningLine(contact);
  const openingReply = `${line1} ... ${line2}`;

  await supabase.from("call_turns").insert({
    session_id: session.id,
    turn_index: 0,
    role: "agent",
    transcript: openingReply,
    stage: "opening",
  });

  return NextResponse.json({ session, contact, openingReply });
}
