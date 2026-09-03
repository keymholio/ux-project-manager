import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Label } from "../lib/types";

export function LabelTypeahead({
  labels,
  selectedLabels,
  onToggle,
  onCreateLabel,
}: {
  labels: Label[];
  selectedLabels: string[];
  onToggle: (id: string) => void;
  onCreateLabel: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const options = labels.filter(
    (l) =>
      !selectedLabels.includes(l.id) &&
      (q === "" || l.name.toLowerCase().includes(q)),
  );
  const exactMatch = labels.find((l) => l.name.toLowerCase() === q);
  const showCreate = q.length > 0 && !exactMatch;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const select = (label: Label) => {
    onToggle(label.id);
    setQuery("");
    inputRef.current?.focus();
  };

  const create = () => {
    if (!q) return;
    onCreateLabel(query.trim());
    setQuery("");
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (showCreate) {
        create();
      } else if (options.length > 0) {
        select(options[0]);
      }
    }
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  const selectedChips = selectedLabels
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is Label => !!l);

  return (
    <div ref={containerRef} className="relative">
      {selectedChips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {selectedChips.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onToggle(l.id)}
              className="chip flex items-center gap-1 text-white"
              style={{ background: l.color }}
            >
              {l.name}
              <X size={10} />
            </button>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        className="input"
        placeholder="Search or add a label…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (options.length > 0 || showCreate) && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-ink-200 bg-surface shadow-lg">
          {options.map((l) => (
            <button
              key={l.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                select(l);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-100"
            >
              <span
                className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ background: l.color }}
              />
              {l.name}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                create();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-700 hover:bg-ink-100"
            >
              <Plus size={13} className="flex-shrink-0" />
              Create "{query.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}
