(function () {
  'use strict';

  const CATEGORY_LABELS = { info: 'お知らせ', new: '新機能', improve: '改善', fix: '不具合修正' };
  const app = window.NEWS_APP || { name: 'アプリ', icon: '📣', appHref: './', appLabel: 'アプリに戻る' };
  const readStorageKey = app.readStorageKey || `news-read-ids:${app.name}`;

  function readIds() {
    try {
      const value = JSON.parse(localStorage.getItem(readStorageKey) || '[]');
      return new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  }

  function markRead(id) {
    const ids = readIds();
    ids.add(id);
    try { localStorage.setItem(readStorageKey, JSON.stringify([...ids])); } catch { /* storage may be unavailable */ }
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    });
    const list = Array.isArray(children) ? children : [children];
    list.filter(Boolean).forEach((child) => node.append(child));
    return node;
  }

  function validItems() {
    return (Array.isArray(window.NEWS_ITEMS) ? window.NEWS_ITEMS : [])
      .filter((item) => item && item.id && item.date && item.title)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function dateLabel(value) {
    const parts = String(value).split('-').map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return String(value);
    return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
      .format(new Date(parts[0], parts[1] - 1, parts[2]));
  }

  function category(item) {
    const key = Object.hasOwn(CATEGORY_LABELS, item.category) ? item.category : 'info';
    return el('span', { class: `news-category news-category-${key}`, text: item.categoryLabel || CATEGORY_LABELS[key] });
  }

  function safeLink(link) {
    if (!link || !link.label || !link.href) return null;
    let url;
    try { url = new URL(link.href, location.href); } catch { return null; }
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const external = url.origin !== location.origin;
    const attrs = { href: url.href, text: link.label };
    if (external) { attrs.target = '_blank'; attrs.rel = 'noopener noreferrer'; }
    return el('a', attrs);
  }

  function renderList(root, items) {
    const read = readIds();
    document.title = `お知らせ — ${app.name}`;
    root.append(
      el('a', { class: 'news-brand', href: app.appHref, text: `${app.icon} ${app.name}` }),
      el('header', { class: 'news-header' }, [
        el('h1', { text: 'お知らせ' }),
        el('p', { text: `${app.name}からの大切なお知らせや更新情報を掲載します。` }),
        el('p', { class: 'news-storage-note', text: '既読状態は、この端末のブラウザだけに保存されます。' }),
      ]),
    );
    if (!items.length) {
      root.append(el('section', { class: 'news-empty', role: 'status', 'aria-live': 'polite' }, [
        el('span', { class: 'news-empty-icon', 'aria-hidden': 'true', text: '📭' }),
        el('h2', { text: '現在お知らせはありません' }),
        el('p', { text: '新しいお知らせがあると、このページに表示されます。' }),
      ]));
      return;
    }
    const list = el('div', { class: 'news-list', 'aria-label': 'お知らせ一覧' });
    items.forEach((item) => {
      const meta = el('div', { class: 'news-meta' }, [
        el('time', { datetime: item.date, text: dateLabel(item.date) }),
        category(item),
        read.has(item.id) ? null : el('span', { class: 'news-unread', text: '未読' }),
      ]);
      list.append(el('a', { class: 'news-card', href: `?id=${encodeURIComponent(item.id)}` }, [
        el('div', {}, [meta, el('h2', { text: item.title }), item.summary ? el('p', { text: item.summary }) : null]),
        el('span', { class: 'news-arrow', 'aria-hidden': 'true', text: '›' }),
      ]));
    });
    root.append(list);
  }

  function renderArticle(root, item) {
    if (!item) {
      document.title = `お知らせが見つかりません — ${app.name}`;
      root.append(
        el('a', { class: 'news-back-link', href: './news.html', text: '← お知らせ一覧へ' }),
        el('section', { class: 'news-not-found', role: 'alert' }, [
          el('h1', { text: 'お知らせが見つかりません' }),
          el('p', { text: 'URLをご確認のうえ、お知らせ一覧から開き直してください。' }),
        ]),
      );
      return;
    }
    markRead(item.id);
    document.title = `${item.title} — ${app.name}`;
    const article = el('article', { class: 'news-article' });
    article.append(
      el('div', { class: 'news-meta' }, [el('time', { datetime: item.date, text: dateLabel(item.date) }), category(item)]),
      el('h1', { text: item.title }),
    );
    if (item.summary) article.append(el('p', { class: 'news-summary', text: item.summary }));
    (Array.isArray(item.sections) ? item.sections : []).forEach((section) => {
      const block = el('section', { class: 'news-section' });
      if (section.heading) block.append(el('h2', { text: section.heading }));
      (Array.isArray(section.paragraphs) ? section.paragraphs : []).forEach((paragraph) => block.append(el('p', { text: paragraph })));
      const links = (Array.isArray(section.links) ? section.links : []).map(safeLink).filter(Boolean);
      if (links.length) block.append(el('ul', { class: 'news-links' }, links.map((link) => el('li', {}, link))));
      article.append(block);
    });
    root.append(el('a', { class: 'news-back-link', href: './news.html', text: '← お知らせ一覧へ' }), article);
  }

  function render() {
    const root = document.getElementById('newsRoot');
    if (!root) return;
    root.replaceChildren();
    const items = validItems();
    const id = new URLSearchParams(location.search).get('id');
    if (id) renderArticle(root, items.find((item) => item.id === id));
    else renderList(root, items);
    const back = document.getElementById('newsBottomBack');
    if (back) {
      back.href = id ? './news.html' : app.appHref;
      back.textContent = id ? '← お知らせ一覧へ' : `← ${app.appLabel}`;
    }
  }

  window.renderNewsPage = render;
  render();
}());
