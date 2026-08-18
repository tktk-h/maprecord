const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_KEY = defineSecret('GEMINI_KEY');

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
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
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
    try {
      // サーバ側の一時混雑(500/503)だけ最大3回リトライ。
      // 429(枠オーバー)はリトライしない＝無駄に枠を消費しない（再送しても通らない）。
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await model.generateContent([...parts, prompt]);
          text = (result.response.text() || '').trim();
          break;
        } catch (e) {
          const m = String((e && e.message) || e);
          const serverBusy = /(503|500|high demand|unavailable|overloaded|internal error)/i.test(m);
          if (!serverBusy || attempt >= 2) throw e; // 一時混雑でない(429等) or 3回目は諦める
          await new Promise((r) => setTimeout(r, 900 * (attempt + 1))); // 0.9s → 1.8s
        }
      }
    } catch (e) {
      const err = String((e && e.message) || e).slice(0, 300);
      console.error('gemini error', err);
      return { name: null, raw: '', err, imgs: parts.length }; // 失敗は「不明」に落とす（保存は止めない）
    }
    const raw = text.slice(0, 200); // 診断：Geminiの生返答（先頭200字）
    // 1行目だけ採用し、前後の引用符を除去。UNKNOWN/空は null。
    const line = (text.split('\n')[0] || '').trim().replace(/^["'「『]+|["'」』]+$/g, '').trim();
    if (!line || /^unknown$/i.test(line)) return { name: null, raw, err: '', imgs: parts.length };
    return { name: line, raw, err: '', imgs: parts.length };
  }
);
