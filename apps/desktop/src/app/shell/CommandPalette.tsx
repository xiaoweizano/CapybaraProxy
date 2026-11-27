import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { navigationItems } from "../navigation";

/**
 * Keyboard command palette (Ctrl/Cmd+K).
 *
 * Covers the two actions an operator reaches for constantly — open a page and
 * select a node — without leaving the keyboard. Commands are derived from the
 * navigation table and the live proxy groups, so a new page or group appears
 * here without a second list to maintain.
 */

type Command = {
  id: string;
  /** Section shown next to the command in the list. */
  group: string;
  label: string;
  /** Extra text matched by the filter but not displayed. */
  keywords?: string;
  run: () => void;
};

export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const runtime = useRuntime();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const pages = navigationItems.map((item) => ({
      id: `nav-${item.key}`,
      group: t("palette.pages"),
      label: t(`nav.${item.key}`),
      keywords: item.path,
      run: () => navigate(item.path),
    }));

    const groups = runtime.proxyGroups;
    const nodes: Command[] = [];
    for (const group of groups) {
      for (const node of group.nodes) {
        if (node.name === group.selected) {
          continue;
        }
        nodes.push({
          id: `node-${group.name}-${node.name}`,
          group: t("palette.nodes"),
          label: node.name,
          keywords: group.name,
          run: () => {
            void runtime.selectProxy(group.name, node.name);
            navigate("/proxies");
          },
        });
      }
    }

    const modeCommands: Command[] = (
      ["rule", "global", "direct"] as const
    ).map((mode) => ({
      id: `mode-${mode}`,
      group: t("palette.modes"),
      label: t(
        mode === "rule"
          ? "proxies.modeRule"
          : mode === "global"
            ? "proxies.modeGlobal"
            : "proxies.modeDirect",
      ),
      run: () => void runtime.setRoutingMode(mode),
    }));

    return [...pages, ...modeCommands, ...nodes];
  }, [navigate, runtime, t]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized === "") {
      return commands;
    }
    return commands.filter((command) =>
      `${command.label} ${command.keywords ?? ""}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [commands, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        setQuery("");
        setActiveIndex(0);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      // The input mounts with the dialog, so focus has to wait for that paint.
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open]);

  if (!open) {
    return null;
  }

  // Clamped at the read site rather than in an effect: a shrinking list must
  // never leave the highlight past the last row, and the effect form fires a
  // second render for the same information.
  const selectedIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0));

  const runCommand = (command: Command) => {
    command.run();
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="command-palette-backdrop" role="presentation">
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.label")}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) =>
              Math.min(current + 1, filtered.length - 1),
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const command = filtered[selectedIndex];
            if (command) {
              runCommand(command);
            }
          }
        }}
      >
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          value={query}
          placeholder={t("palette.placeholder")}
          aria-label={t("palette.placeholder")}
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
        />
        <ul className="command-palette-list" role="listbox">
          {filtered.length === 0 ? (
            <li className="command-palette-empty">{t("palette.empty")}</li>
          ) : (
            filtered.slice(0, 40).map((command, index) => (
              <li key={command.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  data-active={index === selectedIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => runCommand(command)}
                >
                  <span>{command.label}</span>
                  <small>{command.group}</small>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
