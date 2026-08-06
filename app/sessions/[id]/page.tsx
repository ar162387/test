"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const FIELD_LABELS: Record<string, string> = {
  avg_monthly_bill: "Average Monthly Electric Bill",
  home_type: "Home Type",
  electricity_provider: "Electricity Provider",
  appointment_type: "Appointment Type",
  homeowner_confirmed: "Homeowner Confirmed",
  decision_makers: "Decision Makers Present",
  roof_condition_type: "Roof Condition & Type",
  shading_issues: "Shading Issues",
  credit_score_above_650: "Credit Score (above 650?)",
  taxable_income_above_45k: "Taxable Income (above $45K?)",
  already_has_solar: "Customer Already Has Solar?",
  language: "Language Appointment Booked In",
  decision_makers_reminded: "Reminded About Decision Makers Being Present?",
  utility_bill_reminded: "Reminded to Have Utility Bill Ready?",
  confirmation_call_reminded: "Reminded They Will Receive a Confirmation Call?",
  extra_notes: "Extra Notes",
};

export default function SessionReplay() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/session/${id}`)
      .then((r) => r.json())
      .then(setData);
  }, [id]);

  if (!data) return <div className="text-neutral-500">Loading…</div>;
  const { session, contact, turns, recordingUrl } = data;

  const filledFields = Object.keys(FIELD_LABELS).filter(
    (k) => session[k] !== null && session[k] !== undefined
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{contact?.full_name}</h1>
        <div className="text-neutral-500 text-sm">{contact?.address}</div>
        <span
          className={`inline-block mt-2 text-xs px-2 py-1 rounded ${
            session.status === "booked"
              ? "bg-emerald-800 text-emerald-200"
              : session.status === "disqualified"
              ? "bg-red-900 text-red-200"
              : "bg-neutral-800 text-neutral-300"
          }`}
        >
          {session.status}
          {session.dq_reason ? ` — ${session.dq_reason}` : ""}
        </span>
      </div>

      {recordingUrl && (
        <div>
          <div className="text-sm text-neutral-400 mb-1">Recording</div>
          <audio controls src={recordingUrl} className="w-full" />
        </div>
      )}

      {filledFields.length > 0 && (
        <div className="border border-neutral-800 rounded-lg p-4 space-y-1">
          <div className="text-sm font-medium mb-2">Qualifying Notes</div>
          {filledFields.map((k) => (
            <div key={k} className="flex justify-between text-sm">
              <span className="text-neutral-400">{FIELD_LABELS[k]}</span>
              <span>{String(session[k])}</span>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="text-sm font-medium mb-2">Transcript</div>
        <div className="border border-neutral-800 rounded-lg p-4 space-y-3">
          {turns.map((t: any) => (
            <div key={t.id} className={t.role === "agent" ? "text-left" : "text-right"}>
              <div
                className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  t.role === "agent" ? "bg-neutral-800" : "bg-blue-900"
                }`}
              >
                {t.transcript}
              </div>
              <div className="text-[10px] text-neutral-500 mt-0.5">
                {t.stage}
                {t.objection_key ? ` · ${t.objection_key} (attempt ${t.objection_attempt})` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
