const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_KEY = defineSecret('GEMINI_KEY');

// 無料枠は「モデルごと」に別勘定。gemini-3.6-flash は1日20回しかなく、
// カード1枚=1回なので一括追加ではすぐ底をつく（2026-09-03に実測）。
// そこで枠切れ(429)なら次のモデルへ回す＝使える枠を足し合わせる。
// どのモデルが答えたかは返り値の model に入るので、枠の残りは推測せず実測で分かる。
// 並びは「枠が大きそうな軽いモデル」→「賢いモデル」。精度が要るなら順序を入れ替える。
// gemini-2.5-flash-lite は外した。ドキュメントには Stable と載っているが、実際に叩くと
// 404「新規ユーザーには提供終了。gemini-3.5-flash-lite を使え」が返る。ドキュメントより API。
const MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
];

// 写真（複数可）＋住所＋近くの店ヒントから、撮影された「お店の正式名称」を自由回答で推測する。
// 返り値は { name: string|null }。フロント側で searchText により実在の placeId/座標に裏取りする。
exports.suggestPlace = onCall(
  { secrets: [GEMINI_KEY], region: 'us-central1', timeoutSeconds: 60, memory: '512MiB' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'login required');
    const data = req.data || {};
    // 新形式(imagesBase64:配列) と 旧形式(imageBase64:単体) の両対応
    const images = Array.isArray(data.imagesBase64)
      ? data.imagesBase64
      : (data.imageBase64 ? [data.imageBase64] : []);
    const address = (data.address || '').toString().slice(0, 200);
    const hints = Array.isArray(data.candidates)
      ? data.candidates.map((c) => c && c.name).filter(Boolean).slice(0, 20)
      : [];
    if (!images.length) return { name: null };

    const genAI = new GoogleGenerativeAI(GEMINI_KEY.value());
    const parts = images
      .slice(0, 3)
      .map((b) => ({ inlineData: { mimeType: 'image/jpeg', data: b } }));
    const hintText = hints.length
      ? '\nこの付近にある店（参考。ここに無い店を答えてもよい）:\n- ' + hints.join('\n- ')
      : '';
    const prompt =
      'これらの写真は、住所「' + (address || '（不明）') + '」付近にある一つのお店/施設で撮影されました。'
      + '写真に写っているもの（料理・ドリンク・食器・内装・外観・看板・ロゴなど）と、'
      + 'この住所周辺にある店についてのあなたの知識をもとに、'
      + '撮影された可能性が最も高い「お店/施設の正式名称」を1つ推測してください。'
      + hintText
      + '\n\n確信が持てなくても構いません。断定できなくても、最も可能性が高いと思う店名を1行だけで答えてください。'
      + 'チェーン店なら支店名まで（例：スターバックス 京都三条店）。'
      + '本当に全く見当もつかない場合のみ UNKNOWN と書く。店名以外の説明・記号・引用符は書かない。';

    let text = '';
    let used = '';       // 実際に答えたモデル
    let tries = 0;       // Geminiを撃った総回数
    const skipped = [];  // 見送ったモデルと、その理由
    let lastErr = null;
    outer:
    for (const name of MODELS) {
      const model = genAI.getGenerativeModel({ model: name });
      for (let attempt = 0; ; attempt++) {
        try {
          tries++;
          const result = await model.generateContent([...parts, prompt]);
          text = (result.response.text() || '').trim();
          used = name;
          break outer;
        } catch (e) {
          lastErr = e;
          // HTTPステータスはSDKが e.status に持っている。エラー文から数字を探さない。
          // 429の本文には quotaValue や retryDelay が入るので、/500|503/ で拾うと
          // 枠切れを「混雑」と読み違えて、無駄撃ちしながら待たせることになる。
          const status = e && e.status;
          // 「このモデルが今は使えない」だけの話は、どれも次のモデルへ回す。
          // 枠切れ(429)も、提供終了・権限なし(404/403)も、こちらから見れば同じ。
          // ここを429だけにしていたら、先頭が404だった瞬間に全部あきらめた。
          if (status === 429) { skipped.push(name + ':枠切れ'); break; }
          if (status === 404 || status === 403) { skipped.push(name + ':使えない'); break; }
          if (status === 500 || status === 503) {   // 一時混雑は同じモデルで粘る
            if (attempt < 2) { await new Promise((r) => setTimeout(r, 900 * (attempt + 1))); continue; }
            skipped.push(name + ':混雑');
            break;                                   // 粘ってもだめなら次のモデルへ
          }
          break outer; // 400 など、モデルを変えても直らない種類だけ、ここで終わる
        }
      }
    }
    if (!used) {
      // 1500字まで残す。300字だと定型文で埋まり、どの枠に当たったかを書いた
      // details（quotaId/quotaValue/retryDelay）が丸ごと切れて診断できなかった。
      const err = String((lastErr && lastErr.message) || lastErr).slice(0, 1500);
      const status = (lastErr && lastErr.status) || '';
      console.error('gemini error', status, 'tries=' + tries, 'skipped=' + skipped.join(','), err);
      // 失敗は「不明」に落とす（保存は止めない）
      return { name: null, raw: '', err, status, tries, skipped, models: MODELS, imgs: parts.length };
    }
    const raw = text.slice(0, 200); // 診断：Geminiの生返答（先頭200字）
    // 1行目だけ採用し、前後の引用符を除去。UNKNOWN/空は null。
    const line = (text.split('\n')[0] || '').trim().replace(/^["'「『]+|["'」』]+$/g, '').trim();
    // model/skipped も返す＝どれが答え、どれをなぜ見送ったかが実測で分かる
    const meta = { raw, err: '', model: used, skipped, tries, imgs: parts.length };
    if (!line || /^unknown$/i.test(line)) return { name: null, ...meta };
    return { name: line, ...meta };
  }
);

// ===== 記念日の通知 =====
// 毎朝9時(日本時間)に全スペースを見て、その日に当たる記念日だけ Web Push で送る。
// 送り先は spaces/{id}.push（購読情報のマップ）。Firestore のルールは spaces ドキュメントの
// update しか許していないので、サブコレクションではなくこの中に持たせている（lastSeen と同じ形）。
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const webpush = require('web-push');
const { todayInTokyo } = require('./anniversary');
const { runDaily } = require('./daily');

const VAPID_PUBLIC = defineSecret('VAPID_PUBLIC');
const VAPID_PRIVATE = defineSecret('VAPID_PRIVATE');
const VAPID_SUBJECT = 'mailto:0525toki0525@gmail.com';

if (!admin.apps.length) admin.initializeApp();

// 招待コードでスペースに参加する。コードの照合はサーバでしかできない。
// （クライアントに members を書かせると、スペースIDを知っている人がコード無しで
//   自分を足して入れてしまう。外した相手も、端末に残った ID でそのまま戻れる。）
// 返り値: { ok: true, spaceId } / { ok: false, reason: 'code' | 'full' }
// reason を返すのは「コードが違う」と「もう二人いる」を画面で書き分けるため。
exports.joinSpace = onCall({ region: 'us-central1' }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'login required');
  const uid = req.auth.uid;
  // js/space.js の normalizeCode と同じ規則（大文字化・英数字以外を捨てる）
  const code = String((req.data && req.data.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return { ok: false, reason: 'code' };

  const db = admin.firestore();
  const invite = await db.collection('invites').doc(code).get();
  if (!invite.exists) return { ok: false, reason: 'code' };
  const spaceId = (invite.data() || {}).spaceId;
  if (!spaceId) return { ok: false, reason: 'code' };

  const ref = db.collection('spaces').doc(spaceId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: 'code' };
  const members = (snap.data() || {}).members || [];
  if (members.includes(uid)) return { ok: true, spaceId }; // 二重参加は何もしないで成功
  if (members.length >= 2) return { ok: false, reason: 'full' }; // ふたりのためのアプリ
  await ref.update({ members: admin.firestore.FieldValue.arrayUnion(uid) });
  return { ok: true, spaceId };
});

// 購読に必要な公開鍵をブラウザへ渡す。公開してよい鍵なので認証済みなら誰でも取れる。
exports.pushKey = onCall({ secrets: [VAPID_PUBLIC], region: 'us-central1' }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'login required');
  return { key: VAPID_PUBLIC.value() };
});

// 1件送る。相手が消えていたら（404/410）その購読は捨ててよいので、その旨を返す。
async function sendOne(sub, payload) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    return { ok: true, gone: false };
  } catch (e) {
    const code = e && e.statusCode;
    const gone = code === 404 || code === 410; // 端末から消された購読
    if (!gone) console.error('push failed', code, String((e && e.message) || e).slice(0, 200));
    return { ok: false, gone };
  }
}

exports.dailyAnniversary = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'Asia/Tokyo',
    region: 'us-central1',
    secrets: [VAPID_PUBLIC, VAPID_PRIVATE],
  },
  async () => {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC.value(), VAPID_PRIVATE.value());
    const today = todayInTokyo();
    const stats = await runDaily(
      admin.firestore(), sendOne, today, admin.firestore.FieldValue.delete(),
    );
    console.log('dailyAnniversary', Object.assign({ today }, stats));
  },
);
