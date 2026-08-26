# ステータスバーの下まで地図を敷く（iOS ホーム画面アプリ）Design

**日付:** 2026-08-27 / **版:** 20260827f

## 目的

iPhone のホーム画面から開いたとき、時計・電波・電池が並ぶ帯の背景を、
アプリ背景色のベタ塗りではなく **地図** にする。

## 前回（2026-08-18 `cc67d7f`）が失敗した理由

`viewport-fit=cover` と `env(safe-area-inset-top)` は入っていたが、
`apple-mobile-web-app-status-bar-style` が `default`（＝不透明バー）のままだった。

**iOS はこの値が `black-translucent` のときだけ、Web の中身を全画面ぶん渡す。**
片方だけでは「中身が下にずれるだけで、帯は塗りつぶしのまま」になる。実際そうなり、
`8b434ec` で revert された。今回の変更の本体はこの1行である。

## 設計

### 1. iOS に全画面を要求する（index.html）

- viewport に `viewport-fit=cover`
- `apple-mobile-web-app-status-bar-style` を `black-translucent`

⚠️ **iOS はこの指定をインストール時に覚える。** すでにホーム画面にあるアイコンでは
反映されないことがあり、その場合は削除して追加し直す必要がある。
「また失敗した」と誤解しやすいので、変更を出すときは必ずこれを添えて伝える。

### 2. 地図側の変更はゼロ

`body{position:fixed;inset:0}` → `#layout{flex:1}` → `#map{position:absolute;inset:0}`
という構造なので、webview が上に伸びれば地図は自動で帯の下まで届く。JS は触らない。

### 3. 安全域はトークンにする

```css
--safe-top: env(safe-area-inset-top, 0px);
--safe-bottom: env(safe-area-inset-bottom, 0px);
```

`env()` を直接あちこちに書かず変数にした理由は2つ。

1. 足し忘れた箇所を `grep --safe-` で洗い出せる。
2. **検証できる。** ブラウザで `--safe-top: 59px` を差し込めば、ノッチ付き iPhone の
   レイアウトを PC 上で再現できる（`env()` 直書きでは偽装できない）。

### 4. 逃がすもの／逃がさないもの

| | 扱い |
|---|---|
| 地図・全画面オーバーレイの背景 | 上端まで敷く（逃がさない） |
| 上端に浮くもの | `--safe-top` ぶん下げる：`#topbar` / `#locate-btn` / `#bulk-btn` / `#research-btn` / `#memory-card` / `#review-card` / `#calendar-view` / `.rv-x` / `.rv-progress` / `.lb-close` |
| 下端に浮くもの | `--safe-bottom` ぶん上げる：`#panel-content` / `#review-back` / `#bulk-pickbar` / `.lb-counter` |
| 全画面（設定・ログイン・まとめて追加・ジャンル編集・ふりかえり） | 自分の背景色で上端まで塗り、**中身だけ**が帯の下から始まる |

ふりかえりのスライドショーは絶対配置（`inset:0`）なので、`.review-overlay` の
`padding-top` の影響を受けない。＝スライドは全画面のまま、スクロール総集編の中身だけ下がる。

### 5. 時計の文字色（未確定・実機で確認する）

`black-translucent` では文字が白で描かれる場合がある。明るい地図の上だと読みにくい。
まず影なしで出し、実機で見てから決める。必要なら上端に薄い暗色グラデ（scrim）を敷く
（iOS 版 Google マップと同じ手）。

### 6. デグレしない根拠

`env()` は PC・Android・iPhone の Safari（ブラウザ表示）では 0。
`--safe-top:0` に戻して測り直し、変更前と同じ座標であることを確認した（下記）。

## 検証

`--safe-top:59px` / `--safe-bottom:34px` を差し込んだ状態で実測：

| 要素 | 実測 | 期待 |
|---|---|---|
| `#map` | top 0 / bottom 812 | 全画面のまま |
| `#view-toggle` | top 69 | 10 + 59 |
| `#search-wrap` | top 118 | 2段目 |
| `#locate-btn` / `#bulk-btn` | top 69 | 10 + 59 |
| `#research-btn` | top 175 | 116 + 59 |
| `#panel-content` padding-bottom | 58px | 24 + 34 |

`--safe-*:0` に戻すと view-toggle 10 / locate 10 / research 116 / padding 24px ＝ 変更前と一致。

## 戻し方

1コミット。`git revert` 一発で戻せる。
