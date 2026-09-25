// oxlint-disable unicorn/no-empty-file -- Stage 2 gives this entry its code.

// The preload runs sandboxed, before the page. Its only job is handing the
// page a MessagePort to the host, which arrives with the host in Stage 2.
// Until then it deliberately exposes nothing.
