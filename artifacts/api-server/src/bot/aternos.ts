import puppeteer from "puppeteer";
import { logger } from "../lib/logger.js";

const USERNAME = process.env["ATERNOS_USERNAME"];
const PASSWORD = process.env["ATERNOS_PASSWORD"];

// How long to keep the browser open waiting for the queue confirm button (20 min)
const QUEUE_WATCH_MS = 20 * 60 * 1000;
const QUEUE_POLL_INTERVAL_MS = 4000;

type Page = Awaited<ReturnType<typeof import("puppeteer").default.prototype.newPage>>;

function getBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
}

async function loginToAternos(page: Page) {
  if (!USERNAME || !PASSWORD) {
    throw new Error("ATERNOS_USERNAME and ATERNOS_PASSWORD must be set.");
  }

  logger.info("Navigating to Aternos login page...");
  await page.goto("https://aternos.org/go/", {
    waitUntil: "networkidle2",
    timeout: 30000,
  });

  await page.waitForSelector("#user", { timeout: 15000 });
  await page.type("#user", USERNAME, { delay: 50 });
  await page.type("#password", PASSWORD, { delay: 50 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
    page
      .click('[data-i18n="login"]')
      .catch(() =>
        page
          .click('form button[type="submit"]')
          .catch(() => page.keyboard.press("Enter"))
      ),
  ]);

  const url = page.url();
  if (url.includes("/go/")) {
    throw new Error(
      "Login failed — please check your Aternos username and password."
    );
  }

  logger.info({ url }, "Logged in to Aternos");
}

export type AternosStatus =
  | "online"
  | "offline"
  | "starting"
  | "stopping"
  | "waiting"
  | "loading"
  | "unknown";

async function getServerStatus(page: Page): Promise<AternosStatus> {
  try {
    const statusText = await page.$eval(
      ".statuslabel-label",
      (el) => el.textContent?.trim().toLowerCase() ?? ""
    );
    if (statusText.includes("online")) return "online";
    if (statusText.includes("offline")) return "offline";
    if (statusText.includes("starting")) return "starting";
    if (statusText.includes("stopping")) return "stopping";
    if (statusText.includes("waiting") || statusText.includes("queue"))
      return "waiting";
    if (statusText.includes("loading")) return "loading";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function getServerAddress(page: Page): Promise<string> {
  for (const sel of [".server-ip", ".ip-value", ".server-address"]) {
    try {
      const addr = await page.$eval(sel, (el) => el.textContent?.trim() ?? "");
      if (addr) return addr;
    } catch { /* ignore */ }
  }
  return "unknown";
}

/** Grab the status sub-label (uptime, queue ETA, etc.) from the page. */
async function getStatusDescription(page: Page): Promise<string> {
  for (const sel of [
    ".statuslabel-description",
    ".statuslabel-sub",
    ".queue-info",
    ".queue-time",
    ".queue-duration",
  ]) {
    try {
      const text = await page.$eval(sel, (el) => el.textContent?.trim() ?? "");
      if (text) return text;
    } catch { /* ignore */ }
  }
  return "";
}

/** Get queue position from the page if available. */
async function getQueuePosition(page: Page): Promise<string> {
  for (const sel of [
    ".queue-count",
    ".queue-position",
    ".queue-number",
  ]) {
    try {
      const text = await page.$eval(sel, (el) => el.textContent?.trim() ?? "");
      if (text) return text;
    } catch { /* ignore */ }
  }
  return "";
}

/**
 * Check whether the Aternos confirm button is present and visible,
 * and click it if found. Returns true if it was clicked.
 */
async function tryClickConfirm(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const selectors = [
      "#confirm",
      ".btn-confirm",
      "[class*='btn-confirm']",
      "[data-action='confirm']",
      // Aternos sometimes uses a generic btn class with confirm text
      ...Array.from(document.querySelectorAll("button, .btn")).filter((el) =>
        el.textContent?.trim().toLowerCase().includes("confirm")
      ),
    ] as (string | Element)[];

    for (const sel of selectors) {
      const el =
        typeof sel === "string"
          ? (document.querySelector(sel) as HTMLElement | null)
          : (sel as HTMLElement);
      if (el && (el as HTMLElement).offsetParent !== null) {
        // offsetParent !== null means the element is visible
        (el as HTMLElement).click();
        return true;
      }
    }
    return false;
  });
}

/**
 * After clicking Start, keep the browser open and watch for the queue
 * confirm button for up to QUEUE_WATCH_MS ms, clicking it the moment it appears.
 *
 * Returns a descriptive message about what happened.
 */
async function watchQueueAndConfirm(page: Page): Promise<string> {
  const deadline = Date.now() + QUEUE_WATCH_MS;
  let confirmedQueue = false;

  logger.info("Watching for queue confirm button...");

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, QUEUE_POLL_INTERVAL_MS));

    // Reload the page state to pick up live changes
    try {
      await page.reload({ waitUntil: "networkidle2", timeout: 15000 });
    } catch {
      // If reload times out, just continue polling
    }

    const status = await getServerStatus(page);
    logger.info({ status }, "Queue watch — current status");

    if (status === "online") {
      const addr = await getServerAddress(page);
      return `✅ Server is now **online**! Connect at: \`${addr}\``;
    }

    if (status === "starting") {
      return "🚀 Server start confirmed! It's now **booting up** — usually takes 1–3 minutes. Use \`/status\` to check when it's ready.";
    }

    if (status === "offline") {
      return "⚠️ Server went back **offline** unexpectedly. Try `/start` again.";
    }

    // Server is in queue (waiting) — check for confirm button
    if (status === "waiting" || status === "loading" || status === "unknown") {
      const clicked = await tryClickConfirm(page);
      if (clicked) {
        confirmedQueue = true;
        logger.info("Queue confirm button clicked!");
        // Give the page a moment to react, then check status again
        await new Promise((r) => setTimeout(r, 3000));
        const newStatus = await getServerStatus(page);
        if (newStatus === "starting" || newStatus === "online") {
          return "✅ Queue confirmed and server is now **starting up**! Use `/status` to check when it's ready.";
        }
        // Confirmed but still waiting — keep watching
      }
    }
  }

  if (confirmedQueue) {
    return "✅ Queue was confirmed automatically. The server is still **starting up** — use `/status` to track progress.";
  }

  return "⏳ Start command sent and bot is monitoring the queue. If a confirm button appeared it was clicked automatically. Use `/status` to check progress.";
}

