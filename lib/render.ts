import { Contact } from "./prompt";

// Deterministic placeholder fill for the one line we render without going through the LLM:
// the very first line of the call, so "follow the script" is exact from turn zero.
export function renderOpeningLine(contact: Contact, agentName = "Alex"): string {
  return `Hey ${contact.first_name}?`;
}

export function renderSecondOpeningLine(contact: Contact, agentName = "Alex"): string {
  return `Hey, how's it going? This is just ${agentName}. We're actually working right in the corner of your neighborhood — we're going to be here for the next couple of weeks. Am I speaking with the owner of ${contact.address}?`;
}
