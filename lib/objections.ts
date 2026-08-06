// Transcribed verbatim from "2nd day Objection sheet.md".

export type ObjectionCategory = "early" | "late";

export interface EarlyObjection {
  key: string;
  category: "early";
  trigger: string;
  agree: string;
  resume: string;
}

export interface LateObjection {
  key: string;
  category: "late";
  trigger: string;
  response: string; // may itself contain the conditional branches from the sheet
  isDqCandidate?: boolean;
}

export type Objection = EarlyObjection | LateObjection;

// --- EARLY OBJECTIONS — A.I.R. framework (Agree, Ignore, Resume) ---
// Smokescreens, not real objections. Disarm and continue the script — never argue, never sell here.
export const EARLY_OBJECTIONS: EarlyObjection[] = [
  {
    key: "early.not_interested",
    category: "early",
    trigger: "I'm not interested.",
    agree: "Totally understand, sir. And just to clarify—I'm not trying to sell you anything.",
    resume: "All I'm doing is letting you know what's happening in your area so you're aware…",
  },
  {
    key: "early.im_busy",
    category: "early",
    trigger: "I'm busy.",
    agree: "Of course, I get that. I'll keep this super short.",
    resume: "You're probably seeing more solar panels pop up nearby, and that's what this is about…",
  },
  {
    key: "early.send_me_email",
    category: "early",
    trigger: "Send me an email.",
    agree: "Sure… What's your email??—just to be sure it's relevant, let me ask you real quick…",
    resume: "Before I can get you that email I just need to qualify you here in the system…",
  },
  {
    key: "early.call_me_back",
    category: "early",
    trigger: "Call me back.",
    agree: "Of course, I can do that. Just before I let you go—super quick—do you still live at [ADDRESS]?",
    resume: "This will only take 30 seconds and then I'll let you go, promise…",
  },
  {
    key: "early.how_did_you_get_my_number",
    category: "early",
    trigger: "How did you get my number?",
    agree: "Totally fair question—we're only reaching out to homeowners in your zip code.",
    resume: "You actually weren't 'targeted' personally, this is just for homes that qualify…",
  },
  {
    key: "early.fifth_person_to_call",
    category: "early",
    trigger: "You're the 5th person to call me!",
    agree: "Yea we've been trying to reach you about some important updates regarding the electricity.",
    resume: "We're just doing a short info call to see if your property qualifies.",
  },
];

