"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
            className="flex items-center justify-between px-4 py-3 hover:bg-neutral-900"
          >
            <div>
              <div className="font-medium text-sm">{s.contact_name}</div>
              <div className="text-neutral-500 text-xs">{new Date(s.started_at).toLocaleString()}</div>
            </div>
            <span
              className={`text-xs px-2 py-1 rounded ${
                s.status === "booked"
                  ? "bg-emerald-800 text-emerald-200"
                  : s.status === "disqualified"
                  ? "bg-red-900 text-red-200"
                  : "bg-neutral-800 text-neutral-300"
              }`}
            >
              {s.status}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
