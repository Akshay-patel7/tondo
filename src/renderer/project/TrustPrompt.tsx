import { useId } from "react";
import { answerTrust } from "../connection";

/**
 * Asks whether pi may load the project's own settings and extensions. The
 * wording follows pi's trust prompt (core/project-trust.js in pi-coding-agent).
 */
export function TrustPrompt({ project }: { project: string }) {
  const titleId = useId();
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <section
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-panel border border-border bg-card p-5 shadow-composer"
      >
        <h2 id={titleId} className="font-medium">
          Trust project folder?
        </h2>
        <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{project}</p>
        <p className="mt-3 text-sm">
          This allows pi to load .pi settings and resources, install missing project packages, and
          execute project extensions. If you don't trust it, pi starts without them. Tondo remembers
          your answer.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => answerTrust(false)}
            className="rounded-control border border-border px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          >
            Don't trust
          </button>
          <button
            type="button"
            onClick={() => answerTrust(true)}
            className="rounded-control bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Trust
          </button>
        </div>
      </section>
    </main>
  );
}
