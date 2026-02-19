import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, Page, test } from "@playwright/test";

const EDITOR_SELECTOR = ".editor-content .ProseMirror";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_ROOT = path.resolve(
  __dirname,
  "../docs/specs/team/issues/artifacts/crdt-playwright"
);

interface ScenarioResult {
  id: string;
  pass: boolean;
  details: string;
  screenshots: { a: string; b: string };
}

const results: ScenarioResult[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await fs.mkdir(ARTIFACTS_ROOT, { recursive: true });
});

test.afterAll(async () => {
  const reportPath = path.resolve(
    __dirname,
    "../../tests/user-testing/results-latest.json"
  );
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
});

async function openBoth(pageA: Page, pageB: Page, docId: string) {
  await pageA.goto(`http://localhost:1234/collab-test?doc=${docId}&userId=user-a&crdtClientId=user-a-tab`);
  await pageB.goto(`http://localhost:1234/collab-test?doc=${docId}&userId=user-b&crdtClientId=user-b-tab`);
  await pageA.waitForSelector(EDITOR_SELECTOR);
  await pageB.waitForSelector(EDITOR_SELECTOR);
}

async function clearAndRefresh(page: Page) {
  await page.getByTestId("collab-clear-all").click();
  await page.reload();
  await page.waitForSelector(EDITOR_SELECTOR);
}

async function typePerKey(page: Page, text: string) {
  for (const char of text) {
    await page.keyboard.type(char);
  }
}

async function editorText(page: Page): Promise<string> {
  return (await page.locator(EDITOR_SELECTOR).innerText()).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

async function saveScreens(pageA: Page, pageB: Page, id: string) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const a = path.join(ARTIFACTS_ROOT, `${id}-a-${stamp}.png`);
  const b = path.join(ARTIFACTS_ROOT, `${id}-b-${stamp}.png`);
  await pageA.screenshot({ path: a, fullPage: true });
  await pageB.screenshot({ path: b, fullPage: true });
  return { a, b };
}

async function runScenario(id: string, fn: (pageA: Page, pageB: Page) => Promise<{ pass: boolean; details: string }>, pageA: Page, pageB: Page) {
  const outcome = await fn(pageA, pageB);
  const screenshots = await saveScreens(pageA, pageB, id);
  results.push({ id, pass: outcome.pass, details: outcome.details, screenshots });
}

