import { MoonStar, SunMedium } from "lucide-react";
import { useAppSettings } from "../settings/settingsContext";
import { useTheme } from "../theme/themeContext";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { mode, isSaving } = useAppSettings();
  const disabled = mode === "loading" || isSaving;

  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      <button
        className="theme-toggle-button"
        type="button"
        aria-label="Use Cyber Flow theme"
        aria-pressed={theme === "cyber_flow"}
        disabled={disabled}
        onClick={() => setTheme("cyber_flow")}
      >
        <MoonStar aria-hidden="true" size={14} />
      </button>
      <button
        className="theme-toggle-button"
        type="button"
        aria-label="Use Warm Flow theme"
        aria-pressed={theme === "warm_flow"}
        disabled={disabled}
        onClick={() => setTheme("warm_flow")}
      >
        <SunMedium aria-hidden="true" size={14} />
      </button>
    </div>
  );
}
