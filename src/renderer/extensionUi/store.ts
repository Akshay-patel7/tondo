import { create } from "zustand";
import { NO_EXTENSION_UI, type ExtensionUi } from "../../shared/protocol";

/** What the extensions of the thread on screen show. */
export const useExtensionUi = create<ExtensionUi>()(() => NO_EXTENSION_UI);

export function showExtensionUi(ui: ExtensionUi): void {
  useExtensionUi.setState(ui, true);
}
