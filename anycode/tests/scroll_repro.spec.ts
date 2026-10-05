import { test } from '@playwright/test';

test('measure textarea height during autoResizeTextarea', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);

  const textarea = page.locator('.acp-input-block-textarea').first();
  const inputContainer = page.locator('.acp-input').first();

  const result = await page.evaluate(() => {
    const ta = document.querySelector('.acp-input-block-textarea') as HTMLTextAreaElement;
    const ic = document.querySelector('.acp-input') as HTMLElement;
    const hBefore = ic.getBoundingClientRect().height;

    ta.style.height = 'auto';
    const hAuto = ic.getBoundingClientRect().height;
    const scrollH = ta.scrollHeight;

    const nextHeight = Math.min(Math.max(scrollH, 24), 160);
    ta.style.height = `${nextHeight}px`;
    const hAfter = ic.getBoundingClientRect().height;

    return { hBefore, hAuto, scrollH, nextHeight, hAfter };
  });

  console.log('RESULT OF RESIZE:', result);
});
