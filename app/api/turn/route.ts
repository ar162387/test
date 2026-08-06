import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/voice/stt";
import { callKimiForTurn } from "@/lib/bedrock";
import { buildSystemPrompt, Contact } from "@/lib/prompt";
import { TurnResponseSchema, guardTurn, TurnResponse } from "@/lib/state";
import { Stage, QualifyingData } from "@/lib/script";

export const runtime = "nodejs";

interface SessionRow {
  id: string;
  contact_id: string;
  current_stage: Stage;
  status: string;
  [key: string]: unknown; // qualifying-sheet columns live flat on this row
}

const QUALIFYING_KEYS: (keyof QualifyingData)[] = [
  "avg_monthly_bill",
  "home_type",
  "electricity_provider",
  "appointment_type",
  "homeowner_confirmed",
  "decision_makers",
  "roof_condition_type",
  "shading_issues",
  "credit_score_above_650",
  "taxable_income_above_45k",
  "already_has_solar",
  "language",
  "decision_makers_reminded",
  "utility_bill_reminded",
  "confirmation_call_reminded",
  "email",
  "appointment_at",
  "consultant_name",
  "extra_notes",
];

function extractQualifying(session: SessionRow): QualifyingData {
  const out: QualifyingData = {};
  for (const k of QUALIFYING_KEYS) {
    const v = session[k as string];
    if (v !== null && v !== undefined) (out as any)[k] = v;
  }
  return out;
}

// One retry with an explicit correction note if the model violates schema or guardrails —
// falls back to a safe, in-character holding line rather than ever surfacing a broken turn.
function fallbackTurn(currentStage: Stage): TurnResponse {
  return {
    intent: "script_answer",
    reply: "Sorry, could you say that one more time for me?",
    next_stage: currentStage,
    call_status: "in_progress",
  };
}

export async function POST(req: Request) {
  const body = await req.json();
  const { sessionId, audioBase64, mimeType, text: textOverride } = body;
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const supabase = createServiceClient();

  const { data: session, error: sessionErr } = await supabase
    .from("call_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (sessionErr || !session) {
    return NextResponse.json({ error: sessionErr?.message || "Session not found" }, { status: 404 });
  }

  const { data: contactRow } = await supabase
    .from("contacts")
    .select("first_name, last_name, full_name, phone, address")
    .eq("id", session.contact_id)
    .single();
  const contact = contactRow as Contact;

  // 1. STT (or a text override for the text-only debug/eval loop)
  let homeownerText: string;
  if (textOverride) {
    homeownerText = textOverride;
  } else if (audioBase64) {
    homeownerText = await transcribeAudio(audioBase64, mimeType || "audio/webm");
  } else {
    return NextResponse.json({ error: "audioBase64 or text required" }, { status: 400 });
  }

  const { data: priorTurns } = await supabase
    .from("call_turns")
    .select("turn_index, objection_key")
    .eq("session_id", sessionId)
    .order("turn_index", { ascending: true });

  const nextTurnIndex = (priorTurns?.[priorTurns.length - 1]?.turn_index ?? -1) + 1;
  const objectionHistory = Array.from(
    new Set((priorTurns || []).map((t) => t.objection_key).filter(Boolean) as string[])
  );

  await supabase.from("call_turns").insert({
    session_id: sessionId,
    turn_index: nextTurnIndex,
    role: "homeowner",
    transcript: homeownerText,
    stage: session.current_stage,
  });

  // 2. Kimi reasoning turn, with one corrective retry on schema/guard failure.
  const currentStage = session.current_stage as Stage;
  const qualifying = extractQualifying(session as SessionRow);

  async function attemptTurn(correction?: string): Promise<TurnResponse> {
    const systemPrompt =
      buildSystemPrompt({
        contact,
        currentStage,
        qualifying,
        lastHomeownerUtterance: homeownerText,
        objectionHistory,
      }) + (correction ? `\n\nIMPORTANT CORRECTION: ${correction}` : "");

    const { toolInput } = await callKimiForTurn(systemPrompt, [
      { role: "user", text: homeownerText },
    ]);
    const parsed = TurnResponseSchema.safeParse(toolInput);
    if (!parsed.success) throw new Error(`schema: ${parsed.error.message}`);

    const guard = guardTurn(parsed.data, { currentStage });
    if (!guard.ok) throw new Error(`guard: ${guard.reason}`);

    return parsed.data;
  }

  let turn: TurnResponse;
  let latencyStart = Date.now();
  try {
    turn = await attemptTurn();
  } catch (e: any) {
    try {
      turn = await attemptTurn(
        `Your previous response was rejected (${e.message}). Follow the hard rules exactly this time.`
      );
    } catch {
      turn = fallbackTurn(currentStage);
    }
  }
  const latencyMs = Date.now() - latencyStart;

  // objection_attempt: how many times this exact objection has now been raised this call
  const objectionAttempt =
    turn.intent === "objection" && turn.objection_key
      ? (priorTurns || []).filter((t) => t.objection_key === turn.objection_key).length + 1
      : undefined;

  await supabase.from("call_turns").insert({
    session_id: sessionId,
    turn_index: nextTurnIndex + 1,
    role: "agent",
    transcript: turn.reply,
    stage: turn.next_stage,
    intent: turn.intent,
    objection_key: turn.objection_key || null,
    objection_attempt: objectionAttempt,
    latency_ms: latencyMs,
  });

  const sessionUpdate: Record<string, unknown> = {
    current_stage: turn.next_stage,
    status: turn.call_status,
  };
  if (turn.dq_reason) sessionUpdate.dq_reason = turn.dq_reason;
  if (turn.extracted) {
    for (const [k, v] of Object.entries(turn.extracted)) {
      if (v !== undefined) sessionUpdate[k] = v;
    }
  }
  await supabase.from("call_sessions").update(sessionUpdate).eq("id", sessionId);

  return NextResponse.json({
    reply: turn.reply,
    stage: turn.next_stage,
    intent: turn.intent,
    objectionKey: turn.objection_key,
    callStatus: turn.call_status,
    dqReason: turn.dq_reason,
    extracted: turn.extracted,
    homeownerText,
  });
}
