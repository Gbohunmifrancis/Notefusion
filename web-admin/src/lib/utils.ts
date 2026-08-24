import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, with later Tailwind utilities beating earlier ones.
 *
 * `clsx` flattens conditionals and arrays; `twMerge` then resolves conflicts within a
 * utility group, so `cn("p-4", "p-6")` yields `p-6` rather than emitting both and leaving
 * the winner to CSS source order. Every shadcn component composes its variants through
 * this, which is what makes a `className` prop at the call site reliably override them.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
