"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { STAGE_LABELS, STAGE_ORDER, Stage } from "@/lib/script";

export default function SessionsList() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((json) => setSessions(json.sessions || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Past Calls</h1>
      {loading && <div className="text-neutral-500">Loading…</div>}
      {!loading && sessions.length === 0 && <div className="text-neutral-500">No calls yet.</div>}
      <div className="divide-y divide-neutral-800 border border-neutral-800 rounded-lg">
        {sessions.map((s) => (
          <Link
            key={s.id}
            href={`/sessions/${s.id}`}
            className="flex items-center justify-between px-4 py-3 hover:bg-neutral-900 gap-4"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm">{s.contact_name}</div>
              <div className="text-neutral-500 text-xs">{new Date(s.started_at).toLocaleString()}</div>
              {s.status === "in_progress" && <StageProgress stage={s.current_stage} />}
            </div>
            <span
              className={`shrink-0 text-xs px-2 py-1 rounded ${
                s.status === "booked"
                  ? "bg-emerald-800 text-emerald-200"
                  : s.status === "disqualified"
                  ? "bg-red-900 text-red-200"
                  : "bg-neutral-800 text-neutral-300"
              }`}
            >
              {s.status === "in_progress" ? STAGE_LABELS[s.current_stage as Stage] || s.status : s.status}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// Where a live call currently sits in the eight-stage script, as a fraction bar under the
// contact name — lets you tell "just started" from "about to book" without opening the call.
function StageProgress({ stage }: { stage: Stage }) {
  const idx = Math.max(0, STAGE_ORDER.indexOf(stage));
  const pct = ((idx + 1) / STAGE_ORDER.length) * 100;

  return (
    <div className="mt-1.5 flex items-center gap-2 max-w-[220px]">
      <div className="h-1 flex-1 rounded-full bg-neutral-800 overflow-hidden">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-neutral-500 shrink-0">
        {idx + 1}/{STAGE_ORDER.length}
      </span>
    </div>
  );
}
