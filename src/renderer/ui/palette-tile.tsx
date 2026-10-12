import { Toggle } from "@base-ui/react/toggle";
import type { PaletteSetting } from "../../shared/settings";

export function PaletteTile({ palette, label }: { palette: PaletteSetting; label: string }) {
  return (
    <Toggle
      value={palette}
      className="flex flex-col gap-2 rounded-[10px] border border-foreground/9 p-2 text-left outline-none hover:bg-accent focus-visible:focus-ring aria-pressed:border-primary"
    >
      <span
        aria-hidden
        data-palette={palette}
        className="flex h-14 items-end gap-1 rounded-chip bg-palette-preview p-2"
      >
        <span className="size-4.5 shrink-0 rounded-full bg-palette-preview-primary" />
        <span className="h-1.5 flex-1 rounded-full bg-white/12" />
      </span>
      <span className="px-0.5 text-xs">{label}</span>
    </Toggle>
  );
}
