# 生活ログ / Life-log

端末内に生活・健康の記録を保存する、ビルド不要のGitHub Pagesアプリです。

- 服薬、睡眠、飲酒、体温、体重、不正出血、日記・体調メモ、予定を記録できます。
- 設定 → 表示テーマで、従来のDADS風「スタンダード」と「日記・タイムライン」を選べます。初期設定は従来テーマです。
- ログイン・解析サービス・外部フォントはありません。健康情報の通信処理はなく、CSPでも外部通信と接続APIを制限しています。
- 設定からJSONバックアップを端末に保存できます。復元は従来どおり同じIDを上書きする統合方式です。復元前にもバックアップを保存してください。

## 開発・テスト

```sh
npm ci
npx playwright install --with-deps chromium
python3 -m http.server 8000 --bind 127.0.0.1
# 別ターミナル
npm run check
npm test
```

ブラウザで http://127.0.0.1:8000 を開きます。ビルドは不要です。npm依存関係はテスト・整形専用で、本体から読み込みません。システムのChromiumがない環境ではPlaywrightのブラウザを使います。`CHROMIUM_PATH`で指定も可能です。

テストは使い捨てのブラウザと架空データを使用し、利用者のブラウザ・データにはアクセスしません。GitHub Actionsでも同じ検査を実行します。mainへのマージと公開操作はレビュー・検査結果の確認後に行ってください。

## 構成・保存互換性

- `index.html`: 各画面・入力ダイアログ
- `app.js`: 表示、入力検証、集計、IndexedDB、バックアップ
- `style.css`: 共通スタイル、従来テーマ、`data-theme="diary"`の追加テーマ
- `sw.js`: 同一アプリのシェルのみをキャッシュしてオフライン起動
- `tests/browser.cjs`: Chromiumでの回帰・アクセシビリティ検査

IndexedDBは従来と同じ`life-log`、version `1`、`records`ストア（keyPath: `id`）です。移行・削除処理は追加していません。日記も従来の`type: "note"`と`data.name`・`data.memo`を使います。テーマ設定だけをlocalStorageの`life-log-theme`に保存します。

Web版の保存先はオリジンに依存します。今後Capacitor化する際、Web版のIndexedDBはAndroidへ自動移行されません。既存JSONのエクスポート・インポートを使う移行導線と、実機WebViewの別途検証が必要です。現時点ではCapacitorは導入していません。

更新したService Workerは旧画面との混在を避けるため、開いている旧版のタブ・PWAをすべて閉じた後に有効になります。IndexedDBの記録はそのまま残ります。

調査結果・検証範囲・参考資料は[変更レポート](docs/theme-review.md)を参照してください。
