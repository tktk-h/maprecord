// 記念日通知の日付計算のテスト。リポ直下で
//   node scripts/anniversary-test.mjs
// 外部パッケージ不要（Node標準のみ）。閉年・月末・年またぎのあたりが壊れやすいので、
// functions/anniversary.js を触ったらこれを通すこと。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require(process.cwd()+'/functions/anniversary.js');

let pass=0, fail=0;
const eq=(n,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);ok?pass++:fail++;
  console.log((ok?'PASS ':'FAIL ')+n, ok?'':'got='+JSON.stringify(got)+' want='+JSON.stringify(want));};
const types=(a,t)=>A.eventsFor(a,t).map(e=>e.type);
const one=(a,t)=>A.eventsFor(a,t)[0];

// --- 月の足し算（末日の丸め）
eq('addMonths normal',   A.addMonths('2026-03-15',1), '2026-04-15');
eq('addMonths 1/31+1',   A.addMonths('2026-01-31',1), '2026-02-28');
eq('addMonths 1/31+1 leap', A.addMonths('2024-01-31',1), '2024-02-29');
eq('addMonths 8/31+6',   A.addMonths('2026-08-31',6), '2027-02-28');
eq('addMonths year wrap',A.addMonths('2026-11-20',6), '2027-05-20');
eq('addMonths 12->1',    A.addMonths('2026-12-05',1), '2027-01-05');

// --- 閏日
eq('leap 2024', A.isLeap(2024), true);
eq('leap 2100', A.isLeap(2100), false);
eq('leap 2000', A.isLeap(2000), true);
eq('anniv 2/29 in leap',    A.annivInYear('2024-02-29',2028), '2028-02-29');
eq('anniv 2/29 in nonleap', A.annivInYear('2024-02-29',2026), '2026-02-28');

// --- 日数差
eq('diffDays same', A.diffDays('2026-08-26','2026-08-26'), 0);
eq('diffDays 3',    A.diffDays('2026-08-23','2026-08-26'), 3);
eq('diffDays month wrap', A.diffDays('2026-08-30','2026-09-02'), 3);
eq('diffDays year wrap',  A.diffDays('2026-12-30','2027-01-02'), 3);

// --- 記念日 2024-08-12 の一年
const A0='2024-08-12';
eq('start day: nothing',  types(A0,'2024-08-12'), []);
eq('1 month',             types(A0,'2024-09-12'), ['month1']);
eq('1 month text',        one(A0,'2024-09-12').title, '今日で1か月');
eq('half year',           types(A0,'2025-02-12'), ['half']);
eq('half year text',      one(A0,'2025-02-12').title, '今日で半年');
eq('ordinary day',        types(A0,'2025-03-03'), []);
eq('3 days before',       types(A0,'2025-08-09'), ['countdown']);
eq('3 days before text',  one(A0,'2025-08-09').title, 'あと3日で記念日');
eq('2 days before',       one(A0,'2025-08-10').title, 'あと2日で記念日');
eq('1 day before',        one(A0,'2025-08-11').title, 'あと1日で記念日');
eq('4 days before: none', types(A0,'2025-08-08'), []);
eq('the day',             types(A0,'2025-08-12'), ['anniversary']);
eq('the day text',        one(A0,'2025-08-12').title, '今日で1年');
eq('day after: none',     types(A0,'2025-08-13'), []);
eq('2nd year',            one(A0,'2026-08-12').title, '今日で2年');
eq('2nd year countdown',  one(A0,'2026-08-10').body, '2年目まで、あと2日');

// --- 1年目の前に半年やひと月の予告は出ない（years=0 の年は記念日扱いしない）
eq('no anniversary in year 0', types(A0,'2024-12-31'), []);

// --- 年をまたぐカウントダウン（記念日が1/2）
const A1='2023-01-02';
eq('countdown across new year', one(A1,'2025-12-30').title, 'あと3日で記念日');
eq('countdown across new year years', one(A1,'2025-12-30').body, '3年目まで、あと3日');
eq('the day jan2', one(A1,'2026-01-02').title, '今日で3年');

// --- 閏日生まれ
const A2='2024-02-29';
eq('leap-born 1 month', types(A2,'2024-03-29'), ['month1']);
eq('leap-born half',    types(A2,'2024-08-29'), ['half']);
eq('leap-born 1yr nonleap', one(A2,'2025-02-28').title, '今日で1年');
eq('leap-born countdown nonleap', one(A2,'2025-02-25').title, 'あと3日で記念日');
eq('leap-born 4yr leap', one(A2,'2028-02-29').title, '今日で4年');

// --- 記念日が未設定・壊れている
eq('null anniv', A.eventsFor(null,'2026-08-26'), []);
eq('bad anniv',  A.eventsFor('2026/08/26','2026-08-26'), []);
eq('bad today',  A.eventsFor('2024-08-12','yesterday'), []);
eq('before start', A.eventsFor('2026-08-12','2026-08-11'), []);

// --- 東京の「今日」（UTCと日付がずれる時刻で確かめる）
eq('tokyo date at 00:30 JST', A.todayInTokyo(new Date('2026-08-25T15:30:00Z')), '2026-08-26');
eq('tokyo date at 09:00 JST', A.todayInTokyo(new Date('2026-08-26T00:00:00Z')), '2026-08-26');
eq('tokyo date just before midnight', A.todayInTokyo(new Date('2026-08-26T14:59:00Z')), '2026-08-26');

// --- 1年ぶん回して「通知が出る日」を数える（出しすぎていないか）
let days=0, fired=0;
for (let d=new Date(Date.UTC(2026,0,1)); d<Date.UTC(2027,0,1); d=new Date(d.getTime()+86400000)) {
  days++;
  if (A.eventsFor(A0, d.toISOString().slice(0,10)).length) fired++;
}
eq('days in 2026', days, 365);
eq('notifications in 2026', fired, 4); // 記念日1回 + 3日前から3回

console.log('\n' + (fail===0 ? '✅ ALL PASS ('+pass+')' : '❌ '+fail+' FAILED / '+pass+' passed'));
process.exit(fail?1:0);
