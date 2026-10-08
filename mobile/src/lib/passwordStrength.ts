/** Matches `RegisterCommandValidator` on the server: the one hard rule. */
export const MIN_PASSWORD = 8;

export interface Strength {
  /** Bars to fill, 0–4. */
  score: number;
  /** What to show under the bars: how to improve, not just "weak". */
  hint: string;
  /** A night palette colour name for the filled bars. */
  tone: "dim" | "red" | "amber" | "mint";
}

/**
 * Four bars and a sentence that says what would make the password stronger.
 * Only the length is a rule (the server's); the rest is advice.
 */
export function passwordStrength(pw: string): Strength {
  if (pw.length === 0) return { score: 0, hint: `At least ${MIN_PASSWORD} characters`, tone: "dim" };
  if (pw.length < MIN_PASSWORD) {
    const left = MIN_PASSWORD - pw.length;
    return { score: 1, hint: `Too short · ${left} more character${left === 1 ? "" : "s"}`, tone: "red" };
  }
  const missing: string[] = [];
  if (!/\d/.test(pw)) missing.push("a number");
  if (!(/[a-z]/.test(pw) && /[A-Z]/.test(pw))) missing.push("a capital letter");
  if (!/[^A-Za-z0-9]/.test(pw) && pw.length < 12) missing.push("a symbol");
  const score = Math.max(1, 4 - missing.length);
  if (score === 4) return { score, hint: "Strong", tone: "mint" };
  if (score === 3) return { score, hint: `Good · add ${missing[0]} to make it strong`, tone: "mint" };
  return { score, hint: `${score === 1 ? "Weak" : "Fair"} · add ${missing[0]}`, tone: "amber" };
}
