import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import Link from "next/link";

const nav = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/coupons", label: "Coupons" },
  { href: "/admin/events", label: "Webhook events" },
  { href: "/admin/audit", label: "Audit log (admin)" },
  { href: "/admin/payouts", label: "Payouts & Reconciliation" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await currentActor())) redirect("/login");
  return (
    <div className="mx-auto flex max-w-6xl flex-col md:flex-row gap-8 px-4 py-10">
      <aside className="w-56 shrink-0">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">
          PayOps
        </p>
        <nav className="flex flex-col gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/"
          className="mt-8 block px-3 text-xs text-zinc-600 hover:text-zinc-400"
        >
          ← Back to store
        </Link>
        <form action="/api/admin/logout" method="post"><button className="mt-4 px-3 text-xs text-zinc-400">Sign out</button></form>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
