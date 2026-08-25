# NERO Favorite Reader 🌙

`ネロのお気に入り🌙` 専用の独立 Swipe Reader です。ほかのReaderとはコード・Worker・Firefox拡張機能IDを共有しません。

## 安全設計
- `nero` を含まないホストを拡張機能の接続先にできないビルドガード
- Firefox拡張機能IDを `nero-swipe-reader@local.invalid` として分離
- note のCookie・セッション・パスワードをリポジトリやWorkerへ保存しない
- マガジン名は **`ネロのお気に入り🌙` の完全一致**のみ
- 追加処理は12秒間隔、失敗時は即停止・自動再試行なし
- 初回にFirefoxでログイン中のnoteアカウントを端末へ固定し、以後は一致確認
- サイトは `noindex, nofollow, noarchive`
- GitHub Actionsは使用しない

## 構成
- `packed/` — Reader本体とBridgeの大きいソースをgzip+base64分割で保存（SHA-256検証付き）
- `scripts/materialize-sources.mjs` — `packed/` から `src/worker.js` とBridge本体を完全復元
- `extension/` — Firefox Bridgeテンプレート。公開URLは未固定
- `scripts/build-extension.mjs` — 新Reader URLを安全に埋め込む
- `tests/safety-check.mjs` — 秘密情報・安全装置を検査
- `wrangler.jsonc` — 独立Worker `nero-swipe-reader`

## ローカル検査
```bash
npm run materialize
npm run check
node --check src/worker.js
node --check extension/background.js
node --check extension/reader-bridge.js
node --check extension/note-bridge.js
```

## 公開順序
1. 新しい独立WorkerとしてReaderを公開
2. 公開された新Reader URLを `READER_ORIGIN` に設定
3. Bridgeをビルド
4. Mozilla署名を通したXPIだけを配布

```bash
READER_ORIGIN=https://NEW-READER-ORIGIN.example npm run build:extension
READER_ORIGIN=https://NEW-READER-ORIGIN.example npm run package:extension
```

> ZIPはソース/署名前パッケージです。Android版Firefoxの通常利用にはMozilla署名済みXPIが必要です。

## 注意
noteの書き込み処理はnote公式公開APIではなく、Webクライアントで観測される非公式エンドポイントに依存します。仕様変更時は安全側に停止させます。

## GitHub転送の完全性
大きい4ソースはGitHub連携の転送途中で切れないよう、`packed/manifest.json` のSHA-256と元バイト数を照合してから復元します。ハッシュが一致しない場合、ビルド・デプロイは停止します。
