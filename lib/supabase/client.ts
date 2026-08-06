import { createClient } from "@supabase/supabase-js";

// Browser client using the anon key — read-only per RLS policies.
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anonKey);
}
