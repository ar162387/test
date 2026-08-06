import { createClient } from "@supabase/supabase-js";

// Server-side client for API routes. Prefers the service-role key when set; otherwise falls
// back to the anon key, which is safe here because RLS policies explicitly scope anon access
// to exactly the operations this app needs on contacts/call_sessions/call_turns.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase credentials are not configured");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
