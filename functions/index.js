const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_KEY = defineSecret('GEMINI_KEY');

// 写真（複数可）＋住所＋近くの店ヒントから、撮影された「お店の正式名称」を自由回答で推測する。
// 返り値は { name: string|null }。フロント側で searchText により実在の placeId/座標に裏取りする。
exports.suggestPlace = onCall(
  { secrets: [GEMINI_KEY], region: 'us-central1', timeoutSeconds: 30 },
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
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const parts = images
      .slice(0, 3)
      .map((b) => ({ inlineData: { mimeType: 'image/jpeg', data: b } }));
    const hintText = hints.length
      ? '\nこの付近にある店（参考。ここに無い店を答えてもよい）:\n- ' + hints.join('\n- ')
      : '';
    const prompt =
      'これらの写真は、同じ一つの場所（お店/施設）で撮られたものです。'
      + (address ? `撮影地の住所はおおよそ「${address}」付近です。` : '')
      + '看板・ロゴ・メニュー・料理・内装・外観などの手がかりと住所から、'
      + '撮影された「お店/施設の正式名称」を推測してください。'
      + hintText
      + '\n\n回答ルール：店名だけを1行で答える。チェーン店なら支店名まで（例：スターバックス 京都三条店）。'
      + '推測が難しく確信が持てない場合は UNKNOWN とだけ書く。店名以外の説明・記号・引用符は書かない。';

    let text = '';
    try {
      const result = await model.generateContent([...parts, prompt]);
      text = (result.response.text() || '').trim();
    } catch (e) {
      console.error('gemini error', e && e.message);
      return { name: null }; // 失敗は「不明」に落とす（保存は止めない）
    }
    // 1行目だけ採用し、前後の引用符を除去。UNKNOWN/空は null。
    const line = (text.split('\n')[0] || '').trim().replace(/^["'「『]+|["'」』]+$/g, '').trim();
    if (!line || /^unknown$/i.test(line)) return { name: null };
    return { name: line };
  }
);
