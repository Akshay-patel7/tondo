# Remote access

Tondo's optional browser companion controls the existing Mac-hosted threads. It does not move agents, credentials, projects or execution to a cloud backend. Desktop MessagePort traffic stays unchanged. The network gateway has its own worker thread, event loop and JavaScript heap inside the host. It starts only when Remote access is enabled in Settings. A separate Electron utility process was measured and rejected because its baseline footprint missed the unchanged idle-memory budget.

## Connection

Install Tailscale on the Mac and iPhone and sign both into the same tailnet. In Tondo Settings → Remote access, enable the feature. Tondo listens only on `127.0.0.1:43187`.

Tondo never runs Tailscale commands or changes an existing Serve configuration. After reviewing your existing Serve configuration, you can publish that loopback service privately with:

```sh
tailscale serve --bg http://127.0.0.1:43187
```

This command changes Tailscale's HTTPS handler: do not run it blindly if you already serve another app. Use your existing Tailscale routing configuration instead. Use Serve, not Funnel; do not expose the service publicly or forward a router port.

Open the HTTPS URL printed by Tailscale in Safari on the iPhone. Serve Tondo at the hostname root, not under a path such as `/tondo`; path-prefix mounts and custom domains outside `.ts.net` are not supported. A separate HTTPS port can avoid replacing an existing root handler. Enter the pairing code shown in Tondo Settings. Pairing uses an HTTP-only, same-site session cookie; the code is not put in URLs or browser storage. The browser link is private to the tailnet, and the application also checks pairing and request origins.

Paired browsers stay authorized across Tondo restarts and host/gateway recovery, until remote access is turned off. Only token hashes are stored in `<userData>/remote-pairings.json`, with owner-only permissions; bearer tokens stay in HTTP-only, same-site cookies (Secure over HTTPS). There is no app-enforced pairing expiry. Browser cookie retention still applies: the cookie is renewed on authenticated visits for the browser maximum of 400 days; clearing cookies or browser eviction requires pairing again. Turning the setting off closes all remote connections and the listening socket and forgets every paired browser, including through a quick off/on toggle. A new code is generated when the gateway starts, but restarting alone does not revoke existing pairings. Tondo does not remove a separately configured Tailscale Serve route.

## Behavior and limits

- Each browser has its own selected thread and browser-local drafts. It cannot switch the desktop's thread, overwrite desktop drafts or take over a desktop terminal.
- The browser shares the existing pi process for each thread. Listing threads does not start agents. The pool respects threads being viewed remotely.
- Text prompts, live replies, stop, queue updates, extension questions, saved history and turn diffs are supported. Local file/report previews, native file pickers, provider sign-in, project trust, app settings, terminals and Git mutations remain desktop-only.
- Recent transcript messages arrive first; saved history is fetched on demand. JavaScript, CSS and WebAssembly assets are gzip-compressed at build time for slower mobile links; there is no runtime compression work on the Mac. Remote frames, requests, connections and queued delivery are bounded. Oversized or excessively complex payloads are rejected before worker-port cloning, so an image-heavy thread cannot add a huge copy to the pi host's event loop. An overloaded browser disconnects rather than slowing pi or accumulating unlimited memory. Automatic reconnect pauses after an overload, so a large snapshot cannot cause a reconnect loop; use Reconnect to select a thread again. Prompts are never automatically replayed after reconnecting.
- Drafts use this browser's local storage, not the Mac's composer. Draft revisions and pending submissions survive reconnecting snapshots, and an accepted send never erases newer edits. If browser storage is blocked or full, a bounded in-memory fallback keeps the active editor usable and Tondo warns you to keep the thread open until you send or copy the draft. Closing or reloading the page can lose unsaved text. Cookies must be allowed for pairing.
- The Mac must remain awake, online and running Tondo. This feature does not prevent sleep. Browser suspension and network loss display a disconnected state and reconnect to a fresh snapshot.
- The gateway keeps a bounded replay ledger of 4,096 request IDs per browser. Reaching it stops further actions rather than forgetting accepted requests; restart Tondo to reset the ledger without losing device pairing.
- Remote access is effectively permission to execute code through your agents. Protect your tailnet and pairing code. Browser cookies are not isolated by port: only serve trusted applications on other HTTPS ports of the same Tailscale hostname. Disabling the feature revokes all active sessions.

## Performance acceptance

The existing budgets in `docs/plan.md` are unchanged. Include the gateway worker in the app's Mac footprint, and collect its garbage as well as the main, renderer and host heaps before footprint readings.

### Measured acceptance — 2026-11-05

Apple M5, 24 GB, macOS 26.6.2, built-in 2× 120 Hz display. Three samples per case, using unrounded medians for the gates. The complete performance suite passed all 25 tests, including the six remote cases with the browser's real static assets and automatic saved-history index (327 prompts) loaded, without running another renderer on the Mac.

| Scenario | Measured median | Unchanged limit |
|---|---:|---:|
| Remote disabled, startup footprint | 263.96 MiB | 279.4 MiB |
| Enabled, unused footprint | 275.60 MiB | 279.4 MiB |
| Connected phone, startup footprint | 274.46 MiB | 279.4 MiB |
| Active phone, before / after streaming | 277.96 / 369.27 MiB | 279.4 / 510.4 MiB |
| Slow phone, before / after streaming | 273.82 / 366.43 MiB | 279.4 / 510.4 MiB |
| Active and slow phone, frame p95 / p99 | 10.1 / 10.3 ms | 16.7 / 33 ms |
| Active and slow phone, input p95 | 32 ms | 32 ms |
| Desktop thread switch while phone watches | 23.5 ms | 100 ms |
| Renderer tasks ≥100 ms | 0 | 0 |

Verification also passed 1,222 unit tests, all 233 unpackaged end-to-end tests, three consecutive six-case mobile passes, and 14 packaged mobile/window-security tests plus the packaged sandbox smoke. Pairing, thread lists, chat, diffs, saved history and Settings screenshots were inspected in light/dark where applicable. All 325 generated gzip files decompressed exactly to their finalized originals.

Chromium and WebKit iPhone emulation are covered, not a physical iPhone. Live Tailscale setup, tunnel latency and the Tailscale daemon's incremental memory have not been measured: no existing Serve configuration was changed. The app footprint above includes the gateway worker. A physical iPhone/Serve check remains a manual setup step.
