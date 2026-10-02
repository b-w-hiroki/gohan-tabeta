// ごはん食べた？ — お知らせデータ
// 新しいお知らせは、この配列の先頭に追加します。
// 本文は sections の paragraphs に文字列で、関連リンクは links に追加します。
window.NEWS_ITEMS = [
  {
    id: '2026-10-02-introduction',
    date: '2026-10-02',
    category: 'info',
    categoryLabel: 'アプリ紹介',
    title: '「ごはん食べた？」のご紹介',
    summary: '食事・栄養・運動・からだの記録を、カレンダーで振り返れる食事管理アプリです。',
    sections: [
      {
        heading: 'できること',
        paragraphs: [
          '朝食・昼食・夕食・間食を、カロリーや写真、メモと一緒に記録できます。PFCバランスや月ごとの食事をダッシュボードとカレンダーで確認できます。',
          '運動、体重、水分、目標の記録や、よく食べるメニューの登録、過去の食事のコピーにも対応しています。',
        ],
      },
      {
        heading: 'データの保存について',
        paragraphs: [
          'ログインせずに使う場合、データはこの端末のブラウザに保存されます。JSONバックアップを利用すると、データの保存や引き継ぎができます。',
          'ログインすると、対応しているデータをクラウドと同期できます。アプリはPWAとしてインストールでき、オフラインでも利用できます。',
        ],
      },
    ],
  },
];

window.NEWS_APP = {
  name: 'ごはん食べた？',
  icon: '🍚',
  appHref: './app.html',
  appLabel: 'ごはん食べた？に戻る',
  readStorageKey: 'gohan-tabeta-news-read-ids',
};
