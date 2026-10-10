import { useId, type ReactNode, type Ref } from "react";

/**
 * A card in place of the thread, for something Tondo needs from you before pi
 * can run: an icon, a heading, what's going on, and what you can do about it.
 */
export function SetupCard({
  icon,
  title,
  titleRef,
  children,
  actions,
}: {
  /** A lucide icon, hidden from screen readers. */
  icon: ReactNode;
  /** The heading, which also names the card's region. */
  title: string;
  /** With a ref, the heading can take focus, so the caller can move focus to it. */
  titleRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
  /** Buttons, aligned to the end. A button with mr-auto stays at the start. */
  actions: ReactNode;
}) {
  const titleId = useId();
  return (
    <main className="flex min-h-0 flex-1 overflow-y-auto p-6">
      {/*
       * The card gets its own compositing layer. In the page's layer its text
       * and border would turn the window-wide rows of solid tiles behind it
       * into raster tiles. Auto margins center it and still let it scroll in
       * a short window.
       */}
      <section
        aria-labelledby={titleId}
        className="m-auto w-full max-w-lg rounded-panel border border-border bg-card p-6 text-card-foreground shadow-composer will-change-transform"
      >
        <div
          aria-hidden
          className="mb-4 flex size-10 items-center justify-center rounded-control bg-accent text-accent-foreground [&_svg]:size-5"
        >
          {icon}
        </div>
        <h2
          id={titleId}
          ref={titleRef}
          tabIndex={titleRef ? -1 : undefined}
          className="w-fit text-base font-semibold tracking-tight outline-none focus-visible:focus-ring"
        >
          {title}
        </h2>
        <div className="mt-2 flex flex-col gap-4 text-sm">{children}</div>
        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">{actions}</div>
      </section>
    </main>
  );
}
