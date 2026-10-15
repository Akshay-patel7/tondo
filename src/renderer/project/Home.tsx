import { Folder, GitBranch } from "lucide-react";
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { imagesError, type DraftImage } from "../../shared/images";
import type { PiStatus, SidebarProject } from "../../shared/protocol";
import { ComposerCard } from "../composer/ComposerCard";
import { ComposerToolbar, SendButton } from "../composer/ComposerToolbar";
import { ImagePreview } from "../composer/ImagePreview";
import { readImages } from "../composer/images";
import { appendFilePaths } from "../composer/filePaths";
import { composerAction } from "../composer/keys";
import { PromptEditor, type PromptEditorHandle } from "../composer/PromptEditor";
import {
  chooseLocalFiles,
  requestProjectGit,
  startThread,
  useHost,
  useProjectGit,
} from "../connection";
import { StatusRow } from "../extensionUi/Widgets";
import { folderName } from "../format";
import { addToast } from "../toasts/store";
import { Button } from "../ui/button";
import { Segmented, SegmentedItem } from "../ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const PLACEHOLDER = "Describe a task — @ for files, / for commands";

/** No thread is open, so no pi runs for the home page: the toolbar has no pickers. */
const NO_PI: PiStatus = { state: "stopped" };

type Checkout = "local" | "worktree";

/** What the home page holds before its thread exists. It outlives visits to a thread. */
const useHome = create<{
  /** The project you picked, or null for the one you used last. */
  readonly projectId: number | null;
  readonly checkout: Checkout;
  readonly text: string;
  readonly images: readonly DraftImage[];
}>()(() => ({ projectId: null, checkout: "local", text: "", images: [] }));

/** The project whose thread had a message most recently, or the first one. */
function recentProject(projects: readonly SidebarProject[]): SidebarProject | undefined {
  let recent = projects[0];
  let latest = -Infinity;
  for (const project of projects)
    for (const thread of project.threads)
      if (thread.updatedAt > latest) {
        latest = thread.updatedAt;
        recent = project;
      }
  return recent;
}

async function attach(files: readonly File[]): Promise<void> {
  try {
    const next = [...useHome.getState().images, ...(await readImages(files))];
    const error = imagesError(next);
    if (error) throw new Error(error);
    useHome.setState({ images: next });
  } catch (error) {
    addToast({ level: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

/** What the window shows when projects exist and no thread is open: a composer that starts one. */
export function Home() {
  const projects = useHost((host) => host.projects);
  const connected = useHost((host) => host.connection === "connected");
  const chosenId = useHome((home) => home.projectId);
  const checkout = useHome((home) => home.checkout);
  const text = useHome((home) => home.text);
  const images = useHome((home) => home.images);
  const project =
    projects.find((candidate) => candidate.id === chosenId) ?? recentProject(projects);
  const projectId = project?.id;
  const git = useProjectGit((known) =>
    projectId === undefined ? undefined : known.get(projectId),
  );
  const editor = useRef<PromptEditorHandle>(null);

  useEffect(() => {
    if (connected && projectId !== undefined) requestProjectGit(projectId);
  }, [connected, projectId]);

  useEffect(() => {
    editor.current?.focus();
  }, []);

  const pickLocalFiles = () => {
    void chooseLocalFiles()
      .then((paths) => {
        useHome.setState({ text: appendFilePaths(useHome.getState().text, paths) });
        editor.current?.focus();
      })
      .catch((error: unknown) =>
        addToast({
          level: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
  };

  const isGit = git?.git === true;
  const worktree = checkout === "worktree" && isGit;
  const message = text.trim();
  const canSend = connected && project !== undefined && (message !== "" || images.length > 0);

  const send = () => {
    if (!canSend) return;
    startThread({
      projectId: project.id,
      worktree: worktree ? { base: git.branch } : null,
      text: message,
      images,
    });
    useHome.setState({ text: "", images: [] });
  };

  // The page is one layer of its own, sized to it, rather than part of the
  // window-wide tiles. Larger or more layers here leave the GPU process holding
  // more raster memory when the first thread opens. So the composer card,
  // which is a layer of its own in a thread, joins this one here.
  return (
    <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8 pt-8 pb-24">
      <div className="m-auto flex w-full max-w-176 flex-col gap-4 will-change-transform">
        <h1 className="text-headline font-semibold tracking-[-0.02em]">What should pi work on?</h1>
        <ComposerCard
          className="will-change-auto"
          onPasteCapture={(event) => {
            if (event.clipboardData.files.length === 0) return;
            event.preventDefault();
            event.stopPropagation();
            void attach([...event.clipboardData.files]);
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) event.preventDefault();
          }}
          onDropCapture={(event) => {
            if (event.dataTransfer.files.length === 0) return;
            event.preventDefault();
            event.stopPropagation();
            void attach([...event.dataTransfer.files]);
          }}
        >
          {images.length > 0 ? (
            <div
              role="group"
              aria-label="Attached images"
              className="flex flex-wrap gap-3 px-4 pt-3"
            >
              {images.map((image) => (
                <div key={image.id} className="flex flex-col gap-1">
                  <ImagePreview data={image.data} mimeType={image.mimeType} name={image.name} />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${image.name}`}
                    onClick={() =>
                      useHome.setState({ images: images.filter((item) => item.id !== image.id) })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <PromptEditor
            ref={editor}
            size="lg"
            value={text}
            placeholder={PLACEHOLDER}
            onChange={(next) => useHome.setState({ text: next })}
            onSelection={() => {}}
            onKeyDown={(event) => {
              const action = composerAction(event, { working: false, queued: false });
              if (action !== "send" && action !== "follow-up") return false;
              send();
              return true;
            }}
          />
          <ComposerToolbar
            pi={NO_PI}
            contextRing={false}
            attach={{
              onFiles: attach,
              localFiles: { disabled: !connected, onPick: pickLocalFiles },
            }}
          >
            <SendButton disabled={!canSend} onClick={send} />
          </ComposerToolbar>
        </ComposerCard>
        {/* The row's own 8px top padding would add to the column's 16px gap. */}
        {project === undefined ? null : (
          <div className="-mt-2">
            <StatusRow
              end={
                <div className="ml-auto flex items-center gap-2 whitespace-nowrap text-faint-foreground">
                  <span>in</span>
                  <Select
                    items={projects.map((item) => ({
                      value: item.id,
                      label: folderName(item.path),
                    }))}
                    value={project.id}
                    onValueChange={(id) => {
                      if (id !== null) useHome.setState({ projectId: id });
                    }}
                  >
                    <SelectTrigger variant="outline-sm" aria-label="Project">
                      <Folder aria-hidden className="text-faint-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {folderName(item.path)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isGit ? (
                    <>
                      <span>on</span>
                      <Segmented
                        aria-label="Checkout"
                        size="sm"
                        value={[checkout]}
                        onValueChange={([chosen]) => {
                          if (chosen !== undefined) useHome.setState({ checkout: chosen });
                        }}
                      >
                        <SegmentedItem value="local">Local</SegmentedItem>
                        <SegmentedItem value="worktree">New worktree</SegmentedItem>
                      </Segmented>
                      <span
                        aria-label={`Branch ${git.branch ?? "detached HEAD"}`}
                        className="flex items-center gap-1 font-mono text-[11.5px]"
                      >
                        <GitBranch aria-hidden className="size-3" />
                        {git.branch ?? "HEAD"}
                      </span>
                    </>
                  ) : null}
                </div>
              }
            />
          </div>
        )}
      </div>
    </main>
  );
}
