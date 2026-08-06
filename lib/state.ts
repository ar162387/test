import { z } from "zod";
import { Stage, STAGE_ORDER, isLegalTransition, DqReason } from "./script";

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

  // 3. Never give up on an objection: an objection turn can never disqualify or jump to close.
  if (turn.intent === "objection") {
    if (turn.call_status === "disqualified") {
      return { ok: false, reason: "Objection turns may not disqualify the call" };
    }
    if (turn.next_stage === "recap_close" && ctx.currentStage !== "recap_close") {
      return { ok: false, reason: "Objection turns may not jump to recap_close" };
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

  // DQ can only be declared through an explicit dq_signal intent, with a real reason attached —
  // never as a side effect of an objection or a script turn giving up.
  if (turn.call_status === "disqualified") {
    if (turn.intent !== "dq_signal") {
      return { ok: false, reason: "call_status=disqualified requires intent=dq_signal" };
    }
    if (!turn.dq_reason) {
      return { ok: false, reason: "disqualified calls must carry a dq_reason" };
    }
  }

  return { ok: true };
}

export const DQ_REASONS: DqReason[] = [
  "not_homeowner",
  "condo_no_roof_ownership",
  "low_bill",
  "moving_soon",
];
