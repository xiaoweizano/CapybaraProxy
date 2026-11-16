import {
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useAppSettings } from "../settings/settingsContext";
import { isTheme, type ThemeId } from "./theme";
import { ThemeContext } from "./themeContext";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, updateTheme } = useAppSettings();
  const theme = settings.theme;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback(
    (nextTheme: ThemeId) => {
      if (isTheme(nextTheme)) {
        void updateTheme(nextTheme);
      }
    },
    [updateTheme],
  );

  const toggleTheme = useCallback(() => {
    void updateTheme(
      theme === "cyber_flow" ? "warm_flow" : "cyber_flow",
    );
  }, [theme, updateTheme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
