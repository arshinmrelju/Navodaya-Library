const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    page.on('console', msg => {
        console.log(`[BROWSER CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
    });

    page.on('pageerror', error => {
        console.error(`[BROWSER ERROR]: ${error.message}`);
    });

    try {
        await page.goto('https://navodhayam-library.web.app/admin.html', { waitUntil: 'networkidle2' });
        // wait for a bit
        await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
        console.error("Navigation error:", e);
    }
    
    await browser.close();
})();
