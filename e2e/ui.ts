// Helpers for the ui Select (src/renderer/ui/select.tsx). Its trigger is a
// combobox named by its aria-label, and its list lives in a portal on the
// body, so these reach the list through the open trigger's aria-controls.
import { expect, type Locator, type Page } from "@playwright/test";

function trigger(scope: Page | Locator, picker: string | RegExp): Locator {
  return scope.getByRole("combobox", { name: picker, exact: true });
}

async function openPicker(scope: Page | Locator, picker: string | RegExp): Promise<Locator> {
  const button = trigger(scope, picker);
  await button.click();
  await expect(button).toHaveAttribute("aria-controls", /./);
  const id = await button.getAttribute("aria-controls");
  const listbox = button.page().locator(`[id="${id}"]`);
  await expect(listbox).toBeVisible();
  return listbox;
}

/** Chooses `option` in the picker named `picker`, and waits until its list closes. */
export async function pickOption(
  scope: Page | Locator,
  picker: string | RegExp,
  option: string | RegExp,
): Promise<void> {
  const listbox = await openPicker(scope, picker);
  await listbox.getByRole("option", { name: option, exact: true }).click();
  await expect(listbox).toBeHidden();
}

/** Expects the picker named `picker` to hold `value`, which its trigger keeps in data-value. */
export async function expectPicked(
  scope: Page | Locator,
  picker: string | RegExp,
  value: string,
): Promise<void> {
  await expect(trigger(scope, picker)).toHaveAttribute("data-value", value);
}

/** The names of the picker's options, in order. It opens the picker, then closes it with Escape. */
export async function pickerOptions(
  scope: Page | Locator,
  picker: string | RegExp,
): Promise<string[]> {
  const listbox = await openPicker(scope, picker);
  const names = await listbox.getByRole("option").allTextContents();
  await listbox.page().keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  return names.map((name) => name.trim());
}
