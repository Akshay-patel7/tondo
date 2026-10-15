import { GitBranch } from "lucide-react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "../ui/combobox";

/** A branch selector with search inside the dropdown, not an editable Git ref. */
export function BranchPicker({
  id,
  label,
  name,
  branches,
  value,
  disabled,
  onValueChange,
}: {
  id: string;
  label: string;
  name?: string;
  branches: readonly string[];
  value: string;
  disabled: boolean;
  onValueChange: (branch: string) => void;
}) {
  return (
    <Combobox
      items={branches}
      name={name}
      value={value || null}
      disabled={disabled}
      onValueChange={(chosen) => {
        if (chosen !== null) onValueChange(chosen);
      }}
    >
      <ComboboxTrigger id={id} aria-label={label} className="w-full">
        <GitBranch aria-hidden />
        <ComboboxValue placeholder="Choose a branch" />
      </ComboboxTrigger>
      <ComboboxContent>
        <div className="p-1">
          <ComboboxInput
            aria-label="Search branches"
            placeholder="Search branches…"
            showTrigger={false}
          />
        </div>
        <ComboboxEmpty>No branches found.</ComboboxEmpty>
        <ComboboxList aria-label={label}>
          {(branch: string) => (
            <ComboboxItem key={branch} value={branch}>
              {branch}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
