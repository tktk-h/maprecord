# 地図ピンのクラスタリング(束ね表示) 設計

## 背景・課題

記録が増えると、密集したエリアでピンが重なり合って見づらくなる。ズームアウト時に近接するピンを1つのバッジにまとめ、タップ/ズームインで個別ピンへ展開できるようにする。

既に存在する「同一座標(訪問回数)のまとめ」([js/records.js](../../../js/records.js) `coordKey`/`countAt`、6桁小数≈10cm一致)とは別レイヤーの機能。あちらは同じ場所への複数回訪問を1本のマーカーに畳み込むもの、今回追加するのは**別々の座標にある複数マーカー**を画面上の距離に応じて束ねるもの。両者は併存し、既存の畳み込み済みマーカーがクラスタリングの入力になる(2段階の束ね)。

## 採用アプローチ

`@googlemaps/markerclusterer`(Google公式ライブラリ)を採用する。

| 案 | 内容 | 評価 |
|---|---|---|
| **A. `@googlemaps/markerclusterer`(採用)** | Google公式。`AdvancedMarkerElement`をネイティブサポート(ソース `marker-utils.ts` で確認済み)。ズーム連動の距離ベースクラスタ化・展開を内蔵。`renderer`でクラスタの見た目を完全にカスタムできる | 実装量最小。CDN追加1本(exifrと同じパターン)。枯れたライブラリ(週300万DL) |
| B. 自前クラスタリング | グリッド/距離ベースの束ね判定を自作し、zoom/idleイベントで再計算 | 依存ゼロだが、展開アニメーションや境界処理を一から作ることになり工数過大。この規模(記録数十〜数百件)では過剰投資 |
| C. Supercluster直利用 | k-d木ベースの高速版を薄いラッパーなしで直接使う | 数万件規模向け。このアプリの記録数では恩恵がなく、Aより実装が増える |

## 適用範囲

- **対象**: 通常のマップ表示([js/records.js](../../../js/records.js) `render()`内、`searchResults`でも`dayMode`でもない分岐)のみ
- **対象外**: 「1日の流れ」(`numbered=true`のルート表示)、名前検索結果 — 少数ピンの順番/一致関係が重要なため、クラスタ化すると誤解を招く

## 見た目

- クラスタバッジ: テラコッタ色(`--accent` `#b76e64`)の円、白文字で件数表示
- 既存の`.pin-order`/`.visit-count`バッジと同じ白縁取り・`--shadow-md`トーンで統一感を持たせる
- ジャンルが混在するクラスタでも色は固定(ジャンル別の色分けは個別ピンのみ)
- クラスタが1件だけになった場合はライブラリが自動的に通常の個別ピンとして表示する(バッジ化しない)

## タップ挙動

クラスタバッジをタップすると、そのクラスタの範囲にズーム&パンして中身のピンを展開する。これはライブラリ既定の`defaultOnClusterClickHandler`(`map.fitBounds(cluster.bounds)`)の挙動そのままなので、`onClusterClick`は指定しない。

**重要な制約**: `AdvancedMarkerElement`をクラスタバッジに使う場合、ライブラリは`click`ではなく`gmp-click`イベントで待ち受ける(`markerclusterer.ts` `renderClusters`で確認)。`gmp-click`は`gmpClickable: true`が設定されたマーカーでしか発火しないため、**rendererが返すマーカーには必ず`gmpClickable: true`を渡す**こと。既存の`makeMarker()`はこのフラグを渡していないので、`opts.clickable`を受け取れるよう拡張する。これを忘れるとバッジをタップしても何も起きない。

## まとまる基準

ライブラリの既定アルゴリズム(`SuperClusterAlgorithm`)をそのまま使う。基準は「実際の距離(m)」ではなく**画面上のピクセル距離**(既定 `radius = 60`、ソースで確認済み)。ズームアウトしているときは画面上60pxが実際の数百m〜kmに相当するため遠い地点同士もまとまり、ズームインすると数m〜数十mの近接ピンしかまとまらなくなる — 縮尺に応じて自動調整される。

既定の`maxZoom = 16`により、**ズーム16以上ではクラスタ化されない**。アプリの`flyTo()`はズーム16、`fitTo()`も16を上限にしているため、最もズームインした状態では常に個別ピンが見える。整合しているので既定のまま使う。

## on/off設定

- **保存先**: `localStorage`(端末ごと。[js/map.js](../../../js/map.js) の表示位置保存 `VIEW_KEY` と同じ方式)。ふたりの一方がON/OFFを切り替えても、もう一方の端末には影響しない
- **初期値**: ON
- **置き場所**: 既存の「メニュー」(招待コード・記念日・ふりかえり・ジャンル編集が並ぶ、topbarの`filters-open`領域)にトグル式のボタンを追加する。他のボタンは全て「開く」系アクションなので、ON時はテラコッタ背景で強調表示し状態が一目でわかるようにする(`#view-toggle button.active`と同様のパターン)
- OFF時は即座に通常の非クラスタ描画へ切り替わる

