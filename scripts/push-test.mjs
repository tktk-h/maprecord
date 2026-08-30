// 記念日通知を「その日が来たことにして」試すスクリプト。
//
// 毎朝9時の dailyAnniversary は年に数回しか発火しないので、鍵や Service Worker が
// 壊れていても本番の朝まで気づけない。ここでは日付だけ差し替えて同じ判定を通し、
// 実際に端末へ1通投げてみる。Firestore は読むだけで、記念日も購読も書き換えない。
//
// 使い方（プロジェクト直下に serviceAccountKey.json を置いて）:
//   node scripts/push-test.mjs 2026-09-06            # 何が送られるか見るだけ
//   node scripts/push-test.mjs 2026-09-06 --send     # 実際に送る（下記の環境変数が要る）
//
// 実送信するときは Secret Manager の鍵をその場で渡す（画面には出さない）:
//   VAPID_PUBLIC=$(npx firebase functions:secrets:access VAPID_PUBLIC) \
//   VAPID_PRIVATE=$(npx firebase functions:secrets:access VAPID_PRIVATE) \
//   node scripts/push-test.mjs 2026-09-06 --send
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { eventsFor } = require('../functions/anniversary.js'); // 判定は本番と同じものを使う

const args = process.argv.slice(2);
const send = args.includes('--send');
const today = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
  || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

const key = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
const projectId = key.project_id;

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  };
  const unsigned = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify(claim));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const jwt = unsigned + '.' + b64url(signer.sign(key.private_key));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('token error: ' + JSON.stringify(j));
  return j.access_token;
}

function val(v) {
  if (!v) return undefined;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) {
    const o = {}; const f = v.mapValue.fields || {};
    for (const k in f) o[k] = val(f[k]);
    return o;
  }
  return undefined;
}

let webpush = null;
if (send) {
  const pub = process.env.VAPID_PUBLIC;
  const priv = process.env.VAPID_PRIVATE;
  if (!pub || !priv) {
    console.error('VAPID_PUBLIC と VAPID_PRIVATE が要ります（このファイル冒頭の使い方を参照）');
    process.exit(1);
  }
  webpush = require('../functions/node_modules/web-push');
  webpush.setVapidDetails('mailto:0525toki0525@gmail.com', pub, priv);
}

const token = await getToken();
const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/spaces`;
const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
const data = await res.json();
if (data.error) throw new Error(JSON.stringify(data.error));

console.log(`「今日」を ${today} として判定します${send ? '（実際に送ります）' : '（送信はしません）'}\n`);

for (const doc of data.documents || []) {
  const f = doc.fields || {};
  const spaceId = doc.name.split('/').pop();
  const anniv = val(f.anniversary);
  const subs = val(f.push) || {};
  const ids = Object.keys(subs);
  const events = eventsFor(anniv, today);

  console.log(`=== スペース ${spaceId} ===`);
  console.log(`  記念日: ${anniv || '(未設定)'} / 購読: ${ids.length}件`);
  if (!events.length) { console.log('  この日に送るものはありません\n'); continue; }
  for (const ev of events) console.log(`  → 「${ev.title}」 ${ev.body}`);
  if (!ids.length) { console.log('  ただし購読が無いので届きません\n'); continue; }

  if (!send) { console.log('  （--send を付けると実際に投げます）\n'); continue; }
  for (const ev of events) {
    for (const id of ids) {
      const s = subs[id];
      if (!s || !s.endpoint || !s.p256dh || !s.auth) { console.log(`  [${id}] 形が壊れています`); continue; }
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: ev.title, body: ev.body, tag: 'anniv-test-' + today }),
        );
        console.log(`  [${id}] 送信OK`);
      } catch (e) {
        const code = e && e.statusCode;
        console.log(`  [${id}] 失敗 ${code || ''} ${String((e && e.message) || e).slice(0, 200)}`);
        if (code === 404 || code === 410) console.log('        （端末側で購読が消えています。アプリで通知をオンにし直してください）');
      }
    }
  }
  console.log('');
}
