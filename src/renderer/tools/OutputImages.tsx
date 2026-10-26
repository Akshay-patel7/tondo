import { useState } from "react";
import type { ToolOutput } from "../../shared/thread";
import { ImagePreview } from "../composer/ImagePreview";
import { Button } from "../ui/button";

/** Decode only disclosed results, four thumbnails at a time. Unmounting releases their blob URLs. */
export function OutputImages({
  content,
  initiallyVisible = false,
}: {
  content: ToolOutput["content"];
  initiallyVisible?: boolean;
}) {
  const [limit, setLimit] = useState(initiallyVisible ? 4 : 0);
  const images = content.filter((part) => part.type === "image");
  if (images.length === 0) return null;
  return (
    <div className="flex flex-col items-start gap-2 px-3 py-2">
      {limit > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.slice(0, limit).map((image, index) => (
            <ImagePreview
              // oxlint-disable-next-line react/no-array-index-key -- Finished content blocks keep their positions.
              key={index}
              data={image.data}
              mimeType={image.mimeType}
              name={`Result image ${index + 1}`}
            />
          ))}
        </div>
      ) : null}
      {limit < images.length ? (
        <Button variant="ghost" size="sm" onClick={() => setLimit((shown) => shown + 4)}>
          {limit === 0 ? "Show images" : "Show more images"}
        </Button>
      ) : null}
    </div>
  );
}
