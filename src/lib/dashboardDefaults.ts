import type { Mode } from "./expenseData";

const STORAGE_KEY = "expense-dashboard-default";
const VALID_MODES: Mode[] = ["monthly", "ytd", "q1", "q2", "q3", "q4"];

export interface SavedDashboardDefault {
  year: number;
  type: "actual" | "plan";
  month: number;
  mode: Mode;
}

export function getSavedDefault(): SavedDashboardDefault | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedDashboardDefault;
    if (
      typeof parsed?.year === "number" &&
      (parsed.type === "actual" || parsed.type === "plan") &&
      typeof parsed?.month === "number" &&
      VALID_MODES.includes(parsed.mode)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveDefault(
  year: number,
  type: "actual" | "plan",
  month: number,
  mode: Mode
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ year, type, month, mode })
    );
  } catch {
    // ignore
  }
}
