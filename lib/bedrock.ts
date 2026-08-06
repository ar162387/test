// Amazon Bedrock Runtime client using API-key (bearer token) auth — no IAM/SigV4 required.
// https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-use.html

const REGION = process.env.BEDROCK_REGION || "us-east-1";
const MODEL_ID = process.env.BEDROCK_MODEL_ID || "moonshotai.kimi-k2.5";
const TOKEN = process.env.AWS_BEARER_TOKEN_BEDROCK;

const TURN_TOOL_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["script_answer", "objection", "out_of_scope", "dq_signal"],
    },
    objection_key: { type: "string" },
    reply: { type: "string", description: "Exactly what the agent says out loud, in character." },
    next_stage: {
      type: "string",
      enum: [
        "opening",
        "reason_for_call",
        "qualifying",
        "bill_swap",
        "decision_makers",
        "set_appointment",
        "lock_confirm",
        "recap_close",
      ],
    },
    extracted: {
      type: "object",
      description: "Any qualifying-sheet fields learned this turn. Omit fields not learned.",
      properties: {
        avg_monthly_bill: { type: "number" },
        home_type: { type: "string", enum: ["single_family", "condo", "townhome"] },
        electricity_provider: { type: "string" },
        appointment_type: { type: "string", enum: ["in_home", "virtual"] },
        homeowner_confirmed: { type: "boolean" },
        decision_makers: { type: "array", items: { type: "string" } },
        roof_condition_type: { type: "string" },
        shading_issues: { type: "string" },
        credit_score_above_650: {
          oneOf: [{ type: "boolean" }, { type: "string", enum: ["unsure"] }],
        },
        taxable_income_above_45k: {
          oneOf: [{ type: "boolean" }, { type: "string", enum: ["unsure"] }],
        },
        already_has_solar: { type: "boolean" },
        language: { type: "string" },
        decision_makers_reminded: { type: "boolean" },
        utility_bill_reminded: { type: "boolean" },
        confirmation_call_reminded: { type: "boolean" },
        email: { type: "string" },
        appointment_at: { type: "string" },
        consultant_name: { type: "string" },
        extra_notes: { type: "string" },
      },
    },
    call_status: { type: "string", enum: ["in_progress", "booked", "disqualified"] },
    dq_reason: {
      type: "string",
      enum: ["not_homeowner", "condo_no_roof_ownership", "low_bill", "moving_soon"],
    },
  },
  required: ["intent", "reply", "next_stage", "call_status"],
};

export interface BedrockMessage {
  role: "user" | "assistant";
  text: string;
}

export interface CallKimiResult {
  raw: unknown;
  toolInput: Record<string, unknown> | null;
}

export async function callKimiForTurn(
  systemPrompt: string,
  messages: BedrockMessage[]
): Promise<CallKimiResult> {
  if (!TOKEN) throw new Error("AWS_BEARER_TOKEN_BEDROCK is not set");

  const body = {
    system: [{ text: systemPrompt }],
    messages: messages.map((m) => ({ role: m.role, content: [{ text: m.text }] })),
    toolConfig: {
      toolChoice: { tool: { name: "submit_turn" } },
      tools: [
        {
          toolSpec: {
            name: "submit_turn",
            description: "Submit the structured result of this conversation turn.",
            inputSchema: { json: TURN_TOOL_JSON_SCHEMA },
          },
        },
      ],
    },
    inferenceConfig: { temperature: 0.7, maxTokens: 1024 },
  };

  const res = await fetch(
    `https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(MODEL_ID)}/converse`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Bedrock converse failed: ${res.status} ${errText}`);
  }

  const json = await res.json();
  const content = json?.output?.message?.content ?? [];
  const toolUse = content.find((c: any) => c.toolUse)?.toolUse;
  return { raw: json, toolInput: toolUse?.input ?? null };
}
