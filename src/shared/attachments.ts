import type { DraftImage } from "./images";

/** One native selection: image bytes and original paths for every other file. */
export interface PickedFiles {
  readonly images: readonly DraftImage[];
  readonly paths: readonly string[];
}
