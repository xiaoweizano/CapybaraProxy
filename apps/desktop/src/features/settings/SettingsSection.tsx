import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SettingsSectionDefinition } from "./settingsSections";

/**
 * One full-width settings card.
 *
 * Every group uses the same panel and heading markup as the other pages, so
 * the page reads as a single column of equally weighted cards instead of the
 * old mixed half-width/full-width grid.
 */
export function SettingsSection({
  definition,
  actions,
  children,
}: {
  definition: SettingsSectionDefinition;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const headingId = `settings-${definition.id}-title`;

  return (
    <section
      id={`settings-${definition.id}`}
      className="workspace-panel settings-section"
      aria-labelledby={headingId}
    >
      <div className="workspace-panel-heading">
        <div>
          <span className="workspace-kicker">{t(definition.kickerKey)}</span>
          <h2 id={headingId}>{t(definition.titleKey)}</h2>
        </div>
        <div className="settings-panel-heading-actions">
          {actions}
          <span className="workspace-panel-index">{definition.index}</span>
        </div>
      </div>
      {children}
    </section>
  );
}

/** A sub-heading inside a card, e.g. Language under Theme. */
export function SettingsSubheading({
  kicker,
  title,
  icon,
}: {
  kicker: string;
  title: string;
  icon?: ReactNode;
}) {
  return (
    <div className="workspace-panel-heading settings-panel-heading-inset">
      <div>
        <span className="workspace-kicker">{kicker}</span>
        <h2>{title}</h2>
      </div>
      {icon}
    </div>
  );
}

/** A radio-style choice row inside a card. */
export function SettingsOption({
  pressed,
  disabled,
  onClick,
  title,
  caption,
}: {
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  caption?: string;
}) {
  return (
    <button
      className="workspace-option"
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="workspace-radio" aria-hidden="true">
        {pressed ? <span /> : null}
      </span>
      <span>
        <strong>{title}</strong>
        {caption ? <small>{caption}</small> : null}
      </span>
    </button>
  );
}

/** A labelled switch row: icon, copy and the trailing switch. */
export function SettingsSwitchRow({
  icon,
  title,
  caption,
  detail,
  checked,
  disabled,
  onChange,
}: {
  icon?: ReactNode;
  title: string;
  caption?: string;
  detail?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="workspace-setting-row">
      {icon ? (
        <span className="workspace-setting-icon">{icon}</span>
      ) : (
        <span aria-hidden="true" />
      )}
      <span>
        <strong>{title}</strong>
        {caption ? <small>{caption}</small> : null}
        {detail ? (
          <span className="workspace-setting-detail">{detail}</span>
        ) : null}
      </span>
      <button
        className="workspace-switch"
        type="button"
        role="switch"
        aria-label={title}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}
