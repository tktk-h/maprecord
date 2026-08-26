// 記念日通知の「その日誰に送るか」のテスト。リポ直下で
//   node scripts/notify-send-test.mjs
// Firestore と Web Push は差し替えているので、実の送信は起きない。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { runDaily: _runDaily } = require(process.cwd() + '/functions/daily.js');

const DEL = '<<delete>>';
function fakeDb(spaces) {
  const updates = [];
  return {
    updates,
    collection: () => ({
      get: async () => ({
        size: spaces.length,
        docs: spaces.map((sp) => ({
          data: () => sp,
          ref: { update: async (patch) => updates.push({ id: sp.__id, patch }) },
        })),
      }),
    }),
  };
}
const sub = (n) => ({ endpoint: 'https://push/' + n, p256dh: 'p' + n, auth: 'a' + n });

let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + n, ok ? '' : 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); };

// --- 記念日当日：スペースの全端末に届く
{
  const db = fakeDb([{ __id: 's1', anniversary: '2024-08-12', push: { a: sub(1), b: sub(2) } }]);
  const outbox = [];
  const stats = await _runDaily(db, async (s, p) => { outbox.push({ to: s.endpoint, ...p }); return { ok: true, gone: false }; }, '2026-08-12', DEL);
  eq('anniv sent to both', stats.sent, 2);
  eq('anniv title', outbox[0].title, '今日で2年');
  eq('anniv tag', outbox[0].tag, 'anniv-anniversary-2026-08-12');
  eq('both endpoints', outbox.map(o => o.to), ['https://push/1', 'https://push/2']);
  eq('no cleanup', db.updates.length, 0);
}
// --- 当たらない日は1通も出ない
{
  const db = fakeDb([{ __id: 's1', anniversary: '2024-08-12', push: { a: sub(1) } }]);
  let calls = 0;
  const stats = await _runDaily(db, async () => { calls++; return { ok: true, gone: false }; }, '2026-05-05', DEL);
  eq('quiet day sends nothing', [stats.sent, calls], [0, 0]);
}
// --- カウントダウン
{
  const db = fakeDb([{ __id: 's1', anniversary: '2024-08-12', push: { a: sub(1) } }]);
  const outbox = [];
  await _runDaily(db, async (s, p) => { outbox.push(p); return { ok: true, gone: false }; }, '2026-08-09', DEL);
  eq('countdown title', outbox[0].title, 'あと3日で記念日');
  eq('countdown tag', outbox[0].tag, 'anniv-countdown-2026-08-09');
}
// --- 半年 / 1か月
{
  const db = fakeDb([{ __id: 's1', anniversary: '2026-03-31', push: { a: sub(1) } }]);
  const a = []; await _runDaily(db, async (s,p)=>{a.push(p.title); return {ok:true,gone:false};}, '2026-04-30', DEL);
  eq('1 month clamps to month end', a, ['今日で1か月']);
  const b = []; await _runDaily(db, async (s,p)=>{b.push(p.title); return {ok:true,gone:false};}, '2026-09-30', DEL);
  eq('half year', b, ['今日で半年']);
}
// --- 記念日なし／購読なしのスペースは飛ばす
{
  const db = fakeDb([
    { __id: 'none', push: { a: sub(1) } },
    { __id: 'nosub', anniversary: '2024-08-12' },
    { __id: 'ok', anniversary: '2024-08-12', push: { a: sub(9) } },
  ]);
  const outbox = [];
  const stats = await _runDaily(db, async (s) => { outbox.push(s.endpoint); return { ok: true, gone: false }; }, '2026-08-12', DEL);
  eq('skips spaces without anniversary or subs', outbox, ['https://push/9']);
  eq('counts all spaces', stats.spaces, 3);
}
// --- 消えた購読は掃除する。生きているほうは残す
{
  const db = fakeDb([{ __id: 's1', anniversary: '2024-08-12', push: { dead: sub(1), live: sub(2) } }]);
  const stats = await _runDaily(db, async (s) => (
    s.endpoint === 'https://push/1' ? { ok: false, gone: true } : { ok: true, gone: false }
  ), '2026-08-12', DEL);
  eq('one sent one dropped', [stats.sent, stats.dropped], [1, 1]);
  eq('cleanup patch', db.updates, [{ id: 's1', patch: { 'push.dead': DEL } }]);
}
// --- 一時的な失敗は掃除しない（次の年も送りたい）
{
  const db = fakeDb([{ __id: 's1', anniversary: '2024-08-12', push: { a: sub(1) } }]);
  const stats = await _runDaily(db, async () => ({ ok: false, gone: false }), '2026-08-12', DEL);
  eq('temporary failure kept', [stats.failed, stats.dropped, db.updates.length], [1, 0, 0]);
}
// --- 壊れた購読は無視して落ちない
{
  const db = fakeDb([{ __id: 's1', anniversary: '2024-08-12', push: { bad: { endpoint: 'https://x' }, good: sub(3) } }]);
  const outbox = [];
  const stats = await _runDaily(db, async (s) => { outbox.push(s.endpoint); return { ok: true, gone: false }; }, '2026-08-12', DEL);
  eq('skips malformed sub', outbox, ['https://push/3']);
  eq('sent one', stats.sent, 1);
}
console.log('\n' + (fail === 0 ? '✅ ALL PASS (' + pass + ')' : '❌ ' + fail + ' FAILED / ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
