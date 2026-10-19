const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(1, 4).toString("ascii") === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  throw new Error("unsupported share image format");
}

function auditStaticSearch({
  baseUrl,
  sitemapFile = "sitemap.xml",
  publicRoot = ".",
  shareImageRequired = true,
  shareWidth = 1200,
  shareHeight = 630,
  measurementScript = "scripts/measure-search-discovery.mjs",
}) {
  assert.ok(existsSync(measurementScript), `measurement script missing: ${measurementScript}`);
  const syntax = spawnSync(process.execPath, ["--check", measurementScript], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr || `${measurementScript}: syntax check failed`);

  const base = new URL(baseUrl);
  const sitemap = readFileSync(sitemapFile, "utf8");
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(urls.length > 0, "sitemap must contain at least one URL");
  assert.equal(new Set(urls).size, urls.length, "sitemap URLs must be unique");

  const urlToFile = (value) => {
    const url = new URL(value);
    let relative = decodeURIComponent(url.pathname).replace(/^\//, "");
    if (!relative || relative.endsWith("/")) relative += "index.html";
    return join(publicRoot, relative);
  };

  for (const pageUrl of urls) {
    const file = urlToFile(pageUrl);
    assert.ok(existsSync(file), `${pageUrl}: sitemap target missing (${file})`);
    if (!file.toLowerCase().endsWith(".html")) continue;
    const html = readFileSync(file, "utf8");
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1]
      ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1];
    assert.equal(canonical, pageUrl, `${file}: canonical must equal sitemap URL`);

    for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
      const raw = match[1];
      if (raw.includes("${") || /^(?:data:|mailto:|tel:|javascript:)/i.test(raw) || raw.startsWith("#")) continue;
      const targetUrl = new URL(raw, pageUrl);
      if (targetUrl.origin !== base.origin || targetUrl.pathname.startsWith("/__/")) continue;
      const target = urlToFile(targetUrl);
      assert.ok(existsSync(target), `${file}: broken local reference ${raw} -> ${target}`);
    }
  }

  const rootHtml = readFileSync(urlToFile(baseUrl), "utf8");
  const shareImageUrl = rootHtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1]
    ?? rootHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
  if (shareImageRequired) assert.ok(shareImageUrl, "root page must declare og:image");
  if (shareImageUrl) {
    const shareUrl = new URL(shareImageUrl, base);
    assert.equal(shareUrl.origin, base.origin, "og:image must use the canonical site origin");
    const imageFile = urlToFile(shareUrl);
    assert.ok(existsSync(imageFile), `og:image target missing: ${imageFile}`);
    const dimensions = imageDimensions(readFileSync(imageFile));
    assert.deepEqual(dimensions, { width: shareWidth, height: shareHeight }, "og:image dimensions");
    assert.ok(rootHtml.includes(`<meta property="og:image:width" content="${shareWidth}"`), "og:image:width mismatch");
    assert.ok(rootHtml.includes(`<meta property="og:image:height" content="${shareHeight}"`), "og:image:height mismatch");
  }
  return { urls: urls.length, shareImageUrl };
}

module.exports = { auditStaticSearch, imageDimensions };