## 実装変更点

**[index.html](../../../index.html)**: exifrと同じ形でCDN追加
```html
<script src="https://cdn.jsdelivr.net/npm/@googlemaps/markerclusterer/dist/index.min.js"></script>
```
メニューにトグルボタン(例: `id="cluster-toggle"`)を追加。

**[js/map.js](../../../js/map.js)**: `renderPins()`に`opts.cluster`を追加(既定false=今の挙動のまま)。`cluster: true`のときは各マーカーを直接`map`に置かず、`markerClusterer.MarkerClusterer`にまとめて渡す。カスタム`renderer`でクラスタバッジ(`AdvancedMarkerElement`)を生成する。`clearPins()`でクラスタラも一緒に破棄する。

**[js/records.js](../../../js/records.js)**: 通常表示の分岐でのみ、localStorageのon/off状態を見て`{ cluster: <state> }`を渡す。

**[js/app.js](../../../js/app.js)**: `cluster-toggle`ボタンのクリックでlocalStorage値を反転し、`App.records.render()`(公開済み)を呼んで再描画。

## 場所検索フローとの衝突(要対応)

既存の場所検索は、`markers`配列の`.map`プロパティを**直接操作**して記録ピンの表示/非表示を切り替えている:

- [js/map.js](../../../js/map.js) `hideRecordPins()` — 全記録ピンを`m.map = null`で隠す([js/search.js:133](../../../js/search.js))
- [js/map.js](../../../js/map.js) `renderPlaceResults(..., {hideRecords:true})` — 検索結果と一致する記録ピンだけ`m.map = map`で残す([js/search.js:147](../../../js/search.js))
- [js/map.js](../../../js/map.js) `clearPlaceResults()` — 隠していた記録ピンを`m.map = map`で戻す

クラスタONの状態でこれをそのまま動かすと2つの不具合が起きる:

1. **クラスタバッジが消えない** — バッジはクラスタラが所有する別のマーカーであり、`markers`配列には含まれない。`hideRecordPins()`では隠せず、検索結果の赤ピンの上にバッジが残る
2. **手動の表示状態が上書きされる** — クラスタラは`map`の`idle`イベントごとに`render()`を実行し、自前の可視状態を再適用する(`renderClusters`が束ね対象のマーカーを`setMap(null)`にする)。手動で`m.map = map`に戻しても、次に地図が動いた瞬間に元へ戻される

**対策**: クラスタラの有効/無効を切り替える内部関数を[js/map.js](../../../js/map.js)に用意し、

- `hideRecordPins()`と`renderPlaceResults({hideRecords:true})`の冒頭でクラスタラを`setMap(null)`して無効化する(`onRemove`→`reset()`が走り、管理下のマーカーは全て`map = null`になる。その後は既存の手動制御がそのまま効く)
- `clearPlaceResults()`で、クラスタON設定なら`setMap(map)`し直してクラスタ表示へ復帰させる

これにより「検索中は素の個別ピン制御、検索を抜けたらクラスタ表示に戻る」という一貫した挙動になる。

## エッジケース

- CDN読み込み失敗時: `window.markerClusterer`が存在しないため、exifrと同じガード(`if (window.markerClusterer)`)でクラスタなしの通常描画に自動フォールバックする
- クラスタ1件のみ: ライブラリが自動的に通常ピン表示にする(`renderClusters`が`cluster.markers.length === 1`を特別扱いする)
- OFF設定時: クラスタラを生成せず、既存の`renderPins`のマーカー配置ロジックのみで描画する
- `clearPins()`: クラスタラが存在する場合は`setMap(null)`で先に破棄してから`markers`を空にする。破棄を忘れると古いクラスタラが`idle`リスナーを保持し続けてマーカーが復活する
- 再描画のたびに`renderPins()`が呼ばれるため、クラスタラは毎回作り直す。`clearPins()`での破棄が確実なら問題ない

## テスト方針

- `renderPins({cluster:true})`呼び出し時にクラスタラが生成され、`clearPins()`で破棄されることを確認
- on/off切り替えでlocalStorageが更新され、再描画時に反映されることを確認
- CDN未読み込み(`window.markerClusterer`未定義)時に例外を投げず通常描画にフォールバックすることを確認
- 実機での手動確認(自動テストが難しい領域):
  - クラスタバッジのタップでズームインすること(`gmpClickable`の設定漏れ検出)
  - クラスタON状態から場所検索 → バッジが消えて赤ピンが出ること、検索を抜けるとクラスタ表示に戻ること
  - 検索中に地図をドラッグしても記録ピンが復活しないこと(`idle`再描画の衝突検出)
