"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  address: string;
}

export default function Dashboard() {
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const router = useRouter();

  async function shuffle() {
    setLoading(true);
    const res = await fetch("/api/contacts/random");
    const json = await res.json();
    setContact(json.contact || null);
    setLoading(false);
  }

  useEffect(() => {
    shuffle();
  }, []);

  async function startCall() {
    if (!contact) return;
    setStarting(true);
    const res = await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: contact.id }),
    });
    const json = await res.json();
    setStarting(false);
    if (json.session) router.push(`/call/${json.session.id}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Start a call</h1>
        <p className="text-neutral-400 text-sm mt-1">
          A random synthetic contact is loaded below. The AI plays the appointment setter — you play the
          homeowner.
        </p>
      </div>

      {contact ? (
        <div className="rounded-lg border border-neutral-800 p-5 space-y-1">
          <div className="text-lg font-medium">{contact.full_name}</div>
          <div className="text-neutral-400 text-sm">{contact.phone}</div>
          <div className="text-neutral-400 text-sm">{contact.address}</div>
        </div>
      ) : (
        <div className="text-neutral-500">{loading ? "Loading contact…" : "No contact loaded."}</div>
      )}

      <div className="flex gap-3">
        <button
          onClick={shuffle}
          disabled={loading}
          className="px-4 py-2 rounded-md border border-neutral-700 hover:bg-neutral-900 text-sm"
        >
          Shuffle contact
        </button>
        <button
          onClick={startCall}
          disabled={!contact || starting}
          className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
        >
          {starting ? "Starting…" : "Start Call"}
        </button>
      </div>
    </div>
  );
}
