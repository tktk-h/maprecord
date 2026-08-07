// 各メンバーの「最終アクセス日時」を Firestore から読んで表示する開発用スクリプト。
// 使い方: プロジェクト直下に serviceAccountKey.json を置いて
//   node scripts/last-seen.mjs
// （鍵は .gitignore 済み。外部パッケージ不要＝Node標準のみ）
import fs from 'node:fs';
import crypto from 'node:crypto';

const keyPath = process.argv[2] || './serviceAccountKey.json';
const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
const projectId = key.project_id;

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  };
  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
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

const fmt = (ms) => (ms ? new Date(Number(ms)).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '(不明)');

const token = await getToken();
const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/spaces`;
const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
const data = await res.json();
if (data.error) throw new Error(JSON.stringify(data.error));
const docs = data.documents || [];
if (!docs.length) { console.log('スペースが見つかりません'); process.exit(0); }
for (const d of docs) {
  const fields = d.fields || {};
  const spaceName = d.name.split('/').pop();
  const lastSeen = val(fields.lastSeen) || {};
  console.log('=== スペース ' + spaceName + ' ===');
  const uids = Object.keys(lastSeen);
  if (!uids.length) { console.log('  (最終アクセスの記録はまだありません)'); continue; }
  uids.sort((a, b) => (lastSeen[b].at || 0) - (lastSeen[a].at || 0));
  for (const uid of uids) {
    const e = lastSeen[uid] || {};
    console.log('  ' + (e.name || uid) + ' : ' + fmt(e.at));
  }
}
