// Custom accessible popover select: replaces ugly OS-native <select> popups on Windows while
// fitting AgentHerd's tokens, light/dark themes, keyboard navigation and optional live filtering.

import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  filterSelectSections,
  flattenSelectOptions,
  type MenuPlacement,
  placeSelectMenu,
  type SelectSection,
  stepSelectIndex,
} from "./select-state";
import { Badge } from "./ui";

export type { SelectOption, SelectSection } from "./select-state";

export function Select({
  value,
  sections,
  onChange,
  label,
  placeholder,
  disabled = false,
  busy = false,
  className = "w-full",
  minMenuWidth,
  maxMenuWidth,
  align = "start",
  searchableThreshold = 6,
  searchPlaceholder = "搜索…",
}: {
  value: string;
  sections: readonly SelectSection[];
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  minMenuWidth?: number;
  maxMenuWidth?: number;
  align?: "start" | "end";
  searchableThreshold?: number;
  searchPlaceholder?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollByKeyRef = useRef(false);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<MenuPlacement>();

  const allOptions = useMemo(() => flattenSelectOptions(sections), [sections]);
  const selected = useMemo(() => allOptions.find((o) => o.value === value), [allOptions, value]);
  const searchable = allOptions.length >= searchableThreshold;
  const shownSections = useMemo(
    () => (searchable ? filterSelectSections(sections, query) : sections),
    [searchable, sections, query],
  );
  const visibleOptions = useMemo(() => flattenSelectOptions(shownSections), [shownSections]);

  const updatePlacement = useCallback(() => {
    const el = triggerRef.current;
    if (el === null) return;
    setPlacement(
      placeSelectMenu(
        el.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        { align, minWidth: minMenuWidth, maxWidth: maxMenuWidth },
      ),
    );
  }, [align, minMenuWidth, maxMenuWidth]);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    setQuery("");
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    const selectedIdx = allOptions.findIndex((o) => o.value === value);
    setQuery("");
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : allOptions.length > 0 ? 0 : -1);
    setOpen(true);
  }, [disabled, allOptions, value]);

  const commit = useCallback(
    (nextValue: string) => {
      close(true);
      if (nextValue !== value) onChange(nextValue);
    },
    [close, onChange, value],
  );

  // Measure position before painting, and keep tracking viewport resize / ancestor scroll.
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(undefined);
      return;
    }
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open, updatePlacement]);

  // Focus the search field when opened with search enabled, and bring selected option into view.
  useEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
    const id = requestAnimationFrame(() => {
      const target =
        listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ??
        listRef.current?.querySelector<HTMLElement>('[data-select-index="0"]');
      target?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(id);
  }, [open, searchable]);

  // Keep keyboard-focused rows scrolled into view without jumping under pointer hover.
  useEffect(() => {
    if (!open || activeIndex < 0 || !scrollByKeyRef.current) return;
    scrollByKeyRef.current = false;
    const target = listRef.current?.querySelector<HTMLElement>(
      `[data-select-index="${activeIndex}"]`,
    );
    target?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  // Outside click and capture-phase Escape (so parent modals stay open when dismissing the dropdown).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t !== null && (triggerRef.current?.contains(t) || menuRef.current?.contains(t))) return;
      close(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close]);

  const handleMenuKeyDown = (e: ReactKeyboardEvent<HTMLElement>, allowSpaceSelect: boolean) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      scrollByKeyRef.current = true;
      setActiveIndex((i) => stepSelectIndex(visibleOptions.length, i, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      scrollByKeyRef.current = true;
      setActiveIndex((i) => stepSelectIndex(visibleOptions.length, i, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      if (visibleOptions.length > 0) {
        scrollByKeyRef.current = true;
        setActiveIndex(0);
      }
    } else if (e.key === "End") {
      e.preventDefault();
      if (visibleOptions.length > 0) {
        scrollByKeyRef.current = true;
        setActiveIndex(visibleOptions.length - 1);
      }
    } else if (e.key === "Enter" || (allowSpaceSelect && e.key === " ")) {
      e.preventDefault();
      const picked = visibleOptions[activeIndex];
      if (picked !== undefined) commit(picked.value);
    }
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    handleMenuKeyDown(e, true);
  };

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    handleMenuKeyDown(e, false);
  };

  const triggerTitle =
    selected === undefined
      ? undefined
      : selected.tag !== undefined
        ? `${selected.tag} / ${selected.label}`
        : selected.label;

  let runningIndex = 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        title={triggerTitle}
        disabled={disabled}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={`flex h-(--ah-control-md) items-center gap-2 rounded-md border px-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-55 ${
          open
            ? "border-accent bg-control-hover shadow-[0_0_0_3px_var(--ah-accent-soft)]"
            : "border-line-strong bg-control hover:border-line-focus/70 hover:bg-control-hover"
        } ${className}`}
      >
        {selected !== undefined && !selected.muted ? (
          <>
            {selected.tag !== undefined && (
              <span className="max-w-28 shrink-0 truncate rounded-xs bg-canvas px-1.5 py-0.5 font-normal text-ink-muted text-xs ring-1 ring-line">
                {selected.tag}
              </span>
            )}
            <span
              className={`min-w-0 flex-1 truncate font-medium text-ink ${
                selected.mono ? "font-mono text-sm" : "text-md"
              }`}
            >
              {selected.label}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-ink-muted text-md">
            {placeholder ?? selected?.label ?? ""}
          </span>
        )}
        {busy ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-ink-muted" />
        ) : (
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            className={`shrink-0 text-ink-muted transition-transform duration-150 ${
              open ? "rotate-180 text-ink" : ""
            }`}
          />
        )}
      </button>

      {open &&
        placement !== undefined &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              left: placement.left,
              width: placement.width,
              maxHeight: placement.maxHeight,
              ...(placement.top !== undefined ? { top: placement.top } : {}),
              ...(placement.bottom !== undefined ? { bottom: placement.bottom } : {}),
            }}
            className={`app-no-drag fixed z-50 flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface-raised shadow-(--ah-shadow-popover) ${
              placement.side === "bottom" ? "ah-popover-down" : "ah-popover-up"
            }`}
          >
            {searchable && (
              <div className="flex shrink-0 items-center gap-2 border-line border-b px-2.5 py-2">
                <Search size={13} className="shrink-0 text-ink-dim" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  spellCheck={false}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={onSearchKeyDown}
                  className="min-w-0 flex-1 bg-transparent text-ink text-sm placeholder:text-ink-placeholder focus:outline-none"
                />
                {query !== "" && (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => {
                      setQuery("");
                      setActiveIndex(0);
                      searchRef.current?.focus();
                    }}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-xs text-ink-muted hover:bg-control-hover hover:text-ink"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )}

            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={label}
              className="overflow-y-auto overscroll-contain p-1.5"
            >
              {shownSections.length === 0 ? (
                <div className="px-3 py-5 text-center text-ink-muted text-sm">没有匹配的选项</div>
              ) : (
                shownSections.map((section, sectionIdx) => (
                  <div key={section.id}>
                    {sectionIdx > 0 && <div className="my-1 border-line border-t" />}
                    {section.label !== undefined && (
                      <div className="flex items-center gap-2 px-2 pt-1.5 pb-1">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-xs bg-control-hover font-semibold text-[10px] text-ink-2">
                          {section.label.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium text-ink-muted text-xs">
                          {section.label}
                        </span>
                        {section.badge !== undefined && (
                          <Badge tone={section.badgeTone ?? "gray"}>{section.badge}</Badge>
                        )}
                      </div>
                    )}
                    <div className="flex flex-col gap-0.5">
                      {section.options.map((opt) => {
                        const flatIndex = runningIndex++;
                        const isSelected = opt.value === value;
                        const isActive = flatIndex === activeIndex;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            data-select-index={flatIndex}
                            onMouseEnter={() => setActiveIndex(flatIndex)}
                            onClick={() => commit(opt.value)}
                            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                              isSelected
                                ? isActive
                                  ? "bg-accent-soft text-ink"
                                  : "bg-accent-soft/75 text-ink"
                                : isActive
                                  ? "bg-control-hover text-ink"
                                  : opt.muted
                                    ? "text-ink-muted hover:bg-control-hover hover:text-ink"
                                    : "text-ink"
                            }`}
                          >
                            <span
                              className={`min-w-0 flex-1 truncate ${
                                opt.mono ? "font-mono text-sm" : "text-md"
                              } ${isSelected ? "font-medium" : ""}`}
                            >
                              {opt.label}
                            </span>
                            {opt.badge !== undefined && (
                              <Badge tone={opt.badgeTone ?? "gray"}>{opt.badge}</Badge>
                            )}
                            {isSelected && (
                              <Check
                                size={14}
                                strokeWidth={2.25}
                                className="shrink-0 text-accent-text"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