export async function startServer(): Promise<string> {
  const browser = await getBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await loginToAternos(page);

    if (!page.url().includes("/server")) {
      await page.goto("https://aternos.org/server/", {
        waitUntil: "networkidle2",
      });
    }

    await page.waitForSelector(".statuslabel-label", { timeout: 20000 });

    const status = await getServerStatus(page);
    logger.info({ status }, "Pre-start server status");

    if (status === "online") {
      const addr = await getServerAddress(page);
      return `✅ Server is already **online**! Connect at: \`${addr}\``;
    }

    if (status === "starting") {
      return "⏳ Server is already **starting up** — hang tight, it won't be long!";
    }

    if (status === "stopping") {
      return "⚠️ Server is currently **stopping**. Wait for it to go offline, then try again.";
    }

    if (status === "waiting") {
      // Already in queue — just watch for the confirm button
      return watchQueueAndConfirm(page);
    }

    // Click the start button
    const clicked = await page.evaluate(() => {
      const selectors = [
        "#start",
        ".btn-start",
        "[class*='btn-start']",
        "[data-action='start']",
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) {
          el.click();
          return true;
        }
      }
      return false;
    });

    if (!clicked) {
      throw new Error(
        "Could not find the start button. The Aternos page layout may have changed."
      );
    }

    logger.info("Start button clicked — waiting to see if queue appears...");

    // Wait a few seconds for the page to reflect the new state
    await new Promise((r) => setTimeout(r, 5000));
    await page.reload({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});

    const postClickStatus = await getServerStatus(page);
    logger.info({ postClickStatus }, "Status after start click");

    if (postClickStatus === "starting" || postClickStatus === "online") {
      return "🚀 Server is **starting up**! It usually takes 1–3 minutes. Use `/status` to check when it's ready.";
    }

    if (postClickStatus === "waiting") {
      const queuePos = await getQueuePosition(page);
      const queueDesc = await getStatusDescription(page);
      const queueInfo = [queuePos, queueDesc].filter(Boolean).join(" — ");
      const queueMsg = queueInfo ? `\n📋 Queue info: ${queueInfo}` : "";

      // Start watching for confirm in the background — this keeps browser open
      return watchQueueAndConfirm(page).then(
        (result) => result,
        () =>
          `⏳ Server is in the **queue**.${queueMsg}\nThe bot will automatically click **Confirm** the moment it appears — no action needed from you!`
      );
    }

    return `🚀 Start command sent!${
      postClickStatus !== "unknown"
        ? ` Server is now **${postClickStatus}**.`
        : " Use \`/status\` to track progress."
    }`;
  } finally {
    await browser.close();
  }
}

export async function getStatus(): Promise<string> {
  const browser = await getBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await loginToAternos(page);

    if (!page.url().includes("/server")) {
      await page.goto("https://aternos.org/server/", {
        waitUntil: "networkidle2",
      });
    }

    await page.waitForSelector(".statuslabel-label", { timeout: 20000 });

    const status = await getServerStatus(page);
    const addr = await getServerAddress(page);
    const description = await getStatusDescription(page);
    const queuePos = await getQueuePosition(page);

    let players = "";
    try {
      players =
        (await page.$eval(
          ".playercounter-count",
          (el) => el.textContent?.trim() ?? ""
        )) ?? "";
    } catch { /* ignore */ }

    const statusEmoji: Record<AternosStatus, string> = {
      online: "🟢",
      offline: "🔴",
      starting: "🟡",
      stopping: "🟠",
      waiting: "🕐",
      loading: "⚪",
      unknown: "❓",
    };

    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
    const lines: string[] = [
      `${statusEmoji[status]} **Status:** ${statusLabel}`,
    ];

    // Address
    if (addr && addr !== "unknown") {
      lines.push(`🌐 **Address:** \`${addr}\``);
    }

    // Online-specific details
    if (status === "online") {
      if (players) {
        lines.push(`👥 **Players online:** ${players}`);
      }
      // Uptime from description (e.g. "Online for 2h 34m" or "2:34:15")
      if (description) {
        // Strip any leading "online for" prefix if present
        const uptime = description.replace(/^online\s+for\s*/i, "").trim();
        if (uptime) lines.push(`⏱️ **Uptime:** ${uptime}`);
      }
    }

    // Queue/starting details
    if (status === "waiting" || status === "starting") {
      if (queuePos) {
        lines.push(`📋 **Queue position:** ${queuePos}`);
      }
      if (description) {
        // Description often contains ETA like "~5 mins" or "Estimated: 3 min"
        const eta = description.replace(/^estimated[:\s]*/i, "").trim();
        if (eta) lines.push(`⏳ **Estimated wait:** ${eta}`);
      }
      if (status === "waiting") {
        lines.push(
          `💡 The bot will auto-click **Confirm** if you have a queued \`/start\` running.`
        );
      }
    }

    return lines.join("\n");
  } finally {
    await browser.close();
  }
}
