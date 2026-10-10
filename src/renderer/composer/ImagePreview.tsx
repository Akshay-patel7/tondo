// The thumbnail, remove action and enlarged preview follow T3 Code's
// chat/ComposerImageThumbnail.tsx and chat/ExpandedImageDialog.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { useEffect, useRef } from "react";
import { IMAGE_BYTES, IMAGE_TYPES } from "../../shared/images";
import { Dialog, DialogHeader, DialogPopup, DialogTitle, DialogTrigger } from "../ui/dialog";

interface Props {
  readonly data: string;
  readonly mimeType: string;
  readonly name: string;
  readonly className?: string;
}

function imageUrl(data: string, mimeType: string): string {
  if (
    !(IMAGE_TYPES as readonly string[]).includes(mimeType) ||
    data.length > Math.ceil(IMAGE_BYTES / 3) * 4
  )
    throw new Error("Unsupported image preview");
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

/** Object URLs live exactly as long as the mounted image. No remote URL is accepted. */
function LocalImage({ data, mimeType, name, className }: Props) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = ref.current;
    if (!image) return;
    let url: string | undefined;
    try {
      url = imageUrl(data, mimeType);
      image.src = url;
    } catch {
      image.alt = `${name}: preview unavailable`;
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [data, mimeType, name]);
  return <img ref={ref} alt={name} className={className} />;
}

export function ImagePreview({ data, mimeType, name }: Omit<Props, "className">) {
  return (
    <Dialog>
      <DialogTrigger
        aria-label={`Preview ${name}`}
        render={
          <button
            type="button"
            className="block overflow-hidden rounded-control border border-border bg-muted focus-visible:focus-ring"
          />
        }
      >
        <LocalImage
          data={data}
          mimeType={mimeType}
          name={name}
          className="size-20 object-contain"
        />
      </DialogTrigger>
      <DialogPopup className="w-auto max-w-[90vw]">
        <DialogHeader>
          {/* The dialog's name says what it is. The title shows only the file's name. */}
          <DialogTitle>
            <span className="sr-only">Image preview: </span>
            <span className="[overflow-wrap:anywhere]">{name}</span>
          </DialogTitle>
        </DialogHeader>
        <LocalImage
          data={data}
          mimeType={mimeType}
          name={name}
          className="max-h-[70vh] max-w-[80vw] self-center rounded-control object-contain"
        />
      </DialogPopup>
    </Dialog>
  );
}
