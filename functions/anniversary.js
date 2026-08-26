// 記念日まわりの日付の計算。ここは純粋関数だけにしてある（Firebase も通信も触らない）。
// 通知を出すかどうかの判断は全部ここに集約し、index.js は「その日のぶんを送る」だけにする。
//
// 日付は 'YYYY-MM-DD' の文字列で受け渡す。Date を跨ぐ計算は必ず UTC で行い、
// サーバのタイムゾーン（Cloud Functions は UTC）に結果が左右されないようにする。
// 「今日」が何日かだけは呼ぶ側が Asia/Tokyo で決める（todayInTokyo）。

function two(n) { return (n < 10 ? '0' : '') + n; }
function ymd(y, m, d) { return y + '-' + two(m) + '-' + two(d); }

function parse(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

// その年月の末日（m は 1〜12）
function lastDayOfMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

// n か月後。無い日付は月末に丸める（1/31 の1か月後 = 2/28）。
function addMonths(s, n) {
  const p = parse(s);
  if (!p) return null;
  const total = (p.y * 12) + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return ymd(y, m, Math.min(p.d, lastDayOfMonth(y, m)));
}

// その年の記念日。2/29 生まれは平年は 2/28 に寄せる（3/1 にすると月をまたいで気持ち悪い）。
function annivInYear(anniv, year) {
  const p = parse(anniv);
  if (!p) return null;
  return ymd(year, p.m, Math.min(p.d, lastDayOfMonth(year, p.m)));
}

function toUtcMs(s) {
  const p = parse(s);
  return p ? Date.UTC(p.y, p.m - 1, p.d) : NaN;
}

// from から to までの日数（to のほうが後なら正）
function diffDays(from, to) {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86400000);
}

const COUNTDOWN_FROM = 3; // 年の記念日は3日前から数える

// anniv='YYYY-MM-DD'（付き合いはじめた日）, today='YYYY-MM-DD'
// → その日に送る通知の配列 [{ type, title, body }]。無ければ空配列。
// 同じ日に複数該当することはありうる（例：半年と記念日は重ならないが、将来増やすときのため配列）。
function eventsFor(anniv, today) {
  const out = [];
  const a = parse(anniv);
  const t = parse(today);
  if (!a || !t) return out;
  if (today < anniv) return out; // まだ始まっていない日は何も出さない

  if (today === addMonths(anniv, 1)) {
    out.push({ type: 'month1', title: '今日で1か月', body: 'ふたりのあしあと、1か月ぶん' });
  }
  if (today === addMonths(anniv, 6)) {
    out.push({ type: 'half', title: '今日で半年', body: '半年ぶんのあしあとがたまりました' });
  }

  // 年の記念日：当日は「今日で◯年」、その手前3日はカウントダウン
  const thisYear = annivInYear(anniv, t.y);
  const target = today <= thisYear ? thisYear : annivInYear(anniv, t.y + 1);
  const years = parse(target).y - a.y;
  if (years >= 1) {
    if (today === target) {
      out.push({ type: 'anniversary', years, title: '今日で' + years + '年', body: '記念日おめでとう' });
    } else {
      const left = diffDays(today, target);
      if (left >= 1 && left <= COUNTDOWN_FROM) {
        out.push({
          type: 'countdown', years, left,
          title: 'あと' + left + '日で記念日',
          body: years + '年目まで、あと' + left + '日',
        });
      }
    }
  }
  return out;
}

// Asia/Tokyo での「今日」。サーバは UTC なので、そのまま toISOString すると
// 日本の朝9時＝UTC 前日0時で、日付が1日ずれる。
function todayInTokyo(now) {
  const d = now || new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

module.exports = {
  eventsFor, addMonths, annivInYear, diffDays, lastDayOfMonth, isLeap, todayInTokyo, COUNTDOWN_FROM,
};
