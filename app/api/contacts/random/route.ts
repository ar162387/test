import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = createServiceClient();
  const { count } = await supabase.from("contacts").select("*", { count: "exact", head: true });
  if (!count) return NextResponse.json({ error: "No contacts seeded" }, { status: 404 });

  const offset = Math.floor(Math.random() * count);
  const { data, error } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, full_name, phone, address")
    .range(offset, offset)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data });
}
