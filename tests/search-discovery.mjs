import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(file, "utf8");
const root = "https://gohan-tabeta.birdman-studio.com/";
const index = read("index.html");

assert.match(index, /<meta name="description" content="[^"]+"/);
assert.ok(index.includes(`<link rel="canonical" href="${root}">`));
assert.ok(index.includes(`<meta property="og:image" content="${root}images/og.jpg">`));
assert.ok(index.includes(`<meta name="twitter:image" content="${root}images/og.jpg">`));
assert.match(index, /<script type="application\/ld\+json">[\s\S]*"@type":"WebApplication"/);

for (const file of ["news.html", "privacy.html", "terms.html"]) {
  const html = read(file);
  assert.match(html, /<meta name="description" content="[^"]+"/, `${file}: description missing`);
  assert.ok(html.includes(`<link rel="canonical" href="${root}${file}">`), `${file}: canonical mismatch`);
  assert.match(html, /<meta property="og:title" content="[^"]+"/, `${file}: og:title missing`);
}

const app = read("app.html");
assert.ok(app.includes('<meta name="robots" content="noindex, nofollow, noarchive">'));
assert.ok(app.includes(`<link rel="canonical" href="${root}">`));

const robots = read("robots.txt");
assert.ok(robots.includes("Disallow: /tests/"));
assert.ok(robots.includes(`Sitemap: ${root}sitemap.xml`));

const sitemap = read("sitemap.xml");
const expected = [root, ...["news.html", "privacy.html", "terms.html"].map((file) => root + file)];
for (const url of expected) assert.ok(sitemap.includes(`<loc>${url}</loc>`), `${url}: sitemap entry missing`);
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert.deepEqual(sitemapUrls, expected);
assert.ok(sitemapUrls.every((url) => !url.includes("?") && !url.includes("#")));

const manifest = JSON.parse(read("manifest.webmanifest"));
assert.deepEqual({ id: manifest.id, start_url: manifest.start_url, scope: manifest.scope }, {
  id: "/app.html", start_url: "./app.html", scope: "./",
});

console.log("search discovery contract passed");
