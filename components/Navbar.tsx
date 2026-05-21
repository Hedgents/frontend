"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { API_BASE } from "@/lib/api";

interface NavItem {
  href: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/devlog", label: "Devlog" },
];

/**
 * rc21 audit L1: pre-rc21 this footer hardcoded "localhost:7700" no
 * matter which API the dashboard was actually talking to — misleading
 * on the public reference deployment and a real footgun for
 * self-hosters who'd see "localhost" on a "self-hosted" install. Now
 * we display the API host the bundle was built against.
 */
function apiHostLabel(): string {
  try {
    const u = new URL(API_BASE);
    return u.host;
  } catch {
    return API_BASE;
  }
}

export function Navbar() {
  const pathname = usePathname();
  const apiHost = apiHostLabel();
  return (
    <header className="border-b border-white/5 mb-6">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-baseline justify-between">
        <div className="flex items-baseline gap-8">
          <Link
            href="/"
            className="text-2xl font-semibold hover:opacity-80 transition-opacity"
          >
            Hedgents
          </Link>
          <nav className="flex items-baseline gap-5">
            {ITEMS.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-sm transition-colors ${
                    active
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "opacity-60 hover:opacity-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="text-xs opacity-60 tabular-nums">
          API · <span className="font-medium">{apiHost}</span>
        </div>
      </div>
    </header>
  );
}
