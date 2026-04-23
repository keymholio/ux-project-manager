// Type-ahead project picker. Behaves like a <select> from the caller's
// perspective (controlled by `value` + `onChange`) but narrows the list as
// the user types.
//
// Two shapes we support today:
//   * Filter on TaskBoard: `extraOptions` = [{ id: "all", label: "All projects" },
//     { id: "none", label: "No project" }], value is one of those ids or a
//     real project id.
//   * Picker on TaskDetail: `extraOptions` = [{ id: "", label: "— No project —" }],
//     value is "" (meaning null) or a project id. Caller maps null ↔ "".
//
// If this grows a third caller, consider moving the option flattening into
// a shared helper — for now two callers is fine.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../lib/types";

interface ExtraOption {
  id: string;
  label: string;
}

export function ProjectCombobox({
  value,
  onChange,
  projects,
  extraOptions = [],
  placeholder = "Select project",
  className = "w-64",
}: {
  value: string;
  onChange: (value: string) => void;
  projects: Project[];
  /** Pinned rows (e.g. "All projects", "No project") shown above real projects. */
  extraOptions?: ExtraOption[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => {
    const base: ExtraOption[] = [
      ...extraOptions,
      ...[...projects]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ id: p.id, label: p.name })),
    ];
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((o) => o.label.toLowerCase().includes(q));
  }, [projects, query, extraOptions]);

  const selectedLabel = useMemo(() => {
    const extra = extraOptions.find((o) => o.id === value);
    if (extra) return extra.label;
    const match = projects.find((p) => p.id === value);
    return match ? match.name : placeholder;
  }, [value, projects, extraOptions, placeholder]);

  // Close on outside click. Using mousedown so we beat the blur that would
  // otherwise race with the input's own onBlur handler.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        className="input w-full"
        placeholder={placeholder}
        // While the dropdown is open, show what the user is typing. Closed,
        // show the selected label so the picked value is visible at a glance.
        value={open ? query : selectedLabel === placeholder ? "" : selectedLabel}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          if (!open) setOpen(true);
          setQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) setOpen(true);
            setActiveIndex((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const opt = options[activeIndex];
            if (opt) select(opt.id);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            setQuery("");
            inputRef.current?.blur();
          }
        }}
      />
      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-ink-200 bg-white py-1 shadow-lg"
        >
          {options.length === 0 ? (
            <li className="px-3 py-1.5 text-sm text-ink-500">No matches</li>
          ) : (
            options.map((opt, i) => {
              const isActive = i === activeIndex;
              const isSelected = value === opt.id;
              return (
                <li
                  key={opt.id || `__extra_${i}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(i)}
                  // mousedown instead of click so the input doesn't blur and
                  // close the dropdown before the selection lands.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(opt.id);
                  }}
                  className={`cursor-pointer px-3 py-1.5 text-sm ${
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-ink-900 hover:bg-ink-100"
                  } ${isSelected ? "font-medium" : ""}`}
                >
                  {opt.label}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
