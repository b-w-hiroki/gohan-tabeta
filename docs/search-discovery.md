# 検索公開範囲と比較手順

## 公開範囲

- インデックス対象は紹介ページ `/`、`/news.html`、`/privacy.html`、`/terms.html`。
- 食事・写真・運動記録、ゲスト利用、ログインを扱う `/app.html` は `noindex, nofollow, noarchive` とし、サイトマップへ含めない。
- `#/import` を含むハッシュURL、クエリ、利用者データ、認証後画面はサイトマップへ含めない。
- `robots.txt` はアクセス制御ではない。食事記録や認証情報を公開ファイルへ置かない。

## 変更前観測

- 2026-10-19 12:29 UTC、公開トップはHTTP 200でdescription、canonical、OG、静的紹介を確認。
- 同時点で `/robots.txt` と `/sitemap.xml` はHTTP 404。
- ChatGPT、Gemini、Copilotへの反復質問、外部AI API送信は実施していない。

## 比較手順

```sh
curl -sS -D headers.txt -o index.html https://gohan-tabeta.birdman-studio.com/
curl -sS -D robots-headers.txt -o robots.txt https://gohan-tabeta.birdman-studio.com/robots.txt
curl -sS -D sitemap-headers.txt -o sitemap.xml https://gohan-tabeta.birdman-studio.com/sitemap.xml
npm test
```

HTTP status、最終URL、content-type、取得日時をUTCで記録し、title、description、canonical、OG/Twitter、JSON-LD、サイトマップ掲載URLを比較する。検索露出・順位・収益を保証する手順ではない。

表示証跡は [`qa/search-discovery/`](./qa/search-discovery/) に保存する。
