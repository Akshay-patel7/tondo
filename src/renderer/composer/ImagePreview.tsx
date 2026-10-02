// The thumbnail, remove action and enlarged preview follow T3 Code's
// chat/ComposerImageThumbnail.tsx and chat/ExpandedImageDialog.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import { useEffect, useRef, useState } from "react";
import { IMAGE_BYTES, IMAGE_TYPES } from "../../shared/images";

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

function ImageDialog({ data, mimeType, name, close }: Props & { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label={`Image preview: ${name}`}
      onClose={close}
      className="m-auto max-h-[90vh] max-w-[90vw] rounded-panel border border-border bg-card p-4 text-foreground backdrop:bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <span>{name}</span>
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          className="rounded-md px-3 py-1 hover:bg-muted"
        >
          Close preview
        </button>
      </div>
      <LocalImage
        data={data}
        mimeType={mimeType}
        name={name}
        className="max-h-[75vh] max-w-[85vw] object-contain"
      />
    </dialog>
  );
}

export function ImagePreview({ data, mimeType, name }: Omit<Props, "className">) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`Preview ${name}`}
        onClick={() => setExpanded(true)}
        className="block overflow-hidden rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-ring"
      >
        <LocalImage
          data={data}
          mimeType={mimeType}
          name={name}
          className="size-20 object-contain"
        />
      </button>
      {expanded ? (
        <ImageDialog data={data} mimeType={mimeType} name={name} close={() => setExpanded(false)} />
      ) : null}
    </>
  );
}
