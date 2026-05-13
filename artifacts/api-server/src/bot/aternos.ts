import puppeteer from "puppeteer";
import { logger } from "../lib/logger.js";

const USERNAME = process.env["ATERNOS_USERNAME"];
const PASSWORD = process.env["ATERNOS_PASSWORD"];

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

async function loginToAternos(page: Awaited<ReturnType<typeof import("puppeteer").default.prototype.newPage>>) {
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
    page.click('[data-i18n="login"]').catch(() => page.click('form button[type="submit"]').catch(() => page.keyboard.press("Enter"))),
  ]);

  const url = page.url();
  if (url.includes("/go/")) {
    throw new Error("Login failed — please check your Aternos username and password.");
  }

  logger.info({ url }, "Logged in to Aternos");
}

export type AternosStatus = "online" | "offline" | "starting" | "stopping" | "loading" | "unknown";

async function getServerStatus(page: Awaited<ReturnType<typeof import("puppeteer").default.prototype.newPage>>): Promise<AternosStatus> {
  try {
    const statusText = await page.$eval(
      ".statuslabel-label",
      (el) => el.textContent?.trim().toLowerCase() ?? ""
    );
    if (statusText.includes("online")) return "online";
    if (statusText.includes("offline")) return "offline";
    if (statusText.includes("starting")) return "starting";
    if (statusText.includes("stopping")) return "stopping";
    if (statusText.includes("loading")) return "loading";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function getServerAddress(page: Awaited<ReturnType<typeof import("puppeteer").default.prototype.newPage>>): Promise<string> {
  try {
    const addr = await page.$eval(".server-ip", (el) => el.textContent?.trim() ?? "");
    if (addr) return addr;
  } catch { /* ignore */ }

  try {
    const addr = await page.$eval(".ip-value", (el) => el.textContent?.trim() ?? "");
    if (addr) return addr;
  } catch { /* ignore */ }

  return "unknown";
}

export async function startServer(): Promise<string> {
  const browser = await getBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await loginToAternos(page);

    // Navigate to server page if needed
    if (!page.url().includes("/server")) {
      await page.goto("https://aternos.org/server/", { waitUntil: "networkidle2" });
    }

    await page.waitForSelector(".statuslabel-label", { timeout: 20000 });

    const status = await getServerStatus(page);
    logger.info({ status }, "Current server status");

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

    // Click the start button
    const clicked = await page.evaluate(() => {
      const selectors = ["#start", ".btn-start", "[class*='btn-start']", "[data-action='start']"];
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) { el.click(); return true; }
      }
      return false;
    });

    if (!clicked) {
      throw new Error("Could not find the start button. The Aternos page layout may have changed.");
    }

    logger.info("Start button clicked");
    return "🚀 Start command sent! Your Minecraft server is **starting up**. It usually takes 1–3 minutes. Use `/status` to check when it's ready.";
  } finally {
    await browser.close();
  }
}

export async function stopServer(): Promise<string> {
  const browser = await getBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await loginToAternos(page);

    if (!page.url().includes("/server")) {
      await page.goto("https://aternos.org/server/", { waitUntil: "networkidle2" });
    }

    await page.waitForSelector(".statuslabel-label", { timeout: 20000 });

    const status = await getServerStatus(page);

    if (status === "offline") {
      return "⚠️ Server is already **offline**.";
    }

    if (status === "stopping") {
      return "⏳ Server is already **stopping**. It should be offline shortly.";
    }

    if (status === "starting") {
      return "⚠️ Server is still **starting**. Wait for it to be fully online before stopping.";
    }

    const clicked = await page.evaluate(() => {
      const selectors = ["#stop", ".btn-stop", "[class*='btn-stop']", "[data-action='stop']"];
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) { el.click(); return true; }
      }
      return false;
    });

    if (!clicked) {
      throw new Error("Could not find the stop button. The Aternos page layout may have changed.");
    }

    return "🛑 Stop command sent! Your Minecraft server is **shutting down**.";
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
      await page.goto("https://aternos.org/server/", { waitUntil: "networkidle2" });
    }

    await page.waitForSelector(".statuslabel-label", { timeout: 20000 });

    const status = await getServerStatus(page);
    const addr = await getServerAddress(page);

    let players = "unknown";
    try {
      players = await page.$eval(".playercounter-count", (el) => el.textContent?.trim() ?? "0");
    } catch { /* ignore */ }

    const statusEmoji: Record<AternosStatus, string> = {
      online: "🟢",
      offline: "🔴",
      starting: "🟡",
      stopping: "🟠",
      loading: "⚪",
      unknown: "❓",
    };

    const lines = [
      `${statusEmoji[status]} **Status:** ${status.charAt(0).toUpperCase() + status.slice(1)}`,
    ];

    if (addr && addr !== "unknown") {
      lines.push(`🌐 **Address:** \`${addr}\``);
    }

    if (status === "online" && players !== "unknown") {
      lines.push(`👥 **Players online:** ${players}`);
    }

    return lines.join("\n");
  } finally {
    await browser.close();
  }
}
