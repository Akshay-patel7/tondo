import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/**
 * The composer's frame: the --card fill, the --input edge, 16px corners and
 * the composer shadow. The Home screen draws its pre-thread composer in the
 * same frame. The edge turns --ring while anything inside has focus, since
 * the editor's own outline is off. Pass only layout classes.
 */
export function ComposerCard({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // Give the card its own raster layer instead of using the wider footer.
        "rounded-panel border border-input bg-card shadow-composer will-change-transform focus-within:border-ring",
        className,
      )}
      {...props}
    />
  );
}
