// list-styles.ts
export type ListStylePreset =
  | "standard"       // 1. / a. / b. / i.
  | "parentheses"    // 1) / a) / b) / i)
  | "legal-numeric"  // 1. / 1.1. / 1.2. / 1.2.1.
  | "alpha-upper"    // A. / a. / b. / i.
  | "alpha-lower"    // a. / 1. / 2. / i.
  | "roman-upper"    // I. / A. / B. / 1.
  | "roman-lower"    // i. / 1. / 2. / a.
  | "leading-zero"   // 01. / a. / b. / i.

export interface ListStyleConfig {
  id: ListStylePreset
  label: string
  preview: string[]
}

export const LIST_STYLES: ListStyleConfig[] = [
  { id: "standard", label: "Standard", preview: ["1.", "a.", "b.", "i.", "2."] },
  { id: "parentheses", label: "Parentheses", preview: ["1)", "a)", "b)", "i)", "2)"] },
  { id: "legal-numeric", label: "Legal Numeric", preview: ["1.", "1.1.", "1.2.", "1.2.1.", "2."] },
  { id: "alpha-upper", label: "Capital Alpha", preview: ["A.", "a.", "b.", "i.", "B."] },
  { id: "alpha-lower", label: "Lower Alpha", preview: ["a.", "1.", "2.", "i.", "b."] },
  { id: "roman-upper", label: "Roman Numerals", preview: ["I.", "A.", "B.", "1.", "II."] },
  { id: "roman-lower", label: "Lower Roman", preview: ["i.", "1.", "2.", "a.", "ii."] },
  { id: "leading-zero", label: "Leading Zero", preview: ["01.", "a.", "b.", "i.", "02."] },
]