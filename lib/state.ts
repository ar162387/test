import { z } from "zod";
import { Stage, STAGE_ORDER, isLegalTransition, DqReason } from "./script";
import { getObjection } from "./objections";

export const TurnIntent = z.enum(["script_answer", "objection", "out_of_scope", "dq_signal"]);
export type TurnIntent = z.infer<typeof TurnIntent>;

export const QualifyingDataSchema = z
  .object({
    avg_monthly_bill: z.number().optional(),
    home_type: z.enum(["single_family", "condo", "townhome"]).optional(),
    electricity_provider: z.string().optional(),
    appointment_type: z.enum(["in_home", "virtual"]).optional(),
    homeowner_confirmed: z.boolean().optional(),
    decision_makers: z.array(z.string()).optional(),
    roof_condition_type: z.string().optional(),
    shading_issues: z.string().optional(),
    credit_score_above_650: z.union([z.boolean(), z.literal("unsure")]).optional(),
    taxable_income_above_45k: z.union([z.boolean(), z.literal("unsure")]).optional(),
    already_has_solar: z.boolean().optional(),
    language: z.string().optional(),
    decision_makers_reminded: z.boolean().optional(),
    utility_bill_reminded: z.boolean().optional(),
    confirmation_call_reminded: z.boolean().optional(),
    email: z.string().optional(),
    appointment_at: z.string().optional(),
    consultant_name: z.string().optional(),
    extra_notes: z.string().optional(),
  })
  .partial();

export const TurnResponseSchema = z.object({
  intent: TurnIntent,
  objection_key: z.string().optional(),
  reply: z.string().min(1),
  next_stage: z.enum(STAGE_ORDER as [Stage, ...Stage[]]),
  extracted: QualifyingDataSchema.optional(),
  call_status: z.enum(["in_progress", "booked", "disqualified"]),
  dq_reason: z
    .enum(["not_homeowner", "condo_no_roof_ownership", "low_bill", "moving_soon"])
    .optional(),
});
export type TurnResponse = z.infer<typeof TurnResponseSchema>;

export interface GuardContext {
  currentStage: Stage;
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
  corrected?: Partial<TurnResponse>;
}

/**
 * Structural enforcement of the four hard requirements. This runs AFTER schema validation
 * and BEFORE a turn is persisted or spoken. The model proposes; this function disposes.
 */
export function guardTurn(turn: TurnResponse, ctx: GuardContext): GuardResult {
  // 1. Follow the script: next_stage must be a legal transition from the current stage.
  if (!isLegalTransition(ctx.currentStage, turn.next_stage)) {
    return {
      ok: false,
      reason: `Illegal stage transition ${ctx.currentStage} -> ${turn.next_stage}`,
    };
  }

  // 2. Handle objections properly: objection turns must carry a resolvable objection_key.
  if (turn.intent === "objection" && !turn.objection_key) {
    return { ok: false, reason: "intent=objection but no objection_key provided" };
  }

  // 3. Never give up on an objection — with one carve-out. Some sheet entries ARE the
  // disqualifier (renter, bill under $60, moving within 6 months); those are marked
  // isDqCandidate. Blocking those outright would mean a renter could never be disqualified,
  // since "I rent" is itself an objection-sheet entry.
  if (turn.intent === "objection") {
    const objection = turn.objection_key ? getObjection(turn.objection_key) : undefined;
    if (turn.call_status === "disqualified" && !isDqCandidateKey(turn.objection_key)) {
      return { ok: false, reason: "Objection turns may not disqualify the call" };
    }
    if (turn.next_stage === "recap_close" && ctx.currentStage !== "recap_close") {
      return { ok: false, reason: "Objection turns may not jump to recap_close" };
    }
    if (
      objection?.category === "late" &&
      turn.call_status !== "disqualified" &&
      !/does that sound fair\??/i.test(turn.reply)
    ) {
      return {
        ok: false,
        reason: 'Late objection replies must complete the framework with "Does that sound fair?"',
      };
    }
  }

  // 4. Reject out-of-scope requests: no stage advance, no data extraction, no DQ.
  if (turn.intent === "out_of_scope") {
    if (turn.next_stage !== ctx.currentStage) {
      return { ok: false, reason: "out_of_scope turns must not advance the stage" };
    }
    if (turn.extracted && Object.keys(turn.extracted).length > 0) {
      return { ok: false, reason: "out_of_scope turns must not extract data" };
    }
    if (turn.call_status !== "in_progress") {
      return { ok: false, reason: "out_of_scope turns must not change call_status" };
    }
  }

  // DQ must come from an explicit dq_signal, or from one of the objection-sheet entries that
  // is itself a disqualifier — never as a side effect of a plain script turn giving up.
  if (turn.call_status === "disqualified") {
    const viaDqObjection = turn.intent === "objection" && isDqCandidateKey(turn.objection_key);
    if (turn.intent !== "dq_signal" && !viaDqObjection) {
      return { ok: false, reason: "call_status=disqualified requires intent=dq_signal" };
    }
    if (!turn.dq_reason) {
      return { ok: false, reason: "disqualified calls must carry a dq_reason" };
    }
  }

  return { ok: true };
}

function isDqCandidateKey(key?: string): boolean {
  if (!key) return false;
  const objection = getObjection(key);
  return !!objection && objection.category === "late" && objection.isDqCandidate === true;
}

export const DQ_REASONS: DqReason[] = [
  "not_homeowner",
  "condo_no_roof_ownership",
  "low_bill",
  "moving_soon",
];
