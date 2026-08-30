# 地図とカレンダーをスライドで切り替える Design

**日付:** 2026-08-30 / **版:** 20260827x

## 何をする変更か

「地図／カレンダー」を切り替えたとき、パッと入れ替わるのではなく、
**カレンダーが右から地図の上に滑り込んでくる**ようにする。地図は動かさない。

## なぜこの形か

スマホでは `#map`（z-index 0）も `#calendar-view`（z-index 40）も `position:absolute; inset:0` で、
**カレンダーはもともと地図の上に重なる全画面レイヤー**。だから覆いかぶさる動きが素直に作れる。

**地図は動かさない。** 生きている Google 地図を transform で動かすとタイルの描き直しでカクつく。
カレンダーは `background: var(--bg)`（`#f4f1ec`・不透明）なので、覆っている間に地図が透けることはない。

**スワイプでの切り替えはしない。** 地図には横ドラッグで移動する操作があり、
「地図を動かしたいのか画面を変えたいのか」の見分けが要る。ボタンだけなら競合しない。

## 設計

**動き**: 0.32秒 / `cubic-bezier(.32,.72,0,1)`。下シート（`App.sheet`）と同じ値を借りて、
アプリの中で動きの手触りを揃える。

**状態はクラスで持つ**（`hidden` の直の付け外しをやめる）:

- `#calendar-view` の既定は `transform: translateX(100%)`（画面の右外）
- `.showing` が付くと `translateX(0)`
- **入る**: `hidden=false` にして、**次のフレームで** `.showing` を付ける
- **出る**: `.showing` を外し、`transitionend` で `hidden=true`

**⚠️同じフレームで `hidden=false` と `.showing` を両方やると transition が走らない**
（ブラウザが「最初からそこにあった」と見なす）。`requestAnimationFrame` を挟むのが要点。

**⚠️transform は スマホ幅の `@media` の中だけに書く。** 画面が広いときは `#calendar-view` は
`flex:1` で流れの中にいるので、`translateX(100%)` を当てると画面外へ飛ぶ。

## 塞いでおく穴

**① 浮きボタンがカレンダーの上に出る。**
`#locate-btn`/`#bulk-btn` は z-index 500、カレンダーは 40。放っておくと覆われずに浮く
（[[maprecord-overlay-zindex]] と同じ罠）。今と同じく、カレンダーを出す瞬間に `hidden` にする。

**② `transitionend` が来ない場面がある。**
「動きを減らす」設定（`prefers-reduced-motion`）や広い画面では transition が走らないので、
`transitionend` が永久に来ない。**そのままだと `hidden` が付かず、透明なカレンダーが画面を覆って
地図が触れなくなる。** `transitionend` とタイマーの早いほうで確定させる（保険 400ms）。

**③ 連打で取り違える。** 出ていく途中でもう一度カレンダーを開くと、
前の「隠す」予約が後から発火して開いたばかりのカレンダーを消してしまう。
開くときに必ず予約を取り消す。

## 地図を隠すのをやめる

スライド中に地図が見えている必要があるため、`showCalendar` の `map.hidden = true` を外す。
カレンダーが覆っている間、地図は描画されたままだが操作されないので負荷は低い。
`App.map.refresh()` は残す（害が無く、消す理由もない）。

## 触るファイル

- `js/app.js` — `showMap` / `showCalendar` と、出し入れの小さな関数3つ
- `style.css` — スマホ幅の `@media` に数行

## どう確かめるか

実ブラウザで `getComputedStyle` を測る（[[maprecord-ios-fullscreen]] の教訓で、目視判定はしない）:

- 既定が `translateX(100%)` 相当の matrix になっているか
- `.showing` で `translateX(0)` になるか
- **「動きを減らす」設定で transition が実際に `0s` になるか**（穴②の前提）

動きの速さが気持ちいいかは本人が実機で見る。**0.32秒が速すぎ/遅すぎの調整は入る前提。**
