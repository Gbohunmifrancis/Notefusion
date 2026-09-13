import { CondensationBackground, type CondensationBackgroundProps } from "./condensation/CondensationBackground";

export type ElementsCollectionProps = CondensationBackgroundProps & {
  variant?: "condensation";
};

export function ElementsCollection({ variant = "condensation", ...props }: ElementsCollectionProps) {
  if (variant === "condensation") {
    return <CondensationBackground {...props} />;
  }
  return <CondensationBackground {...props} />;
}

export { CondensationBackground };
