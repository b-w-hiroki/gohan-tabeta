import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(root + '/')) throw new Error('path');
    const mime = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'};
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  await mkdir('test-results/landing', {recursive:true});
  for (const width of [320,390,1180]) for (const colorScheme of ['light','dark']) {
    const context = await browser.newContext({viewport:{width,height:844},colorScheme,serviceWorkers:'block'});
    const page = await context.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    await page.goto(base);
    const story = page.locator('.product-story');
    assert.equal(await story.count(),1);
    await story.scrollIntoViewIfNeeded();
    const geometry = await story.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth}));
    assert.ok(geometry.left>=0 && geometry.right<=width+1,JSON.stringify(geometry));
    assert.ok(geometry.overflow<=1,JSON.stringify(geometry));
    assert.ok(await story.locator('.story-note').isVisible());
    for(const img of await story.locator('img').all()) assert.ok(await img.evaluate(el=>el.complete && el.naturalWidth>0));
    const cta=page.locator('.hero .cta a[href="./app.html"]');
    assert.equal(await cta.count(),1);
    assert.ok((await cta.boundingBox()).height>=44);
    await page.screenshot({path:`test-results/landing/${width}-${colorScheme}-story.png`});
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:`test-results/landing/${width}-${colorScheme}-top.png`});
    assert.deepEqual(errors,[]);
    await context.close();
    console.log(`PASS landing ${width}x844 ${colorScheme}`);
  }
} finally { await browser.close(); server.close(); }
