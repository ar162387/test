// Transcribed verbatim from Solar_Sales_Script_v2.pdf.
// [BRACKETED] tokens are placeholders filled from the active contact/session at render time.

export type Stage =
  | "opening"
  | "reason_for_call"
  | "qualifying"
  | "bill_swap"
  | "decision_makers"
  | "set_appointment"
  | "lock_confirm"
  | "recap_close";

export const STAGE_ORDER: Stage[] = [
  "opening",
  "reason_for_call",
  "qualifying",
  "bill_swap",
  "decision_makers",
  "set_appointment",
  "lock_confirm",
  "recap_close",
];

// A stage may only ever advance to itself (stay) or the next stage in STAGE_ORDER.
// Objection-mode turns are handled separately in lib/state.ts and never touch this map directly.
export function isLegalTransition(from: Stage, to: Stage): boolean {
  const fromIdx = STAGE_ORDER.indexOf(from);
  const toIdx = STAGE_ORDER.indexOf(to);
  return toIdx === fromIdx || toIdx === fromIdx + 1;
}

export interface StageDefinition {
  stage: Stage;
  title: string;
  lines: string[];
  directions?: string; // stage-direction / delivery notes from the PDF, folded into the prompt
}

export const SCRIPT: StageDefinition[] = [
  {
    stage: "opening",
    title: "Opening (The Hook)",
    directions:
      "Say their name with genuine curiosity, as if confirming you have the right person. Sound slightly doubtful/skeptical, not salesy.",
    lines: [
      `"Hey [NAME]?"`,
      `"Hey, how's it going? This is just [YOUR NAME]. We're actually working right in the corner of your neighborhood — we're going to be here for the next couple of weeks. Am I speaking with the owner of [ADDRESS]?"`,
      `[Wait for confirmation. If not the owner, ask: "Could you put the homeowner on the line for me?"]`,
    ],
  },
  {
    stage: "reason_for_call",
    title: "Reason for the Call",
    lines: [
      `"Ok great — so the reason for my call is because we're working with a few of your neighbors regarding a recent complaint that was filed about rate increases in your area. I'm not sure if you got that letter; it should've been sent to [ADDRESS]."`,
      `[Pause. Let them respond.]`,
      `"You didn't get it? Okay, let me put a note down here..." [If they say they did get it, say: "Perfect, then you already know what I'm calling about." Continue below.]`,
      `"Yeah, so here's the deal — good news and bad news. Due to high upkeep costs on the grid, a lot of homes in your area are getting hit with rate increases and even power outages. We're working with some of your neighbors right now to see if their home qualifies for a program called SGIP — the Self-Generation Incentive Program. In short, it's a government-backed program designed to help homeowners like you lower your electricity bill and protect against those rate hikes."`,
    ],
  },
  {
    stage: "qualifying",
    title: "Qualifying Questions",
    lines: [
      `"Let me just ask you a few quick things to see if your home is a fit."`,
      `1. "I'm assuming you're paying more than $150 a month on electricity, right?" [If yes: "Ok, it does seem like the area was affected." If no: proceed to next question.]`,
      `2. "What would you say is your average monthly bill?" [React with genuine surprise if it's high: "Wow, that is really high — it definitely seems like they're charging you a lot."]`,
      `3. "Is this a single-family home? And do you own the roof?" [If condo/townhome and they don't own the roof → DISQUALIFY. If single-family, continue.]`,
      `4. "Because this is government-sponsored, there is a minimum credit score of 650 to be eligible. Do you know if yours is above that?" [If unsure, reassure them: "That's fine — the engineer can help verify during the consultation."]`,
      `5. "Do you have any large trees or structures that block your roof from direct sunlight?" [Major shading → note it, may still qualify.]`,
      `6. "And who is your current electricity provider?" [Note for records.]`,
    ],
  },
  {
    stage: "bill_swap",
    title: "The Bill Swap (Value Pitch)",
    directions:
      "This is NOT a traditional solar sale — position it as a savings consultation. They don't have to buy anything; they just have to qualify.",
    lines: [
      `"Ok, so here's how this works. See how you're paying [BILL AMOUNT] every month to [UTILITY PROVIDER]? What this program is designed to do is potentially reduce that bill down to zero. All you'd be paying for is the solar equipment — and that payment will be 20 to 50% cheaper than what you're paying now. On top of that, it's locked in — it never goes up with inflation. And it adds value to your home."`,
      `"In some cases, the program is fully government-funded, so there's nothing out of pocket. But the engineers will be the ones to determine exactly what the best setup is for your home and how much you'll save."`,
    ],
  },
  {
    stage: "decision_makers",
    title: "Identify Decision Makers",
    directions:
      "Note their name(s). This is critical — you MUST confirm they will be present at the appointment later.",
    lines: [
      `"Now before we get you scheduled — are there any other decision makers in the household? A spouse or partner who would need to be part of this conversation?"`,
    ],
  },
  {
    stage: "set_appointment",
    title: "Set the Appointment",
    lines: [
      `"Perfect. So what we'll do is get one of our engineers out to take a look at your home. It'll take about 10 to 15 minutes to evaluate, and another 10 to 15 to walk you through exactly what you qualify for and how much you can save. They're not in a rush, so if you have any questions, they'll be right there to answer everything."`,
      `"Does morning or afternoon work better for you?" [Let them choose, then offer a specific time within that window.]`,
      `"Great — I have [APPOINTMENT DATE & TIME] open. Does that work for you?"`,
    ],
  },
  {
    stage: "lock_confirm",
    title: "Lock & Confirm the Appointment",
    lines: [
      `"Awesome. Now [NAME], just to be sure — is there anything that would keep you from being available at [APPOINTMENT DATE & TIME]? A doctor's appointment, another commitment, anything at all around that time?" [Wait for their answer. Resolve any conflicts now, not later.]`,
      `"And you mentioned [SPOUSE/PARTNER NAME] — they're going to be there at [APPOINTMENT DATE & TIME] as well, right?" [If not: "What time do they usually get home? Let's find a time that works for both of you." Adjust appointment if needed.]`,
      `"Is [PHONE NUMBER — last four digits] the best number to text the confirmation to?" [Confirm or update.]`,
    ],
  },
  {
    stage: "recap_close",
    title: "Quick Recap & Close",
    lines: [
      `"Alright [NAME], let me just quickly go over what's happening so we're on the same page:"`,
      `• Our consultant [CONSULTANT NAME] will be coming to your home at [ADDRESS] on [APPOINTMENT DATE & TIME].`,
      `• He/she will call you before heading over to make sure everything is still good.`,
      `• Please have a copy of your most recent electricity bill ready — that way they can give you the most accurate savings estimate.`,
      `• Make sure all decision makers ([NAMES]) are present so you can make the best decision together.`,
      `• This consultation is to help you save money on your electricity — there is nothing out of pocket. The engineer will determine if you qualify and walk you through exactly how much you can save.`,
      `"Do you have any questions for me before we wrap up?"`,
      `"Alright, [NAME] — thanks so much for your time. You're all set with [CONSULTANT NAME] on [APPOINTMENT DATE & TIME]. Have a great rest of your day, and we'll see you then!"`,
    ],
  },
];

