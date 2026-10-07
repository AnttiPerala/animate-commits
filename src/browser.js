import { chromium } from 'playwright';

export async function launchBrowser(choice = 'auto') {
  if (choice !== 'auto') return chromium.launch({ headless: true, ...(choice === 'chromium' ? {} : { channel: choice }) });
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    // Fall back only for a missing downloaded browser, not arbitrary launch errors.
    if (!error.message.includes("Executable doesn't exist")) throw error;
    for (const channel of ['msedge', 'chrome']) {
      try { return await chromium.launch({ headless: true, channel }); }
      catch { /* Try the next installed Chromium browser. */ }
    }
    throw new Error('No usable browser found. Run npm run browser:install, or install Chrome or Edge.', { cause: error });
  }
}
