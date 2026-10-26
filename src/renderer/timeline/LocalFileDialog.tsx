import { useEffect, useState } from "react";
import type { LinkSafetyModalProps } from "streamdown";
import type { FilePreview } from "../../shared/filePreview";
import { previewFile } from "../connection";
import { LocalImage } from "../composer/ImagePreview";
import { OutputView } from "../tools/OutputView";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

/** Mounted content owns its bytes. The transcript itself never loads linked files. */
export function LocalFileDialog({
  target,
  isOpen,
  onClose,
}: LinkSafetyModalProps & { target: string }) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {isOpen ? <FileContents target={target} /> : null}
    </Dialog>
  );
}

function FileContents({ target }: { target: string }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    previewFile(target, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setPreview(result);
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setPreview({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => controller.abort();
  }, [target]);

  return (
    <DialogPopup aria-modal showCloseButton={false} className="w-[min(56rem,90vw)] max-w-[90vw]">
      <DialogHeader>
        <DialogTitle>File preview</DialogTitle>
        <DialogDescription className="wrap-anywhere">{target}</DialogDescription>
      </DialogHeader>
      <PreviewContent preview={preview} />
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
      </DialogFooter>
    </DialogPopup>
  );
}

function PreviewContent({ preview }: { preview: FilePreview | null }) {
  if (preview === null) return <p className="text-sm text-muted-foreground">Loading file…</p>;
  if (preview.kind === "error")
    return (
      <p role="alert" className="text-sm text-destructive">
        {preview.message}
      </p>
    );
  if (preview.kind === "image")
    return (
      <LocalImage
        data={preview.data}
        mimeType={preview.mimeType}
        name={preview.path}
        className="max-h-[65vh] max-w-full self-center object-contain"
      />
    );
  return (
    <div className="max-h-[65vh] overflow-auto">
      <OutputView text={preview.text} label="File contents" />
      {preview.truncated ? (
        <p className="text-xs text-muted-foreground">Showing the first 256 KiB.</p>
      ) : null}
    </div>
  );
}
