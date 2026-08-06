import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solar Setter Sim",
  description: "Appointment-setter call simulator",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-neutral-800 px-6 py-3 flex items-center gap-6">
          <span className="font-semibold">☀️ Solar Setter Sim</span>
          <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-100">
            Dashboard
          </Link>
          <Link href="/sessions" className="text-sm text-neutral-400 hover:text-neutral-100">
            Past Calls
          </Link>
        </header>
        <main className="max-w-3xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
