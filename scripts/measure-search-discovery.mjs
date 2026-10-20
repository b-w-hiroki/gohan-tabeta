const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/measure-search-discovery.mjs https://example.com/");
  process.exit(2);
}

const base = new URL(target.endsWith("/") ? target : target + "/");
const endpoints = ["/", "/robots.txt", "/sitemap.xml"];
const result = {
  measuredAt: new Date().toISOString(),
  baseUrl: base.href,
  endpoints: [],
};

const pick = (text, pattern) => text.match(pattern)?.[1] ?? null;
for (const endpoint of endpoints) {
  const requestedUrl = new URL(endpoint.replace(/^\//, ""), base).href;
  try {
    const response = await fetch(requestedUrl, {
      redirect: "follow",
      headers: { "user-agent": "birdman-search-discovery-check/1.0" },
    });
    const text = await response.text();
    const contentType = response.headers.get("content-type");
    const record = {
      endpoint,
      requestedUrl,
      finalUrl: response.url,
      status: response.status,
      contentType,
      bytes: Buffer.byteLength(text),
    };
    if (endpoint === "/") {
      record.title = pick(text, /<title>([^<]*)<\/title>/i);
      record.description = pick(text, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i);
      record.canonical = pick(text, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)/i);
      record.ogImage = pick(text, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)/i);
    }
    if (endpoint === "/sitemap.xml") {
      record.locCount = [...text.matchAll(/<loc>[^<]+<\/loc>/g)].length;
    }
    result.endpoints.push(record);
  } catch (error) {
    result.endpoints.push({ endpoint, requestedUrl, error: String(error) });
  }
}

result.allHttpOk = result.endpoints.every((entry) => entry.status >= 200 && entry.status < 300);
console.log(JSON.stringify(result, null, 2));
