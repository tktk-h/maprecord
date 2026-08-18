const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_KEY = defineSecret('GEMINI_KEY');

exports.suggestPlace = onCall(
  { secrets: [GEMINI_KEY], region: 'us-central1', timeoutSeconds: 20 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'login required');
    const data = req.data || {};
    const imageBase64 = data.imageBase64;
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    if (!imageBase64 || !candidates.length) return { placeId: null };

    const genAI = new GoogleGenerativeAI(GEMINI_KEY.value());
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const list = candidates.map((c, i) => `${i}: ${c.name}`).join('\n');
    const prompt =
      'この写真は、あるお店/施設で撮られたものです。看板・ロゴ・料理・内装などから判断して、'
      + '次の候補のうち写真に最も合うものの「番号」だけを返してください。'
      + 'どれも当てはまらなければ -1。番号以外の文字は書かないでください。\n候補:\n' + list;

    let text = '';
    try {
      const result = await model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
        prompt,
      ]);
      text = (result.response.text() || '').trim();
    } catch (e) {
      console.error('gemini error', e && e.message);
      return { placeId: null }; // 失敗は「該当なし」に落とす（保存は止めない）
    }
    const m = text.match(/-?\d+/);
    const idx = m ? parseInt(m[0], 10) : -1;
    if (Number.isInteger(idx) && idx >= 0 && idx < candidates.length) {
      return { placeId: candidates[idx].placeId };
    }
    return { placeId: null };
  }
);
