import { expect, test } from "@playwright/test";
import { CONTENT_SECURITY_POLICY } from "../src/main/securityPolicy";
import { captureOpenExternal, launchTondo, type Tondo } from "./launch";

let tondo: Tondo;

test.beforeEach(async () => {
  tondo = await launchTondo();
});

test.afterEach(async () => {
  await tondo.close();
});

test("opens one window with the app in it", async () => {
  const { app, page } = tondo;
  expect(app.windows()).toHaveLength(1);
  expect(page.url()).toBe("tondo://app/");
  await expect(page).toHaveTitle("Tondo");
  await expect(page.getByRole("banner")).toHaveText("Tondo");

  const screenshot = await page.screenshot({ path: test.info().outputPath("empty-window.png") });
  await test.info().attach("empty window", { body: screenshot, contentType: "image/png" });
});

test("the page has no Node.js", async () => {
  const globals = await tondo.page.evaluate(() => [typeof require, typeof process, typeof module]);
  expect(globals).toEqual(["undefined", "undefined", "undefined"]);
});

test("navigating to another site is blocked, and the link opens in the browser", async () => {
  const { app, page } = tondo;
  const openedUrl = await captureOpenExternal(app);

  await page.evaluate(() => {
    document.body.dataset.sameDocument = "yes";
    location.href = "https://example.com/elsewhere";
  });

  expect(await openedUrl()).toBe("https://example.com/elsewhere");
  expect(page.url()).toBe("tondo://app/");
  expect(await page.evaluate(() => document.body.dataset.sameDocument)).toBe("yes");
});

test("window.open is denied, and the link opens in the browser", async () => {
  const { app, page } = tondo;
  const openedUrl = await captureOpenExternal(app);

  const gotPopup = await page.evaluate(() => window.open("https://example.com/popup") !== null);

  expect(gotPopup).toBe(false);
  expect(await openedUrl()).toBe("https://example.com/popup");
  expect(app.windows()).toHaveLength(1);
});

test("tondo:// responses carry the CSP, and the page enforces it", async () => {
  const { page } = tondo;
  const responses = await page.evaluate(async () => {
    const found = await fetch("/");
    const missing = await fetch("/no-such-file.js");
    return [found, missing].map((response) => ({
      status: response.status,
      csp: response.headers.get("content-security-policy"),
    }));
  });
  expect(responses).toEqual([
    { status: 200, csp: CONTENT_SECURITY_POLICY },
    { status: 404, csp: CONTENT_SECURITY_POLICY },
  ]);

  // An inline script runs as soon as it's inserted, unless the CSP blocks it.
  const inlineScript = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        document.addEventListener(
          "securitypolicyviolation",
          (event) => resolve(`blocked by ${event.effectiveDirective}`),
          { once: true },
        );
        const script = document.createElement("script");
        script.textContent = "document.body.dataset.inlineScriptRan = 'yes'";
        document.head.append(script);
        if (document.body.dataset.inlineScriptRan) resolve("ran");
      }),
  );
  expect(inlineScript).toBe("blocked by script-src-elem");
});

test("permission requests are denied", async () => {
  const permission = await tondo.page.evaluate(() => Notification.requestPermission());
  expect(permission).toBe("denied");
});
