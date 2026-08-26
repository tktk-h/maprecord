# ステータスバーの下まで地図を敷く（iOS ホーム画面アプリ）Design

**日付:** 2026-08-27 / **結果: 実現（20260827n）**

> **結論（先に読む）。決め手は `maximum-scale=1.0, user-scalable=no` を viewport から外すこと。**
> この2つが付いていると、iOS のホーム画面アプリは中身を画面いっぱいに伸ばさず、
> 下に 47px の帯（＝ステータスバーぶん）が残る。外すと上下とも端まで地図が届く。
>
> iOS は中身を **797 の座標**で渡してきて、それを **844 の画面に引き伸ばして**表示する。
> だから `100dvh` のまま素直に組むのが正解。「実寸 844 に合わせよう」と高さを足すと、
> はみ出たぶんが画面の外に切り落とされてまた帯が出る（一度これで遠回りした）。
> `innerHeight` は 844 にはならない。**数字ではなく塗られた画素で判定すること。**

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


---

# 2026-08-27 の実測と結論

## 実機（iPhone・safe-top 47px の機種・ホーム画面アプリ）で測った値

| | 縦向き | 横向き |
|---|---|---|
| `window.innerHeight` | **797** | 390 |
| `screen.height` | 844 | 844 |
| `safe-area-inset-top` | 47px | 0px |
| `safe-area-inset-bottom` | 34px | 20px |
| body / #map の高さ | 844（--app-h で補正） | 390 |
| 塗りが届く下端 | **797** | 画面の下端まで |

## どうやって確かめたか

推測で直そうとすると外すので、画面に直接置いて見た。

1. **数値パネル** … `innerHeight` / `screen.height` / 安全域 / 各要素の実測を画面に出す。
   → 縦向きだけ `inner` が `screen` より 47px 小さいと判明。
2. **色帯** … body の本当の下端（844）に赤、iOS が言う下端（797）に緑を置く。
   → **赤が出ない。緑で止まる。** 塗りは 797 までしか届いていない。
   Google のロゴも `bottom 844` にあるのに見えない＝地図は正しく描こうとしている。
3. **地色を紫に** … `html { background: 紫 }`。ページのキャンバスなら帯が紫になるはず。
   → **紫にならない。** つまり帯はページの外＝iOS 側の余白。
4. **回転** … 横向きでは赤が画面の下端に出る（窓は画面いっぱい）。縦に戻すと 797 に逆戻り。
   レイアウトの持ち越しではなく、縦向きの窓が本当に短い。
5. **`height=device-height`** … 効果なし。
6. **ステータスバーを `default` に戻して cover だけ残す** … 見た目も数値も `black-translucent`
   と完全に同じ。**＝ 窓をずらしているのは status-bar-style ではなく `viewport-fit=cover`。**

## 残したもの / 消したもの

- **残した**: `--safe-top` / `--safe-bottom` と、それを足す各所の計算。
  cover が無い今はどこでも 0 なので何も変わらない。iOS が直ったら meta を1行足すだけで
  全部が正しい位置に動く。
- **消した**: `viewport-fit=cover`、`black-translucent`、`--app-h`（窓より高くする補正。
  cover が無いと逆に害になる）、画面上の診断表示。

## 次にやるなら

iOS のバージョンが上がったときだけ。手順は「`viewport-fit=cover` と
`black-translucent` を戻す → ホーム画面アプリで `innerHeight` と `screen.height` を見る」。
**同じなら直っている。47px 違うならまた同じ壁**なので、そこで止めること。


---

# 2026-08-27 の決着

## 効いた組み合わせ

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

**`maximum-scale=1.0, user-scalable=no` を書かないことが条件。** 上の3つが揃っていても、
この2つが残っていると下に帯が出る（20260827h で3つ揃えて入れ直しても 797 のままだった）。

body の高さは `100dvh` のまま。`--app-h` のような補正は入れない。

## なぜ遠回りしたか（同じ轍を踏まないために）

- **数字で判定してしまった。** `innerHeight === screen.height` を成功条件にしたが、
  iOS は画面いっぱいに描けていても `innerHeight` は 47px 小さい値を返し続ける。
  実際 20260827l は「47px 足りない」と表示しながら、画素は端まで塗れていた。
  判定は必ず**画面に置いた色帯**など、目に見えるもので行うこと。
- **「実寸に合わせる」補正が裏目に出た。** 797 の座標系に 844 を入れると、
  はみ出た 47px が切り落とされ、下端に貼り付くシートも切れる（20260827m で再現）。

## 副作用

`user-scalable=no` が無くなったので、ページ全体をピンチで拡大できる。地図の操作は
Google マップ側が受け持つので従来どおり。UI の誤ズームが気になる場合は
`touch-action: manipulation` を body に足す（`user-scalable=no` を書き戻すと帯が復活するので不可）。

## 安全域

`--safe-top` / `--safe-bottom` の逃がし計算が、ここで初めて本番で意味を持つ。
上端に浮くもの（ヘッダー・現在地・まとめて・再検索・思い出カード・ふりかえりの×）と
下端に貼り付くもの（シート・戻るボタン・一括バー）に効いている。
