import { useId, type ReactNode, type Ref } from "react";
import { CardGroup, CardGroupRow } from "../ui/card-group";

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
    <main className="flex min-h-0 flex-1 overflow-y-auto p-8">
      {/*
       * The card gets its own compositing layer. In the page's layer its text
       * and border would turn the window-wide rows of solid tiles behind it
       * into raster tiles. Auto margins center it and still let it scroll in
       * a short window.
       */}
      <section aria-labelledby={titleId} className="m-auto w-full max-w-120 will-change-transform">
        <CardGroup>
          <CardGroupRow className="grid grid-cols-[20px_minmax(0,1fr)] items-start">
            <span
              aria-hidden
              className="flex h-5.5 items-center text-muted-foreground [&_svg]:size-4"
            >
              {icon}
            </span>
            <div className="flex min-w-0 flex-col gap-2">
              <h2
                id={titleId}
                ref={titleRef}
                tabIndex={titleRef ? -1 : undefined}
                className="w-fit text-title font-semibold outline-none focus-visible:focus-ring"
              >
                {title}
              </h2>
              <div className="flex flex-col gap-4">{children}</div>
            </div>
          </CardGroupRow>
          <CardGroupRow size="sm">
            <div className="flex w-full flex-wrap items-center justify-end gap-2">{actions}</div>
          </CardGroupRow>
        </CardGroup>
      </section>
    </main>
  );
}