test("user-testing markdown interactions", async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  try {
    await runScenario("2-headers", async (a, b) => {
      await openBoth(a, b, "ut-2-headers");
      await clearAndRefresh(a);
      await clearAndRefresh(b);
      await a.locator(EDITOR_SELECTOR).click();

      const lines = ["# H1", "## H2", "### H3", "#### H4", "##### H5", "###### H6"];
      for (const line of lines) {
        await typePerKey(a, line);
        await a.keyboard.press("Enter");
      }
      await a.waitForTimeout(1200);

      const countsA = await a.evaluate((sel) => {
        const r = document.querySelector(sel);
        if (!r) return null;
        return {
          h1: r.querySelectorAll("h1").length,
          h2: r.querySelectorAll("h2").length,
          h3: r.querySelectorAll("h3").length,
          h4: r.querySelectorAll("h4").length,
          h5: r.querySelectorAll("h5").length,
          h6: r.querySelectorAll("h6").length,
        };
      }, EDITOR_SELECTOR);
      const countsB = await b.evaluate((sel) => {
        const r = document.querySelector(sel);
        if (!r) return null;
        return {
          h1: r.querySelectorAll("h1").length,
          h2: r.querySelectorAll("h2").length,
          h3: r.querySelectorAll("h3").length,
          h4: r.querySelectorAll("h4").length,
          h5: r.querySelectorAll("h5").length,
          h6: r.querySelectorAll("h6").length,
        };
      }, EDITOR_SELECTOR);

      const pass = JSON.stringify(countsA) === JSON.stringify(countsB) && countsA !== null;
      return { pass, details: `header counts A=${JSON.stringify(countsA)} B=${JSON.stringify(countsB)}` };
    }, pageA, pageB);

    await runScenario("3-bullets", async (a, b) => {
      await openBoth(a, b, "ut-3-bullets");
      await clearAndRefresh(a);
      await clearAndRefresh(b);
      await a.locator(EDITOR_SELECTOR).click();

      await typePerKey(a, "- Bullet one");
      await a.keyboard.press("Enter");
      await typePerKey(a, "Bullet two");
      await a.keyboard.press("Enter");
      await a.waitForTimeout(1200);

      const [ta, tb] = await Promise.all([editorText(a), editorText(b)]);
      const hasListA = await a.locator(`${EDITOR_SELECTOR} ul li`).count();
      const hasListB = await b.locator(`${EDITOR_SELECTOR} ul li`).count();
      const pass = ta === tb && hasListA > 0 && hasListB > 0;
      return { pass, details: `textA='${ta}' textB='${tb}' liA=${hasListA} liB=${hasListB}` };
    }, pageA, pageB);

    await runScenario("4-checkboxes", async (a, b) => {
      await openBoth(a, b, "ut-4-checkboxes");
      await clearAndRefresh(a);
      await clearAndRefresh(b);
      await a.locator(EDITOR_SELECTOR).click();

      await typePerKey(a, "- [ ] Task one");
      await a.keyboard.press("Meta+Enter");
      await a.keyboard.press("Enter");
      await a.keyboard.press("Enter");
      await a.waitForTimeout(1200);

      const checkedA = await a.evaluate((sel) => {
        const box = document.querySelector(`${sel} input[type='checkbox']`) as HTMLInputElement | null;
        return box ? box.checked : null;
      }, EDITOR_SELECTOR);
      const checkedB = await b.evaluate((sel) => {
        const box = document.querySelector(`${sel} input[type='checkbox']`) as HTMLInputElement | null;
        return box ? box.checked : null;
      }, EDITOR_SELECTOR);
      const [ta, tb] = await Promise.all([editorText(a), editorText(b)]);
      const pass = ta === tb && checkedA === checkedB && checkedA !== null;
      return { pass, details: `textA='${ta}' textB='${tb}' checkedA=${checkedA} checkedB=${checkedB}` };
    }, pageA, pageB);

    await runScenario("5-numbered-lists", async (a, b) => {
      await openBoth(a, b, "ut-5-numbered");
      await clearAndRefresh(a);
      await clearAndRefresh(b);
      await a.locator(EDITOR_SELECTOR).click();

      await typePerKey(a, "1. First item");
      await a.keyboard.press("Enter");
      await typePerKey(a, "Second item");
      await a.keyboard.press("Enter");
      await a.waitForTimeout(1200);

      const [ta, tb] = await Promise.all([editorText(a), editorText(b)]);
      const olA = await a.locator(`${EDITOR_SELECTOR} ol li`).count();
      const olB = await b.locator(`${EDITOR_SELECTOR} ol li`).count();
      const pass = ta === tb && olA > 0 && olB > 0;
      return { pass, details: `textA='${ta}' textB='${tb}' olA=${olA} olB=${olB}` };
    }, pageA, pageB);

    await runScenario("6-bold-cmd-b", async (a, b) => {
      await openBoth(a, b, "ut-6-bold");
      await clearAndRefresh(a);
      await clearAndRefresh(b);
      await a.locator(EDITOR_SELECTOR).click();

      await typePerKey(a, "bold me");
      for (let i = 0; i < 7; i++) {
        await a.keyboard.press("Shift+ArrowLeft");
      }
      await a.keyboard.press("Meta+b");
      await a.waitForTimeout(1200);

      const strongA = await a.locator(`${EDITOR_SELECTOR} strong`).count();
      const strongB = await b.locator(`${EDITOR_SELECTOR} strong`).count();
      const [ta, tb] = await Promise.all([editorText(a), editorText(b)]);
      const pass = ta === tb && strongA > 0 && strongB > 0;
      return { pass, details: `textA='${ta}' textB='${tb}' strongA=${strongA} strongB=${strongB}` };
    }, pageA, pageB);
  } finally {
    await context.close();
  }
});
