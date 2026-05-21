import { ArrowRight } from "lucide-react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { REPORTS, type ReportDef } from "../lib/reports";

// Reports landing page — a grid of cards, one per report. Clicking a
// card opens the per-report detail view at /reports/:slug.
//
// Scoping: manager-only for now, matching the Users page pattern. Most
// of these reports are team-wide rollups that wouldn't be meaningful
// (and in some cases not appropriate) for a designer to see about their
// peers. The route guard here mirrors UserAdmin.tsx — RLS would still
// be the real security boundary if any of these queries become
// privileged later.
export default function Reports() {
  const { isManager, loading } = useAuth();

  if (loading) {
    return (
      <div className="p-4 sm:p-6 text-sm text-ink-500">Loading…</div>
    );
  }

  if (!isManager) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="p-4 sm:p-6 pb-20 space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">Reports</h1>
        <p className="text-sm text-ink-500">
          Time-based summaries and rollups that complement the live Dashboard.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <ReportCard key={r.slug} report={r} />
        ))}
      </div>
    </div>
  );
}

// One card per report. Whole card is clickable (wrapped in Link) so the
// hit target matches the visual extent rather than just the title.
//
// The status chip only renders for "coming_soon" reports — once a
// report ships, the card is just the card. (A "Ready" chip on a card
// that opens immediately into a working report was noise.)
function ReportCard({ report }: { report: ReportDef }) {
  const Icon = report.icon;
  const isReady = report.status === "ready";
  return (
    <Link
      to={`/reports/${report.slug}`}
      className="card group flex flex-col gap-3 p-5 transition hover:border-brand-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-100">
          <Icon size={18} />
        </div>
        {!isReady && (
          <span className="chip bg-ink-100 text-ink-600">Coming soon</span>
        )}
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-ink-900">{report.title}</h2>
        <p className="text-sm text-ink-500">{report.summary}</p>
      </div>
      <div className="mt-auto flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-100">
        Open
        <ArrowRight
          size={14}
          className="transition group-hover:translate-x-0.5"
        />
      </div>
    </Link>
  );
}
