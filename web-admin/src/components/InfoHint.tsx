/**
 * The ⓘ that sits beside a label and explains what a figure counts.
 *
 * One component for the three places that need it (card headers, both stat tiles) because the
 * accessible version is more than an icon: a focusable trigger, the text in a `sr-only` span so
 * a screen reader gets it without opening anything, and a real tooltip rather than the `title`
 * attribute — which never opens on keyboard focus and is unreadable on touch.
 */

import { Info } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function InfoHint({ text, size = 12 }: { text: string; size?: number }) {
  return (
    <Tooltip>
      <TooltipTrigger type="button" className="shrink-0 cursor-help rounded-full text-faint">
        <Info size={size} aria-hidden="true" />
        <span className="sr-only">{text}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  );
}