// --- LATE OBJECTIONS — 5-step framework ---
// 1. Agree  2. Brief answer  3. "If [X] wasn't a problem, is solar something you'll do, or is
// something else holding you back?"  4. "I'll put a note for the engineer to explain it fully."
// 5. "Does that sound fair?"  6. Resume.
export const LATE_OBJECTIONS: LateObjection[] = [
  // Part 1 — Installation
  {
    key: "late.no_holes_in_roof",
    category: "late",
    trigger: "I don't want holes in my roof.",
    response:
      "Got it, sir. Absolutely. That is exactly the reason why I'm calling you. We actually use a new way of installation with K2 racketing, which ensures proper installation with seals on both the top and bottom. You're also covered with a 10-year warranty on the roof. If anything were to happen, we'll replace it, and the finance company also assumes responsibility in that case.",
  },
  {
    key: "late.old_roof",
    category: "late",
    trigger: "My roof is too old / I'm replacing my roof.",
    response:
      "Totally understand, sir. In that case, we can actually add a new roof into the project. You may even be able to get the roof done for free. I'm not promising that, but that's what we've seen happen for some of our clients.",
  },
  {
    key: "late.special_roof",
    category: "late",
    trigger: "I have a flat/tile/special roof.",
    response:
      "That's not a problem at all, sir. We can work with all roof types—flat, tile, shingle, anything. We've done it all before.",
  },
  {
    key: "late.leak_worry",
    category: "late",
    trigger: "I'm worried about leaks from the installation.",
    response:
      "Totally fair concern. That's why we include a workmanship warranty—so if anything goes wrong due to the installation, it's covered for up to 10 years.",
  },
  {
    key: "late.dont_like_look",
    category: "late",
    trigger: "I don't like how the panels will look.",
    response:
      "Got it, sir. We can definitely explore placing them on a side of the home that's less visible, like the back. Also, the panels we use are completely black—they blend in with the roof and are barely noticeable. If we place them on the backside, you'll almost forget they're there. And to be honest, it blends in so well it ends up looking clean.",
  },
  // Part 1 — Financial / ROI
  {
    key: "late.no_roi",
    category: "late",
    trigger: "I don't see the return on investment.",
    response:
      "Absolutely, sir. I agree—and that's because there actually is no investment. ROI means you're putting your own money in, but with this, you're not. What we're offering today doesn't require any upfront investment—you're just shifting where your money goes. Instead of paying the electric company, you'll save from month one.",
  },
  {
    key: "late.dont_want_another_bill",
    category: "late",
    trigger: "I don't want another bill.",
    response:
      "Completely understand, sir. A lot of homeowners say the same thing—they don't want another stressor. That's why this isn't about adding a bill. We're aiming to eliminate your electric bill completely and replace it with one that's usually 30 to 50% cheaper.",
  },
  {
    key: "late.bills_already_low",
    category: "late",
    trigger: "My electricity bills are already low.",
    response:
      "Got it. If you don't mind me asking—how much are you currently paying? " +
      "— If more than $150: \"Perfect. We can probably reduce that significantly.\" " +
      "— If less than $60: \"I'll be honest, sir, it might not be worth it for you, and we'd likely disqualify the property.\" " +
      "— If between $60 and $150: \"In that range, we can usually still help you save and lock in a fixed rate—so you're not at the mercy of rate hikes every month. Wouldn't it be nice to just know exactly what you're paying, no surprises?\"",
    isDqCandidate: true, // <$60/mo is a real DQ per the qualifying script
  },
  // Part 2 — Additional financial
  {
    key: "late.whats_the_catch",
    category: "late",
    trigger: "What's the catch?",
    response:
      "Sir, the only catch is—you need to qualify. That's what this whole call is about. If you qualify, you simply switch to a better energy provider at a locked-in, lower rate.",
  },
  {
    key: "late.dont_want_to_finance",
    category: "late",
    trigger: "I don't want to finance anything.",
    response:
      "Absolutely, sir. And just to clarify—we're not getting you into any traditional loans. You're simply switching from one electric provider (that charges more) to another that charges less. Your payment just becomes more stable and more affordable. That's it.",
  },
  {
    key: "late.wait_for_prices_to_drop",
    category: "late",
    trigger: "I want to wait until prices drop.",
    response:
      "I totally get that instinct, sir. The thing is—with inflation, nothing is actually getting cheaper. Even as tech improves, prices usually go up, not down. So waiting won't mean a better deal—it often means you miss the window to lock in lower rates now.",
  },
  {
    key: "late.bad_credit",
    category: "late",
    trigger: "My credit isn't good.",
    response:
      "Thanks for being honest, sir. We actually have a few options here. Is there anyone else on the home who has a credit score above 650? " +
      "— If yes: \"Perfect, we can likely use their credit to get you qualified.\" " +
      "— If no: \"Is there anyone close to you who would be willing to co-sign or be included to help you qualify?\" " +
      "— If unsure: \"Do you know your approximate credit score? I can check with my manager if it's something we can still work with.\"",
  },
  // Part 2 — Ownership / moving
  {
    key: "late.renter_not_homeowner",
    category: "late",
    trigger: "I rent / I'm not the homeowner.",
    response:
      "Got it—thank you for letting me know. Unfortunately, this program is only available to homeowners. If you have a landlord or know who owns the property, I'd be happy to speak with them to see if they'd be interested. They could benefit from solar while the tenant still pays the bill, which means they get the tax credit and increase the property value.",
    isDqCandidate: true, // real DQ — not homeowner
  },
  {
    key: "late.has_tenant",
    category: "late",
    trigger: "I have a tenant living there.",
    response:
      "That's totally fine, sir. We've helped many landlords install solar on rental properties. The best part is: your tenant continues to pay for power, but you get the financial benefit—like the tax credit and added property value. We'd just need to make sure it's set up correctly with ownership.",
  },
  {
    key: "late.planning_to_move",
    category: "late",
    trigger: "I'm planning to move.",
    response:
      "Thanks for sharing that, sir. Just so I'm clear—when exactly are you planning to move? " +
      "— If less than 6 months: \"Understood. In that case, it might make sense to wait until you're in your new home.\" " +
      "— If more than 6 months: \"Great. That still gives you time to benefit from the savings. And when you sell the home, the new owner will also benefit—making your property even more appealing. By the way—have you listed the home yet?\" " +
      "— If not listed: \"Then it sounds like the move is still in the planning phase. This could be a way to reduce costs while you're still there.\"",
    isDqCandidate: true, // <6 months is a real DQ
  },
  // Part 3 — Timing / renovations / trust
  {
    key: "late.home_renovations",
    category: "late",
    trigger: "I'm planning to do home renovations (kitchen, roof, etc.).",
    response:
      "Sir, I'm actually glad I caught you right now—because we might be able to get that kitchen you're planning to renovate completely for free. The government is currently incentivizing solar projects, and they allow home renovation work to be bundled into the solar financing. What that means is—we can add that renovation into the solar project and potentially get you covered for 30% of it through the federal tax credit. In some cases, we can even take a portion of our commission to help cover the cost upfront. So this might be the perfect timing.",
  },
  {
    key: "late.bad_experience_reference",
    category: "late",
    trigger: "My cousin/friend had a bad experience with solar.",
    response:
      "Totally understand, sir. I honestly don't know what happened with other companies—but I can tell you we're not here scamming people. We're just booking appointments with homeowners in your area to see if solar would help them save. That's it. " +
      "If they insist: \"What was your cousin's name and what exactly happened?\" (Let them speak.) \"I'd love to make things right, even if it was a different company. How about this—we send the engineer out, and your cousin can be there too. We'll walk through everything and see if we can avoid the same issues or maybe even fix what happened before.\"",
  },
  // Part 4 — Delay / info deflection
  {
    key: "late.can_you_just_email_me",
    category: "late",
    trigger: "Can you just send me an email?",
    response:
      "Yes, absolutely—what's your email, sir? (Write it down) Perfect. So in order to send you the right information, I do need to ask you a couple of quick questions first—just to make sure your home actually qualifies. Then we can pass that along to the engineer so they can build a personalized report. Now, normally, the engineer does need to swing by to check your meter and some basic info about the home. If everything checks out, they can show you the report right there and then—and if you still want it by email, we can definitely send it after that.",
  },
];

export const ALL_OBJECTIONS: Objection[] = [...EARLY_OBJECTIONS, ...LATE_OBJECTIONS];

export function getObjection(key: string): Objection | undefined {
  return ALL_OBJECTIONS.find((o) => o.key === key);
}

// Cheap keyword retrieval so we don't stuff all 24 objections into every prompt.
// Returns the top `limit` candidates by trigger/keyword overlap with the homeowner's utterance.
export function retrieveObjections(utterance: string, limit = 4): Objection[] {
  const text = utterance.toLowerCase();
  const scored = ALL_OBJECTIONS.map((o) => {
    const words = o.trigger.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
    let score = 0;
    for (const w of words) {
      if (w.length > 3 && text.includes(w)) score += 1;
    }
    return { o, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const withHits = scored.filter((s) => s.score > 0);
  const pool = withHits.length > 0 ? withHits : scored; // fall back to a general set if no keyword hits
  return pool.slice(0, limit).map((s) => s.o);
}