// Short display labels for STAGE_ORDER, shared between the live call view and the past-calls
// list so both name a stage the same way.
export const STAGE_LABELS: Record<Stage, string> = {
  opening: "Opening",
  reason_for_call: "Reason for Call",
  qualifying: "Qualifying Questions",
  bill_swap: "Bill Swap",
  decision_makers: "Decision Makers",
  set_appointment: "Set Appointment",
  lock_confirm: "Lock & Confirm",
  recap_close: "Recap & Close",
};

export function getStageDefinition(stage: Stage): StageDefinition {
  const def = SCRIPT.find((s) => s.stage === stage);
  if (!def) throw new Error(`Unknown stage: ${stage}`);
  return def;
}

// Every field on the PDF's "Qualifying Notes" sheet — mirrors call_sessions columns.
export interface QualifyingData {
  avg_monthly_bill?: number;
  home_type?: "single_family" | "condo" | "townhome";
  electricity_provider?: string;
  appointment_type?: "in_home" | "virtual";
  homeowner_confirmed?: boolean;
  decision_makers?: string[];
  roof_condition_type?: string;
  shading_issues?: string;
  credit_score_above_650?: boolean | "unsure";
  taxable_income_above_45k?: boolean | "unsure";
  already_has_solar?: boolean;
  language?: string;
  decision_makers_reminded?: boolean;
  utility_bill_reminded?: boolean;
  confirmation_call_reminded?: boolean;
  email?: string;
  appointment_at?: string; // ISO
  consultant_name?: string;
  extra_notes?: string;
}

export type DqReason =
  | "not_homeowner"
  | "condo_no_roof_ownership"
  | "low_bill"
  | "moving_soon";

export const DQ_REASON_LABELS: Record<DqReason, string> = {
  not_homeowner: "Renter / not the homeowner",
  condo_no_roof_ownership: "Condo or townhome, no roof ownership",
  low_bill: "Average monthly bill under $60",
  moving_soon: "Planning to move within 6 months",
};
