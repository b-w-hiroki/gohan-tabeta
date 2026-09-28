// Rough calorie presets (kcal per typical serving) for quick entry.
// p/f/c = protein / fat / carbohydrate in grams (Japanese food composition table, approximate).
export const FOOD_PRESETS = [
  { name: 'ごはん(茶碗1杯)', kcal: 234, p: 3.8, f: 0.5, c: 55.7 },
  { name: 'ごはん(大盛り)', kcal: 351, p: 5.7, f: 0.8, c: 83.5 },
  { name: '食パン(6枚切1枚)', kcal: 149, p: 5.3, f: 2.5, c: 26.6 },
  { name: 'おにぎり(鮭)', kcal: 180, p: 5, f: 1, c: 38 },
  { name: 'みそ汁', kcal: 40, p: 3, f: 1.2, c: 4 },
  { name: '卵焼き', kcal: 90, p: 6, f: 6, c: 3 },
  { name: 'ゆで卵', kcal: 76, p: 6.2, f: 5.2, c: 0.2 },
  { name: '納豆(1パック)', kcal: 90, p: 7.4, f: 4.5, c: 5.4 },
  { name: 'ヨーグルト', kcal: 60, p: 3.6, f: 3, c: 4.9 },
  { name: 'バナナ', kcal: 86, p: 1.1, f: 0.2, c: 22.5 },
  { name: 'サラダ', kcal: 30, p: 1, f: 0.2, c: 6 },
  { name: '焼き魚(鮭)', kcal: 130, p: 18, f: 5, c: 0.1 },
  { name: '唐揚げ(3個)', kcal: 250, p: 16, f: 15, c: 10 },
  { name: '生姜焼き', kcal: 330, p: 18, f: 22, c: 10 },
  { name: 'カレーライス', kcal: 750, p: 18, f: 25, c: 110 },
  { name: 'ラーメン', kcal: 500, p: 20, f: 15, c: 70 },
  { name: 'うどん(かけ)', kcal: 320, p: 9, f: 2, c: 65 },
  { name: 'そば(ざる)', kcal: 300, p: 12, f: 2, c: 57 },
  { name: 'パスタ(ミート)', kcal: 650, p: 23, f: 20, c: 90 },
  { name: '牛丼(並)', kcal: 650, p: 20, f: 22, c: 90 },
  { name: 'サンドイッチ', kcal: 300, p: 12, f: 14, c: 30 },
  { name: 'コーヒー(ブラック)', kcal: 5, p: 0.3, f: 0, c: 0.8 },
  { name: 'カフェラテ', kcal: 120, p: 6, f: 6, c: 10 },
  { name: 'ビール(350ml)', kcal: 140, p: 1, f: 0, c: 11 },
];

// Exercise presets with METs values (approximate, from the Compendium of Physical Activities).
export const EXERCISE_PRESETS = [
  { name: 'ウォーキング', mets: 3.5 },
  { name: '早歩き', mets: 4.3 },
  { name: 'ジョギング', mets: 7.0 },
  { name: 'ランニング', mets: 9.8 },
  { name: 'サイクリング', mets: 6.8 },
  { name: '水泳', mets: 8.0 },
  { name: '筋トレ', mets: 5.0 },
  { name: 'ヨガ', mets: 2.5 },
  { name: 'ストレッチ', mets: 2.3 },
  { name: '階段昇降', mets: 8.0 },
  { name: 'テニス', mets: 7.3 },
  { name: 'ダンス', mets: 5.0 },
];
