// 「閉じる」ボタンが全部そろって .x-btn を使っているか数える。
// 閉じるボタンには必ず aria-label="閉じる" が付いているので、それを目印にする。
// 使い方: node scripts/close-buttons-check.mjs
import fs from 'node:fs';

// 例外: ふりかえりに戻る帯の×は、帯の一部なので丸くしない（当たり判定だけ合わせてある）
const ALLOWED_WITHOUT = ['rb-x'];

const files = ['index.html', ...fs.readdirSync('js').map((f) => 'js/' + f)];
let total = 0;
let bad = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (!line.includes('aria-label="閉じる"')) return;
    total += 1;
    if (line.includes('x-btn')) return;
    if (ALLOWED_WITHOUT.some((c) => line.includes(c))) return;
    bad += 1;
    console.log('FAIL ' + file + ':' + (i + 1) + '  x-btn が付いていない');
    console.log('     ' + line.trim().slice(0, 110));
  });
}
console.log('閉じるボタン ' + total + '件、そろっていないもの ' + bad + '件');
console.log(bad === 0 ? '✅ close-buttons ALL PASS' : '❌ FAILED');
process.exit(bad === 0 ? 0 : 1);
