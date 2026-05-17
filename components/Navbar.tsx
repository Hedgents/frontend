"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/devlog", label: "Devlog" },
];

export function Navbar() {
  const pathname = usePathname();
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
        <div className="text-xs opacity-60">
          Local operator dashboard · localhost:7700
        </div>
      </div>
    </header>
  );
}
