// The Appearance section: the theme, and the palette, picked from tiles that
// preview each one.
import { Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";
import { PALETTE_SETTINGS, type PaletteSetting } from "../../shared/settings";
import { updateSettings, useHost } from "../connection";
import {
  CardGroup,
  CardGroupRow,
  CardGroupRowDescription,
  CardGroupRowText,
  CardGroupRowTitle,
} from "../ui/card-group";
import { Segmented, SegmentedItem } from "../ui/segmented";
import { ToggleGroup } from "../ui/toggle-group";
import { PaletteTile } from "../ui/palette-tile";
import { Loading, SettingsRow } from "./rows";

const PALETTE_TITLES: Readonly<Record<PaletteSetting, string>> = {
  default: "Default",
  slate: "Slate",
  ocean: "Ocean",
  rose: "Rose",
};

export function AppearanceSettings() {
  const theme = useHost((host) => host.settings?.theme);
  const palette = useHost((host) => host.settings?.palette);
  const themeLabelId = useId();
  const paletteLabelId = useId();
  if (theme === undefined || palette === undefined) return <Loading>Loading settings…</Loading>;
  return (
    <CardGroup>
      <SettingsRow
        title="Theme"
        titleId={themeLabelId}
        description="System follows your computer's appearance."
        control={
          <Segmented
            aria-labelledby={themeLabelId}
            value={[theme]}
            onValueChange={([chosen]) => {
              if (chosen !== undefined) updateSettings({ theme: chosen });
            }}
          >
            <SegmentedItem value="system">
              <Monitor aria-hidden />
              System
            </SegmentedItem>
            <SegmentedItem value="light">
              <Sun aria-hidden />
              Light
            </SegmentedItem>
            <SegmentedItem value="dark">
              <Moon aria-hidden />
              Dark
            </SegmentedItem>
          </Segmented>
        }
      />
      <CardGroupRow className="flex-col items-stretch">
        <CardGroupRowText>
          <CardGroupRowTitle id={paletteLabelId}>Palette</CardGroupRowTitle>
          <CardGroupRowDescription>
            The accent and the tint of the neutrals.
          </CardGroupRowDescription>
        </CardGroupRowText>
        <ToggleGroup
          aria-labelledby={paletteLabelId}
          spacing={2}
          value={[palette]}
          onValueChange={([chosen]) => {
            // Clicking the chosen palette again unpresses it, which changes nothing.
            if (chosen !== undefined) updateSettings({ palette: chosen });
          }}
          className="grid w-full grid-cols-4 items-stretch"
        >
          {PALETTE_SETTINGS.map((id) => (
            <PaletteTile key={id} palette={id} label={PALETTE_TITLES[id]} />
          ))}
        </ToggleGroup>
      </CardGroupRow>
    </CardGroup>
  );
}
