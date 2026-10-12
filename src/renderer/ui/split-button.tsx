import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * A neutral button with a chevron part behind a 1px divider, for "Commit &
 * push". The group draws the one border and the fill; its parts are
 * borderless and each hovers on its own.
 *
 *   <SplitButton>
 *     <SplitButtonMain onClick={commitAndPush} disabled={!changes}>
 *       <GitCommitHorizontal aria-hidden />
 *       Commit & push
 *     </SplitButtonMain>
 *     <DropdownMenuTrigger render={<SplitButtonTrigger aria-label="Git actions" />} />
 *   </SplitButton>
 */
function SplitButton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="split-button"
      role="group"
      className={cn(
        "inline-flex h-7 shrink-0 items-stretch rounded-control border border-input bg-neutral bg-clip-padding text-sm text-foreground",
        className,
      )}
      {...props}
    />
  );
}

// The parts' corners sit 1px inside the group's, so the fill meets the border.
const PART =
  "inline-flex items-center justify-center whitespace-nowrap outline-none select-none focus-visible:z-10 focus-visible:focus-ring hover:bg-neutral-hover aria-expanded:bg-neutral-hover disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5";

type PartProps = useRender.ComponentProps<"button">;

function SplitButtonMain({ className, render, ...props }: PartProps) {
  const defaultProps = {
    className: cn(
      PART,
      "gap-1.5 rounded-s-[calc(var(--control-radius)-1px)] px-2.5 font-medium",
      className,
    ),
    "data-slot": "split-button-main",
    type: render ? undefined : ("button" as const),
  };
  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(defaultProps, props),
  });
}

type TriggerProps = PartProps & { children?: ReactNode };

const CHEVRON = <ChevronDownIcon aria-hidden />;

/** The chevron part. Name it with aria-label; it opens the menu. */
function SplitButtonTrigger({ className, render, children = CHEVRON, ...props }: TriggerProps) {
  const defaultProps = {
    className: cn(
      PART,
      "w-7 rounded-e-[calc(var(--control-radius)-1px)] border-s border-input",
      className,
    ),
    "data-slot": "split-button-trigger",
    type: render ? undefined : ("button" as const),
    children,
  };
  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(defaultProps, props),
  });
}

export { SplitButton, SplitButtonMain, SplitButtonTrigger };
