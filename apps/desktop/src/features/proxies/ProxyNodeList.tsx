import { CircleCheck, Gauge, Radio, Star } from "lucide-react";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ProxyNode } from "../../platform/runtime";
import type { NodeLayout } from "../../shared/proxyView";

/**
 * One group's node list, in list or card form.
 *
 * Keyboard handling lives here rather than in the page: the list is a single
 * roving-tabindex widget, so arrow keys move between nodes, Enter selects and
 * `T` probes the focused node. Splitting it out keeps the page from growing a
 * fourth copy of that logic for the card layout.
 */

export type { NodeLayout };

export function ProxyNodeList({
  groupName,
  nodes,
  selectedName,
  favorites,
  delays,
  pendingSelection,
  pendingDelay,
  pendingGroupTest,
  layout,
  onSelect,
  onTest,
  onToggleFavorite,
}: {
  groupName: string;
  nodes: ProxyNode[];
  selectedName: string;
  favorites: ReadonlySet<string>;
  delays: Record<string, number | null>;
  pendingSelection: string | null;
  pendingDelay: string | null;
  pendingGroupTest: boolean;
  layout: NodeLayout;
  onSelect: (node: ProxyNode) => void;
  onTest: (node: ProxyNode) => void;
  onToggleFavorite: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  // Clamped at the read site: a filter or sort that shrinks the list must not
  // leave the roving tabindex past the last row, and an effect would fire a
  // second render for information already known here.
  const boundedIndex = Math.min(focusedIndex, Math.max(nodes.length - 1, 0));

  const focusItem = useCallback((index: number) => {
    setFocusedIndex(index);
    itemRefs.current[index]?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, index: number, node: ProxyNode) => {
      const columns = layout === "cards" ? 3 : 1;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusItem(Math.min(index + columns, nodes.length - 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          focusItem(Math.max(index - columns, 0));
          break;
        case "ArrowRight":
          if (layout === "cards") {
            event.preventDefault();
            focusItem(Math.min(index + 1, nodes.length - 1));
          }
          break;
        case "ArrowLeft":
          if (layout === "cards") {
            event.preventDefault();
            focusItem(Math.max(index - 1, 0));
          }
          break;
        case "Home":
          event.preventDefault();
          focusItem(0);
          break;
        case "End":
          event.preventDefault();
          focusItem(nodes.length - 1);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          onSelect(node);
          break;
        case "t":
        case "T":
          event.preventDefault();
          onTest(node);
          break;
        case "f":
        case "F":
          event.preventDefault();
          onToggleFavorite(node.name);
          break;
        default:
          break;
      }
    },
    [focusItem, layout, nodes.length, onSelect, onTest, onToggleFavorite],
  );

  if (nodes.length === 0) {
    return null;
  }

  return (
    <div
      className={layout === "cards" ? "proxy-node-cards" : "proxy-node-list"}
      role="listbox"
      aria-label={groupName}
      aria-orientation={layout === "cards" ? "horizontal" : "vertical"}
    >
      {nodes.map((node, index) => {
        const selected = node.name === selectedName;
        const delay = delays[node.name] ?? node.delay_ms;
        const favorite = favorites.has(node.name);
        const tabIndex = index === boundedIndex ? 0 : -1;

        const common = {
          ref: (element: HTMLElement | null) => {
            itemRefs.current[index] = element;
          },
          role: "option" as const,
          "aria-selected": selected,
          tabIndex,
          "data-quality":
            delay === null
              ? "unknown"
              : delay < 100
                ? "good"
                : delay < 200
                  ? "medium"
                  : "poor",
          onFocus: () => setFocusedIndex(index),
          onKeyDown: (event: KeyboardEvent<HTMLElement>) =>
            onKeyDown(event, index, node),
        };

        const nameMarkup = (
          <>
            {favorite ? (
              <Star
                className="proxy-node-favorite-mark"
                aria-hidden="true"
                size={12}
              />
            ) : null}
            {node.name}
          </>
        );

        const delayMarkup = (
          <span
            className="proxy-delay"
            data-quality={
              delay === null
                ? "unknown"
                : delay < 100
                  ? "good"
                  : delay < 200
                    ? "medium"
                    : "poor"
            }
          >
            {delay === null ? t("proxies.notTested") : `${delay} ms`}
          </span>
        );

        const actions = (
          <>
            <button
              className={
                favorite
                  ? "workspace-icon-button proxy-favorite is-favorite"
                  : "workspace-icon-button proxy-favorite"
              }
              type="button"
              tabIndex={-1}
              aria-pressed={favorite}
              aria-label={
                favorite
                  ? t("proxies.unfavorite", { name: node.name })
                  : t("proxies.favorite", { name: node.name })
              }
              title={
                favorite
                  ? t("proxies.unfavorite", { name: node.name })
                  : t("proxies.favorite", { name: node.name })
              }
              onClick={() => onToggleFavorite(node.name)}
            >
              <Star aria-hidden="true" size={15} fill={favorite ? "currentColor" : "none"} />
            </button>
            <button
              className="workspace-icon-button"
              type="button"
              tabIndex={-1}
              aria-label={t("proxies.testDelay", { name: node.name })}
              title={t("proxies.testDelay", { name: node.name })}
              disabled={pendingDelay !== null || pendingGroupTest}
              onClick={() => onTest(node)}
            >
              <Gauge aria-hidden="true" size={15} />
            </button>
          </>
        );

        if (layout === "cards") {
          return (
            <div
              {...common}
              key={node.name}
              className={`proxy-card-node${selected ? " is-selected" : ""}`}
            >
              <span className="proxy-card-node-head">
                <span className="proxy-node-details">
                  <strong>{nameMarkup}</strong>
                  <small>
                    {node.proxy_type} / UDP {node.udp ? "on" : "off"}
                  </small>
                </span>
                {delayMarkup}
              </span>
              <span className="proxy-card-node-actions">
                <button
                  className="workspace-action-button"
                  type="button"
                  tabIndex={-1}
                  aria-label={t("proxies.selectNode", { name: node.name })}
                  disabled={pendingSelection !== null || selected}
                  onClick={() => onSelect(node)}
                >
                  {selected
                    ? t("proxies.selected")
                    : pendingSelection === node.name
                      ? t("proxies.selecting")
                      : t("proxies.select")}
                </button>
                {actions}
              </span>
            </div>
          );
        }

        return (
          <div
            {...common}
            key={node.name}
            className={`proxy-node${selected ? " is-selected" : ""}`}
          >
            <span className="proxy-node-state" aria-hidden="true">
              {selected ? <CircleCheck size={16} /> : <Radio size={15} />}
            </span>
            <span className="proxy-node-details">
              <strong>{nameMarkup}</strong>
              <small>
                {node.proxy_type} / UDP {node.udp ? "on" : "off"}
              </small>
            </span>
            {delayMarkup}
            {actions}
            <button
              className="workspace-action-button"
              type="button"
              tabIndex={-1}
              aria-label={t("proxies.selectNode", { name: node.name })}
              disabled={pendingSelection !== null || selected}
              onClick={() => onSelect(node)}
            >
              {selected
                ? t("proxies.selected")
                : pendingSelection === node.name
                  ? t("proxies.selecting")
                  : t("proxies.select")}
            </button>
          </div>
        );
      })}
    </div>
  );
}

