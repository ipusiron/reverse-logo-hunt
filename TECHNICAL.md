# Technical Documentation - Reverse Logo Hunt

このドキュメントでは、Reverse Logo Huntのしくみ（モジュールの分け方、照合・検索・OCRのアルゴリズム、問い合わせの中身、安全対策、テスト）を開発者向けに説明します。使い方はREADME.mdを見てください。

---

## 📚 目次

1. [モジュールの構成](#モジュールの構成)
2. [解析の流れ](#解析の流れ)
3. [OCRと検索語](#ocrと検索語)
4. [Wikidataへの問い合わせ](#wikidataへの問い合わせ)
5. [Commonsへの問い合わせ](#commonsへの問い合わせ)
6. [ロゴの照合](#ロゴの照合)
7. [候補の並べ方](#候補の並べ方)
8. [自動で候補を囲む](#自動で候補を囲む)
9. [地図と関係図](#地図と関係図)
10. [保存と読み込み](#保存と読み込み)
11. [安全対策](#安全対策)
12. [テストと確かめ方](#テストと確かめ方)
13. [限界と今後](#限界と今後)

---

## モジュールの構成

計算部（DOMにも通信にも依存しない純粋な関数）と、通信・画面の部分を分けています。計算部はNode.jsの`node --test`でそのまま検査できます。

| ファイル | 種類 | 役割 |
|:--|:--|:--|
| `js/logo-match.js` | 計算部 | 背景の推定・前景の取り出し・形・明暗の構造・縦横比・色の比較 |
| `js/brand-text.js` | 計算部 | OCRの文字から検索語の候補を作る |
| `js/wikidata-core.js` | 計算部 | 検索のURL、SPARQLの組み立て、応答の解析、関係の向きの正規化 |
| `js/commons-core.js` | 計算部 | imageinfoのURL、応答の解析、作者のHTMLから文字を取り出す |
| `js/exif-core.js` | 計算部 | ExifReaderの出力から緯度・経度を取り出す |
| `js/candidate-rank.js` | 計算部 | 検索の順位・種類・照合から総合を出して並べる |
| `js/ocr-prep.js` | 計算部 | OCRの前の拡大・グレースケール・反転・枠の除去 |
| `js/roi-suggest.js` | 計算部 | 「自動で候補を囲む」 |
| `js/session-core.js` | 計算部 | JSONの書き出しの形と、読み込みの検証 |
| `js/group-core.js` | 計算部 | 写真の全社の親・所有者をたどり、共通の親を見つける |
| `js/geo.js` | 計算部 | 2点の大円距離と方位（8方位） |
| `js/wikidata.js` | 通信 | Wikidataへの問い合わせとキャッシュ |
| `js/commons.js` | 通信 | Commonsへの問い合わせとキャッシュ |
| `js/cache.js` | 通信 | IndexedDBの24時間キャッシュ |
| `js/analysis.js` | 通信 | 1つの領域について「検索→詳細→照合→並べ替え」 |
| `js/ocr.js` | 画面 | Tesseract.jsのワーカーを言語ごとに1つ作って使い回す |
| `js/exif.js` | 画面 | ExifReaderで撮影地点を読む |
| `js/marking.js` | 画面 | ロゴを囲む画面（Pointer Events） |
| `js/map.js` | 画面 | Leafletの地図 |
| `js/graph.js` | 画面 | Cytoscape.jsの関係図 |
| `js/messages.js` | 画面 | 画面の文言の辞書（日本語・英語）と、最初の言語の決め方 |
| `js/i18n.js` | 画面 | data-i18n・data-i18n-attr の要素へ辞書の文言を入れる、言語の切り替え |
| `js/storage.js` | 画面 | localStorageを使えなくても止まらない読み書き |
| `js/main.js` | 画面 | 全体の組み立てと操作 |

外部のライブラリーは、Leaflet 1.9.4、Cytoscape.js 3.28.1、Tesseract.js 5.0.5、ExifReader 4.23.5です（すべて版を固定し、SRIを付けています）。

---

## 解析の流れ

```
画像の読み込み（長辺1536pxまで縮小、EXIFのGPSを読む）
  ↓
ロゴを囲む（marking.js。座標は画像の画素で整数）
  ↓
領域ごとに OCR（ocr.js ＋ ocr-prep.js）→ 検索語の候補（brand-text.js）
  ↓
領域ごとに検索（analysis.js）
  1. wbsearchentities で上位8件（順位つき）
  2. SPARQL で、その8件のロゴ・本社の座標・組織かどうか・ブランドかどうか
  3. ロゴのある候補（最大6件）の imageinfo を1回で引き、サムネイルを読み込む
  4. 領域とサムネイルを照合（logo-match.js）
  5. 総合で並べる（candidate-rank.js）。1位を仮に選ぶ
  ↓
画面: 候補の一覧・点数の内訳・地図（本社と撮影地点）・関係図（選んだ会社）
```

1つの候補でロゴの取得や照合に失敗しても、その候補を「照合なし」にして残りを続けます。

---

## OCRと検索語

### 言語と段組みの判定

- 言語は、ロゴを囲む画面の「OCRの言語」で英語（`eng`）か日本語と英語（`jpn+eng`）を選びます。日本語のデータ（`jpn.traineddata.gz`、約2.0MB）は、選んだときだけ読み込みます。ワーカーは言語ごとに1つ作って使い回します
- 段組みの判定（PSM）は、Tesseract.jsの既定と同じ6（1つのブロック）を使います。3（自動）にすると、1行だけの文字の看板（LEXUS・TOYOTA・DAIHATSU）の単語が0件になりました（2026-10-09に実測。第1弾の追補で一度3にしてしまい、PR #2で6に戻しました）

### 下ごしらえ（`ocr-prep.js`）

- 高さが120px未満の領域は、120pxになるまで拡大する（最大3倍）。Tesseractは小さい字を読み落とすため
- グレースケールにする。外周の色（背景）の明るさが128未満なら明暗を反転し、「白地に黒い字」にそろえる
- 読み直しのときだけ、2値にして枠を取り除く（`removeFrames`）。大津の方法でしきい値を決め、黒い連結成分のうち幅が画像の70%を超えるか高さが90%を超えるものを白で塗りつぶす

### 読み直し（`main.js`の`readText`）

1回目で検索語の候補が1つも出なければ、前景の外接矩形（ロゴの札だけ）に切り詰め、枠を取り除いて読み直します。明暗の向きは2通り試します。

これは、任天堂のロゴ（赤い札の中に、白い角丸の枠で囲まれた白い字）で、Tesseractの単語が0件だったために入れました。下ごしらえ後の画像は人の目には読めるのに、字を囲む枠があるとTesseractが領域ごと「図」とみなして字を探さないためです。枠を取り除くと「Nintendo」と読めます。

### 検索語の候補（`brand-text.js`）

- 商標の記号（™ ® © ℠）を空白にしてから、NFKCで全角を半角にそろえる（先に外すのは、NFKCが™を「TM」に変えて前の語にくっつけるため）
- 行ごとに、2〜4語の行は行全体も候補にし、続けて語を並べる
- Tesseractの単語の高さと確からしさがあれば、「高さ×(0.5＋確からしさ)」の大きい語を前にする（ロゴの社名はたいてい一番大きい字）
- 捨てるもの: 数字だけ、同じ文字の繰り返し、母音のない6文字以上の英字列（読み違いに多い）、the・Ltd・Incなどの語
- 残すもの: 子音だけの短い略称（BMW・DHL・HSBC）、2文字の略称（HP・LG・3M）、日本語（2文字以上）
- 日本語の字どうしの間の空白はつなぐ（Tesseractの日本語は「任 天 堂」のように1字ずつ区切ることがある）
- 最大5つ

---

## Wikidataへの問い合わせ

### 検索

`https://www.wikidata.org/w/api.php?action=wbsearchentities&type=item&origin=*&search=…&language=…&uselang=…&limit=8`

- 検索語に日本語の文字があれば`language=ja`、なければ`en`
- `uselang`は画面の言語（ラベルと説明の言語）
- 応答の順番をそのまま順位にする

以前は、WDQSの`wikibase:mwapi`のSearchを使っていました。この方法は検索の順位を出力しない（結果がQIDの順に並ぶ）ため、「nintendo」の50件に任天堂本体（Q8093）が入らず、上位の候補が関連会社やゲーム機になっていました（2026-10-09に実測）。

### 候補の詳細（SPARQL）

```sparql
SELECT ?item ?logo ?hq ?hqLabel ?coord ?isOrg ?isBrand WHERE {
  VALUES ?item { wd:Q8093 wd:Q172742 … }
  OPTIONAL { ?item wdt:P154 ?logo. }
  OPTIONAL { ?item wdt:P159 ?hq. OPTIONAL { ?hq wdt:P625 ?coord. } }
  BIND(EXISTS { { ?item wdt:P159 ?o1 } UNION { ?item wdt:P452 ?o2 } UNION { ?item wdt:P749 ?o3 }
    UNION { ?item wdt:P355 ?o4 } UNION { ?item wdt:P127 ?o5 } } AS ?isOrg)
  BIND(EXISTS { ?item wdt:P31 wd:Q431289 } AS ?isBrand)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en,mul". }
}
```

- `VALUES`に入れるのは`^Q[1-9][0-9]{0,11}$`に合うQIDだけです。利用者の文字列はSPARQLに入れません
- 「組織かどうか」は、本社所在地（P159）・業種（P452）・親会社（P749）・子会社（P355）・所有者（P127）のどれかを持つかで判定します。`P31/P279*`で上位のクラスをたどる判定は、8件で10.45秒（3段に限っても7.92秒）かかったため使いません。この判定は1.01秒でした（2026-10-09に実測）

### 関係

```sparql
SELECT ?kind ?other ?otherLabel ?start ?end ?share WHERE {
  VALUES ?company { wd:Q8093 }
  { ?company p:P355 ?st. ?st ps:P355 ?other. BIND("subsidiary" AS ?kind) }
  UNION { ?company p:P749 ?st. ?st ps:P749 ?other. BIND("parent" AS ?kind) }
  UNION { ?company p:P127 ?st. ?st ps:P127 ?other. BIND("owner" AS ?kind) }
  FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
  OPTIONAL { ?st pq:P580 ?start. }
  OPTIONAL { ?st pq:P582 ?end. }
  OPTIONAL { ?st pq:P1107 ?share. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en,mul". }
} LIMIT 300
```

- `wdt:`（最良のランクの値だけ）ではなく`p:`/`ps:`で文を引き、廃止のランクを除きます。終わった関係が通常のランクで残っていることがあるためです
- `parseRelations`は矢印を「親会社・所有者→子会社・所有される側」にそろえます。同じ相手との関係（親会社かつ所有者など）は1本の矢印にまとめ、文（開始・終了の年、持ち株の比率）を並べます。すべての文に終了の年があれば、終わった関係（点線）にします
- 矢印の名前は`statementLabel`で作ります。日本語は「所有者17.1%」「子会社（1990〜2016）」、英語は「Owner 17.1%」「Subsidiary (1990–2016)」です

### 共通の親（`group-core.js`）

```sparql
SELECT ?child ?kind ?parent ?parentLabel ?end WHERE {
  VALUES ?child { wd:Q35919 wd:Q27511 wd:Q53268 … }
  { ?child p:P749 ?st. ?st ps:P749 ?parent. BIND("parent" AS ?kind) }
  UNION { ?child p:P127 ?st. ?st ps:P127 ?parent. BIND("owner" AS ?kind) }
  FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
  OPTIONAL { ?st pq:P582 ?end. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en,mul". }
} LIMIT 500
```

- 選んだ会社から1段ずつ、まだたどっていない親・所有者を次の段の`VALUES`にして、最大3段まで問い合わせます（`fetchAncestorLinks`）
- `buildGroup`は、終了の年がない関係だけで上へたどり、各祖先に「どの選んだ会社から何段上か」を記録します。2社以上がたどり着いた祖先が共通の親です。並べ方は、たどり着いた会社の数が多い順、次に段の少ない順です
- 選んだ会社どうしが親子のとき（レクサスとトヨタ自動車など）、親の会社は自分自身から0段上として数えるので、共通の親になります
- 2026-10-09の実データ: レクサス・トヨタ自動車・ダイハツ工業 → トヨタ自動車（3社、最大1段上）と日本生命保険（3社、最大2段上）。ユニクロ・ジーユー → ファーストリテイリング（2社、1段上）
- 関係図は「写真の全社と共通の親」に切り替えると階層の配置になり、上に親・所有者、下に選んだ会社が並びます。共通の親は太い赤の枠で出します

---

## Commonsへの問い合わせ

`https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=330&iiextmetadatafilter=Artist|LicenseShortName&origin=*&titles=File:A|File:B|…`

- 照合する候補のファイルを1回の問い合わせで引きます
- 幅330pxは、Commonsが用意している既定の幅の1つです。既定にない幅（以前の512px）は960pxに丸められていました
- サムネイルの配信元は`thumb.wikimedia.org`です（2026-10-09の応答。以前の`upload.wikimedia.org`も受け付けます）。改修前はこの配信元がCSPになく、解析が毎回「解析エラー: undefined」で止まっていました
- 作者（Artist）はCommonsではHTMLで返ります（例: `<bdi><a href=… class="extiw">Nintendo</a></bdi>`）。`htmlToText`でタグを捨て、文字参照を戻した文字だけを表示します
- サムネイルは`crossOrigin = "anonymous"`・Refererなしで読み込みます。照合の画素を読むためと、表示用の`<img>`とキャッシュを共有するためです

---

## ロゴの照合

`describe(img, { reference })`で特徴を求め、`compare(a, b)`で比べます。

### 前景の取り出し

| 入力 | 前景の決め方 |
|:--|:--|
| 写真から囲んだ領域 | 外周2pxの中央値を背景色とし、RGBの距離が60を超える画素を前景にする |
| 参照ロゴ（外周の半分以上が透明） | 透明度128以上を前景にする（透明な部分は白に合成） |
| 参照ロゴ（外周が不透明で白くない） | 端まで色が塗られたロゴとみなし、画像全体を前景にする |

改修前の方式は、透明な画素（RGBA=0,0,0,0）を黒としてpHash・色に入れていました。白い紙に印刷されたロゴと、透明な背景の公式ロゴを比べると、背景が白と黒で逆になります。

### 4つの値

- 形: 前景の外接矩形を、縦横比を保って32×32の格子に収め、各マスの前景の割合を3×3でならしてから、柔らかいIoU（Σmin÷Σmax）を取る
- 明暗の構造: 外接矩形の中の明るさを24×24に縮め、平均0・分散1にそろえて相関を取り、絶対値にする（白抜きの看板にも使える）
- 縦横比: exp(−1.5×|ln(縦横比Aの比)|)
- 色: 前景の画素だけで、色相12区分と無彩色1区分（彩度0.25未満か明度0.2未満）の分布を作り、コサイン類似度を取る。白と黒は同じ無彩色の区分に入る

照合の合計 = 0.35×形 + 0.25×明暗の構造 + 0.15×縦横比 + 0.25×色

### 評価

README.mdの「照合の当たり具合」を見てください。作業側の評価のスクリプトと結果は、このリポジトリには入れていません（ロゴの画像を同梱しないため）。

---

## 候補の並べ方

`candidate-rank.js`

- 検索の順位の点 = 1 ÷ (1 + 0.5 × (順位 − 1))
- 種類の点 = 組織かブランドなら1、それ以外は0.4
- 照合の合計がない候補は0.5とみなす
- 総合 = 0.4×検索の順位の点 + 0.2×種類の点 + 0.4×照合の合計
- 1位と2位の差が0.05未満なら、画面で確かめるよう促す

照合だけで決めない理由は、子会社のロゴが親会社のロゴを中に含むことがあるためです。紙に印刷した任天堂のロゴでは、照合だけなら子会社Nintendo Software Technology（0.790）が任天堂（0.753）を上回りました。

---

## 自動で候補を囲む

`roi-suggest.js`の`suggestRois`

1. 長辺320px程度に縮める
2. Sobelの勾配の絶対値の和が90を超える画素を「インク」とみなす
3. 横に幅の3%以内のインクをつなぎ（字を語にまとめる）、縦に高さの1%以内をつなぐ
4. 4近傍の連結成分の外接矩形を候補にする。面積が画像の0.2%未満か60%超、縦横比が16超か1/6未満は外す
5. 余白（横8%・縦15%）を足して元の大きさに戻し、IoUが0.3を超えて重なるものは点数の高いほうを残す。最大8個

改修前は、COCO-SSD（物体検出のモデル、約18.6MB）と窓の走査を組み合わせていましたが、物体検出はロゴの検出ではなく、86.5秒かけて文字の断片を8つ出すだけでした（2026-10-09に実測）。

---

## 地図と関係図

- 地図: OpenStreetMapのタイル（`https://tile.openstreetmap.org/{z}/{x}/{y}.png`）。タイルの利用規約が有効なRefererを求めるので、`<meta name="referrer">`は`strict-origin-when-cross-origin`にしています。帰属表示は「© OpenStreetMap contributors」。本社と撮影地点の両方が入るように表示範囲を合わせます
- 関係図: 既定の配置は同心円（選んだ会社を中心に、関係のある会社をまわりに並べる）。隠れたタブで配置すると大きさ0で計算されるので、タブを表示したときに`cy.resize()`と`cy.fit()`を呼びます
- 関係図の矢印の曲線は、矢印ごとに設定を残し、表示を切り替えても戻りません

### 距離と方角（`geo.js`）

- 大円距離 = 2R・asin(√(sin²(Δφ/2) + cosφ₁cosφ₂sin²(Δλ/2)))、R = 6371.0088km（地球の平均半径）
- 方位 = atan2(sinΔλ・cosφ₂, cosφ₁sinφ₂ − sinφ₁cosφ₂cosΔλ)を0〜360°にし、45°ごとの8方位に丸める
- 10km未満は小数1桁、それ以上は整数
- 地図には、同じ画像で会社を選んだロゴの本社をすべて出し、撮影地点からの点線と表を出します。看板の画像の例（撮影地点35.68111, 139.76694）では、任天堂（京都市）が370km・西でした

### 日英の切り替え（`messages.js`・`i18n.js`）

- 辞書は日英で同じキーを持ちます。HTMLの文言は`data-i18n`（文字）と`data-i18n-attr`（`aria-label`などの属性）で辞書のキーを指し、HTMLに書いた既定の文は日本語の値と同じにしておきます（`test/i18n.test.js`で検査）
- 最初の言語は、URLの`?lang=` → 保存した選択（localStorage）→ ブラウザーの言語（日本語なら日本語、それ以外は英語）の順で決めます
- 切り替えたときは、計算をやり直さず、同じ状態で描き直します。候補の会社名と説明は検索したときの言語のままで、検索し直すと新しい言語になります
- 区切り文字（「・」と「, 」）や、比率・年の書き方も言語ごとに分けています

---

## 保存と読み込み

JSONの形（version 3）:

```json
{
  "app": "reverse-logo-hunt",
  "version": 3,
  "savedAt": "2026-10-09T12:00:00.000Z",
  "images": [{ "id": "img-1", "name": "board.jpg", "width": 1400, "height": 900, "scale": 1, "exif": { "lat": 35.68, "lng": 139.77 }, "dataUrl": "data:image/png;base64,…" }],
  "logos": [{
    "id": "logo-2", "imageId": "img-1", "x": 106, "y": 126, "w": 548, "h": 215, "source": "manual",
    "ocrText": "Nintendo", "queries": ["Nintendo"], "query": "Nintendo", "status": "done",
    "candidates": [{ "qid": "Q8093", "rank": 1, "label": "任天堂", "isOrg": true, "hq": { "label": "京都市", "coord": { "lat": 35.01, "lng": 135.77 } },
      "logo": { "file": "Nintendo.svg", "thumburl": "https://thumb.wikimedia.org/…", "artist": "Nintendo", "license": "Public domain" },
      "match": { "shape": 0.9, "structure": 0.8, "aspect": 0.95, "color": 0.7, "total": 0.84 }, "combined": 0.93 }],
    "selectedQid": "Q8093", "selectedBy": "auto"
  }]
}
```

`sanitizeWorkspace`は、知っている項目だけを型と範囲を確かめて組み直します。

- 画像は`data:image/(png|jpeg|webp);base64,…`だけ（SVGやHTMLは拒否）。50枚まで
- QIDは`isQid`に合うものだけ。座標は緯度±90・経度±180の範囲
- URLは、サムネイルが`thumb.wikimedia.org`か`upload.wikimedia.org`のhttps、出典ページが`commons.wikimedia.org/wiki/`のhttpsだけ
- 領域の座標は整数にし、画像からはみ出す分は切り詰める
- 旧版（version 2）は、選ばれていた会社を候補1件として読み替えます。旧版の`creditHtml`（HTML）は捨てます

---

## 安全対策

### Content Security Policy（`index.html`）

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net;
style-src 'self' https://unpkg.com 'sha256-pgvDUBa4IjFA2yuSJ2cqcyxmNYJMborsd0ORcRv9vw8=';
img-src 'self' data: blob: https://thumb.wikimedia.org https://upload.wikimedia.org https://tile.openstreetmap.org;
font-src 'self';
connect-src 'self' data: https://www.wikidata.org https://query.wikidata.org https://commons.wikimedia.org https://cdn.jsdelivr.net;
worker-src 'self' blob:;
object-src 'none'; base-uri 'none'; form-action 'none'
```

- `'wasm-unsafe-eval'`: Tesseract.jsのWASMのため。`'unsafe-eval'`は使いません
- `style-src`のハッシュ: Cytoscape.js 3.28.1が起動時に差し込む1行`.__________cytoscape_container { position: relative; }`だけを許します
- `connect-src`の`data:`: Tesseract.jsのコアが中に埋め込んだWASMを`data:` URLで読むため（Firefoxで必要）
- `worker-src blob:`: Tesseract.jsはワーカーをblob URLで作ります。blobのワーカーはページのCSPを受け継ぐので、言語データの取得先（jsDelivr）を`connect-src`に入れています
- `frame-ancestors`はmetaでは無視されるので書いていません

### SRI

| ファイル | ハッシュ |
|:--|:--|
| leaflet@1.9.4/dist/leaflet.css | sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY= |
| leaflet@1.9.4/dist/leaflet.js | sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo= |
| cytoscape@3.28.1/dist/cytoscape.min.js | sha384-J7Q85oZE4GJ/e7+n2aOQsLXfDwwfnA8S2nZAL5BpFsfpCF84zQD7LroZ/dMnLgex |
| tesseract.js@5.0.5/dist/tesseract.min.js | sha384-sZlPHqJ8Pk1GMyFXfg9vOgDjyUZZe7wE2c0NoPg2z1vs2fmI4wOC0O1ONVyr73qa |
| exifreader@4.23.5/dist/exif-reader.js | sha384-lV3Kc4L1YkqB4DCasecdSWo5RQEXp9Mc9eeiV6opSzVKpk2Id2jELgNodSyTCDqq |

実ファイルから計算し、jsDelivrのAPIが示すSHA-256と一致することを確かめました（2026-10-09）。Tesseract.jsのワーカー・コア・言語データは、ライブラリーが内部で読み込むためSRIを付けられません（版を固定したjsDelivrから読みます）。

### 表示

- 外部から来た文字列（会社名・説明・作者・ファイル名・OCRの文字）は、すべて`textContent`か`createElement`で入れます。`innerHTML`は使いません（`test/html.test.js`で検査）
- 地図のポップアップもDOMで組み立てます

---

## テストと確かめ方

`npm test`（Node.js 22以上、依存なし）

| ファイル | 内容 |
|:--|:--|
| `test/logo-match.test.js` | 合成画像で、紙・灰色の地・暗い地でも本物が1位になる、白抜き、色だけ違う偽物 |
| `test/brand-text.test.js` | 検索語の候補（略称・日本語・商標記号・文字の高さ） |
| `test/wikidata-core.test.js` | 実際の応答（`test/fixtures/`）での解析、QIDの検証、関係の向き |
| `test/commons-core.test.js` | 実際の応答での解析、HTMLから文字を取り出す、URLの検証 |
| `test/exif-core.test.js` | ExifReaderの出力の形（京都・シドニー・リオ） |
| `test/candidate-rank.test.js` | 総合と並べ方 |
| `test/session-core.test.js` | JSONの検証と往復 |
| `test/roi-suggest.test.js` | 自動で囲む処理 |
| `test/ocr-prep.test.js` | 拡大・反転・枠の除去 |
| `test/html.test.js` | CSP・SRI・Referer・innerHTMLを使わないこと・主な要素 |
| `test/contrast.test.js` | ダーク・ライトの配色のコントラスト比 |
| `test/format.test.js` | 行の長さ・行数・見えない文字 |
| `test/group-core.test.js` | 共通の親（実際の応答、段の上限、終わった関係） |
| `test/geo.test.js` | 距離と方角 |
| `test/i18n.test.js` | 日英の辞書（同じキー・差し込み・英語に日本語なし・HTMLとの一致） |
| `test/readme.test.js` | README（日英）の構造・表記・数値 |

ブラウザーでの確認（Playwright、リポジトリの外のスクリプト）では、Chromium・Firefoxで次を確かめています。

- 看板の画像を囲んで解析し、CSP違反とコンソールのエラーが0件
- 幅1280・390・320pxとダーク・ライトで、横あふれと44px未満の操作要素が0件、390pxでタッチで領域を囲める
- EXIFのGPSを読み、地図に本社と撮影地点を出す
- JSONを書き出して読み込み直すと、選んだ候補と「手動」の区別が残る

---

## 限界と今後

- 日本語のOCRは横書きだけです（縦書きのデータは読み込みません）
- 文字のないロゴは、検索語を手で入れる必要があります
- 終了の年が書かれていない関係は、今も続いているとみなします。共通の親は3段上までです
- 照合は、遠近の歪みや一部が隠れたロゴに弱い方式です（射影の補正や特徴点の対応づけは入れていません）
- 地図のタイルの地名は、画面の言語にかかわらずOpenStreetMapの現地の言語です
