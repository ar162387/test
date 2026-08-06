# Solar Setter Sim

A browser-based training/eval harness for a solar appointment-setting AI. The AI plays the
appointment setter; the operator plays the homeowner via push-to-talk. The agent follows an
8-stage call script, rebuts objections from a 24-entry objection sheet, refuses out-of-scope
requests, and never treats a soft objection as a reason to end the call.

**Stack:** Next.js (App Router) on Vercel · Supabase (Postgres + Storage) · Amazon Bedrock
(Kimi K2.5, via API-key/bearer-token auth — no IAM) · Gemini (STT + TTS voice legs).

## Setup

```bash
npm install
cp .env.example .env.local   # fill in your own keys
npm run dev
```

## Architecture

- `lib/script.ts` / `lib/objections.ts` — the call script and objection sheet, transcribed
  verbatim, as typed data (not free text in a prompt).
- `lib/prompt.ts` — assembles the per-turn system prompt: current stage only, top-matching
  objections by keyword retrieval, and the hard rules.
- `lib/bedrock.ts` — Kimi K2.5 on Bedrock via a forced tool call (`submit_turn`), so every
  response is structured, not parsed from prose.
- `lib/state.ts` — `guardTurn()` structurally enforces the four hard requirements (follow the
  script, handle objections, never give up on an objection, reject out-of-scope requests) —
  independent of whatever the model says it did.
- `lib/voice/{stt,tts}.ts` — Gemini as the voice legs, kept behind a narrow interface so
  swapping providers later is a one-file change.
- `app/api/turn/route.ts` — the per-turn pipeline: STT → Kimi → schema validation → guard →
  persist → respond.

## Known v1 scope trims

- **Push-to-talk, not full VAD/barge-in.** Hands-free turn-taking with real interruption
  (`@ricky0123/vad-web` or similar) is a natural next step but adds real complexity; push-to-talk
  is far more reliable to ship correctly first.
