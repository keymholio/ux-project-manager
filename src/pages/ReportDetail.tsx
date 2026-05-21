import { Construction } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";
import { Breadcrumbs, EmptyState } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { findReport } from "../lib/reports";
import CategoryMix from "./reports/CategoryMix";
import CycleTime from "./reports/CycleTime";
import HandoffPipeline from "./reports/HandoffPipeline";
import OneOnOne from "./reports/OneOnOne";
import QuarterlyRecap from "./reports/QuarterlyRecap";
import WeeklyDigest from "./reports/WeeklyDigest";

// Per-report detail page. For now every report renders the same
// "Coming soon" placeholder — the structure (route, header, breadcrumbs,
// content slot) is in place so each report can be built out one at a
// time without further routing or navigation changes.
//
// When a real report ships, replace the placeholder branch with the
// report's own component. If a report grows complex enough, split it
// into its own file (e.g. src/pages/reports/WeeklyDigest.tsx) and
// dispatch on slug here.
export default function ReportDetail() {
  const { isManager, loading } = useAuth();
  const { slug } = useParams<{ slug: string }>();
  const report = findReport(slug);

  if (loading) {
    return (
      <div className="p-4 sm:p-6 text-sm text-ink-500">Loading…</div>
    );
  }

  if (!isManager) {
    return <Navigate to="/" replace />;
  }

  // Unknown slug — bounce back to the hub rather than show a half-broken
  // page. Could also render a 404-style EmptyState if we'd rather keep
  // the user oriented; redirect feels less jarring for a typo'd URL.
  if (!report) {
    return <Navigate to="/reports" replace />;
  }

  // Dispatch on slug — each "ready" report has its own component. The
  // default branch renders the "coming soon" stub so half-built reports
  // can still ship in the hub.
  switch (report.slug) {
    case "weekly-digest":
      return <WeeklyDigest report={report} />;
    case "cycle-time":
      return <CycleTime report={report} />;
    case "category-mix":
      return <CategoryMix report={report} />;
    case "one-on-one":
      return <OneOnOne report={report} />;
    case "handoff-pipeline":
      return <HandoffPipeline report={report} />;
    case "quarterly-recap":
      return <QuarterlyRecap report={report} />;
    default:
      return <ComingSoon report={report} />;
  }
}

function ComingSoon({ report }: { report: ReturnType<typeof findReport> & {} }) {
  const Icon = report.icon;
  return (
    <div className="p-4 sm:p-6 pb-20 space-y-6">
      <Breadcrumbs
        items={[
          { label: "Reports", to: "/reports" },
          { label: report.title, current: true },
        ]}
      />

      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-100">
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink-900">{report.title}</h1>
          <p className="text-sm text-ink-500">{report.description}</p>
        </div>
      </header>

      <EmptyState
        title="This report isn't built yet"
        hint="The structure is in place — when we wire up the data this view will fill in. For now, the Dashboard, Projects, and Tasks pages cover the live equivalents."
        action={
          <div className="flex items-center gap-2 text-xs text-ink-500">
            <Construction size={14} />
            Coming soon
          </div>
        }
      />
    </div>
  );
}
