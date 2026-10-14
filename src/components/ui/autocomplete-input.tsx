"use client";

import { forwardRef, useEffect, useRef, useState } from "react";

export interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Resolves suggestion strings for the current query. Called debounced. */
  getSuggestions: (query: string) => Promise<string[]>;
  /** Fired when the user presses Enter with no suggestion highlighted. */
  onEnter?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  minChars?: number;
  debounceMs?: number;
  maxSuggestions?: number;
}

/**
 * Reusable autocomplete text input.
 *
 * Shows a dropdown of predictions as the user types. Keyboard navigable
 * (Arrow keys + Enter to pick, Escape to dismiss), dismisses on blur, and
 * exposes listbox ARIA roles. Any applet can adopt it by supplying a
 * `getSuggestions` source — the shopping applet wires in the pilot's own
 * purchase history first, then a built-in grocery catalog.
 */
export const AutocompleteInput = forwardRef<HTMLInputElement, AutocompleteInputProps>(
  function AutocompleteInput(
    {
      value,
      onChange,
      getSuggestions,
      onEnter,
      placeholder,
      ariaLabel,
      disabled,
      className,
      minChars = 1,
      debounceMs = 150,
      maxSuggestions = 8,
    },
    ref,
  ) {
    const [open, setOpen] = useState(false);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [highlight, setHighlight] = useState(-1);
    const [loading, setLoading] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const requestId = useRef(0);
    const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestGetSuggestions = useRef(getSuggestions);
    latestGetSuggestions.current = getSuggestions;

    useEffect(() => {
      if (value.trim().length < minChars) {
        setSuggestions([]);
        setOpen(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      const timer = setTimeout(async () => {
        const id = ++requestId.current;
        try {
          const list = await latestGetSuggestions.current(value);
          if (id !== requestId.current) return; // stale response
          setSuggestions(list.slice(0, maxSuggestions));
          setHighlight(-1);
          setOpen(list.length > 0);
        } catch {
          if (id !== requestId.current) return;
          setSuggestions([]);
          setOpen(false);
        } finally {
          if (id === requestId.current) setLoading(false);
        }
      }, debounceMs);
      return () => clearTimeout(timer);
    }, [value, minChars, debounceMs, maxSuggestions]);

    function pick(choice: string) {
      onChange(choice);
      setOpen(false);
      setSuggestions([]);
      setHighlight(-1);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        setHighlight((h) => {
          const n = suggestions.length;
          if (n === 0) return -1;
          if (e.key === "ArrowDown") return h + 1 >= n ? 0 : h + 1;
          return h - 1 < 0 ? n - 1 : h - 1;
        });
        return;
      }
      if (e.key === "Enter") {
        if (open && highlight >= 0 && highlight < suggestions.length) {
          e.preventDefault();
          pick(suggestions[highlight]);
        } else {
          onEnter?.();
        }
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        setHighlight(-1);
      }
    }

    const listId = `autocomplete-${ariaLabel?.replace(/[^a-z0-9]+/gi, "-").toLowerCase() ?? "input"}`;

    return (
      <div ref={wrapRef} className="relative min-w-0 flex-1">
        <input
          ref={ref}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            if (suggestions.length > 0) setOpen(true);
          }}
          onBlur={() => {
            // Delay so a tap on a suggestion lands before the list closes.
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={disabled}
          autoComplete="off"
          className={className}
        />
        {open && suggestions.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Suggestions"
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-line bg-panel-2 p-1 shadow-xl shadow-black/40"
          >
            {suggestions.map((s, i) => (
              <li key={`${s}-${i}`} role="option" id={`${listId}-${i}`} aria-selected={i === highlight}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => {
                    // Fire before the input's blur closes the list.
                    e.preventDefault();
                    pick(s);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    i === highlight
                      ? "bg-neon-cyan/15 text-star"
                      : "text-stardust hover:bg-panel-2/60 hover:text-star"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{s}</span>
                  {loading && i === 0 && (
                    <span className="shrink-0 text-xs text-dim">…</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);
