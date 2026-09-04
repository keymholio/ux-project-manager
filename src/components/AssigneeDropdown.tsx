import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Profile } from "../lib/types";
import { Avatar } from "./ui";

export function AssigneeDropdown({
  team,
  selectedAssignees,
  onToggle,
  singleSelect = false,
  placeholder = "",
}: {
  team: Profile[];
  selectedAssignees: string[];
  onToggle: (id: string) => void;
  singleSelect?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedProfiles = selectedAssignees
    .map((id) => team.find((p) => p.id === id))
    .filter((p): p is Profile => !!p);

  const buttonLabel =
    selectedProfiles.length === 0
      ? placeholder
      : selectedProfiles.length === 1
        ? selectedProfiles[0].full_name
        : `${selectedProfiles.length} members selected`;

  const handleToggle = (id: string) => {
    onToggle(id);
    if (singleSelect) setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input box-border flex h-10 w-full items-center justify-between gap-2 text-left sm:h-[34px]"
      >
        <span className={selectedProfiles.length === 0 ? "text-ink-400" : "text-ink-900"}>
          {buttonLabel}
        </span>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-ink-200 bg-surface shadow-lg">
          {team.map((p) => {
            const checked = selectedAssignees.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleToggle(p.id);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink-100"
              >
                <input
                  type={singleSelect ? "radio" : "checkbox"}
                  checked={checked}
                  readOnly
                  className="h-4 w-4 flex-shrink-0 rounded accent-brand-600"
                />
                <Avatar profile={p} size={22} />
                <span className="text-sm text-ink-900">{p.full_name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
