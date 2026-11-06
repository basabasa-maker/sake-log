# 日本酒ログ

ラベル・瓶を撮影すると、AIが銘柄を読み取り、さけのわの評価と唎酒師の項目（10段階）を出す。iPhone専用のPWA。個人利用のみ。

## 構成
- 画面: GitHub Pages（このリポジトリ直下）。`index.html` / `css` / `js` / `vendor`（Fuse.js、browser-image-compression）
- 連携: Googleアプリスクリプト `gas/Code.gs`（AI呼び出し・スプシ保存・写真保存・料金ログ）
- データ: ドライブ「日本酒テイスティングログ」（記録）。さけのわは `data/sakenowa.json`（手元に保持）
- 記録は `gas` のスクリプトプロパティ `SHEET_ID` の先に書く。試験は「_テスト用」のスプシで行い、本番に試験データを書かない

## 鍵と合言葉（コードに書かない）
スクリプトプロパティ: `ANTHROPIC_KEY` / `TOKEN`（合言葉）/ `SHEET_ID` / `USDJPY`（任意、既定155）。
合言葉はiPhoneのアプリ「設定」に入れる。合言葉のない呼び出しはすべて断る。

## 更新
- さけのわを更新: `python3 build/update-sakenowa.py`（月1回ほど）
- GASを更新: `cd gas && clasp push -f`、続けて `clasp deploy -i <デプロイID>`
- 画面を更新したら `sw.js` の `V` と、`index.html` の `?v=` を上げる

## 守ること
- 開発方針: 共通ナレッジ `システム手帳_開発方針.md`（横ずれ・バウンド・ヘッダー固定・保存は差分のみ）
- アイコンは絵文字ではなく画像（ChatGPTで作成）
- 表記: 「さけのわデータを利用しています」とsakenowa.comへのリンクを常に出す
- 唎酒師の項目は10段階。旧データ（1〜3段階）は読み込み時に換算して表示し、保存で10段階に更新する

## クレジット
さけのわデータ（https://sakenowa.com/）

## GASの注意（2026-11-06）
- 権限は `drive.file` のみ。`DriveApp` は使えない（フォルダ検索・作成で権限エラー）。写真はDrive Web API（`driveApi_`）で保存し、フォルダIDはスクリプトプロパティ `PHOTO_FOLDER_ID` に持つ。
- 差分保存: 送られてきた項目だけ書く。`確定項目`・`推定値JSON`・`評価尺度` は、送られたときだけ書く（部分更新で消さない）。
- GASを直したら `clasp push -f` のあと `clasp deploy -i <ID>` まで必ず行う。反映に10〜20秒かかる。
