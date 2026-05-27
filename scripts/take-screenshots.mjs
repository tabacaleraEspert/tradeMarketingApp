import { chromium } from "playwright";

const BASE = "https://red-grass-0c483f30f.6.azurestaticapps.net";
const OUT = "frontend/public/screenshots";

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
}

async function main() {
  const browser = await chromium.launch();

  // Mobile screenshot
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2.77,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  });
  const mPage = await mobileCtx.newPage();
  try {
    await login(mPage, "davor", "miPassword123");
    // Should be on home now
    await mPage.waitForTimeout(2000);
    await mPage.screenshot({ path: `${OUT}/screenshot-mobile.png`, type: "png" });
    console.log("Mobile screenshot OK — URL:", mPage.url());
  } catch (e) {
    console.log("Mobile failed:", e.message);
    await mPage.screenshot({ path: `${OUT}/screenshot-mobile.png`, type: "png" });
  }

  // Wide screenshot
  const wideCtx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const wPage = await wideCtx.newPage();
  try {
    await login(wPage, "davor", "miPassword123");
    await wPage.waitForTimeout(2000);
    await wPage.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await wPage.waitForTimeout(3000);
    await wPage.screenshot({ path: `${OUT}/screenshot-wide.png`, type: "png" });
    console.log("Wide screenshot OK — URL:", wPage.url());
  } catch (e) {
    console.log("Wide failed:", e.message);
    await wPage.screenshot({ path: `${OUT}/screenshot-wide.png`, type: "png" });
  }

  await browser.close();
  console.log("Done!");
}

main().catch(console.error);
