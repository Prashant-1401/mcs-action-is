const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('pageerror', err => {
    console.log('PAGE_ERROR:', err.message);
  });
  
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('CONSOLE_ERROR:', msg.text());
  });

  await page.goto('http://localhost:5173');
  // wait for it to load
  await new Promise(r => setTimeout(r, 2000));
  
  // login if needed (assuming user is logged out, click "Sign In")
  // Let's just click the first button with text "Sign In"
  const buttons = await page.$$('button');
  for (let btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('Sign In')) {
      await btn.click();
      await new Promise(r => setTimeout(r, 2000));
      break;
    }
  }

  // Find the Work button
  const navs = await page.$$('button');
  for (let nav of navs) {
    const text = await page.evaluate(el => el.textContent, nav);
    if (text.includes('Work')) {
      console.log('Clicking Work tab...');
      await nav.click();
      break;
    }
  }
  
  await new Promise(r => setTimeout(r, 3000));
  await browser.close();
})();
