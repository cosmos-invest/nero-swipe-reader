# NERO Favorite Reader 🌙

`ネロのお気に入り🌙` 専用の独立 Swipe Reader です。ほかのReaderとはコード・Worker・Firefox拡張機能IDを共有しません。

## 安全設計

- `nero` を含まないホストを拡張機能の接続先にできないビルドガード
- Firefox拡張機能IDを `nero-swipe-reader@local.invalid` として分離
- note のCookie・セッション・パスワードをGitHubへ保存しない
- 自動運転用セッションはCloudflare Secret/KVだけに置き、KV保存時はAES-GCMで暗号化
- マガジン名は **`ネロのお気に入り🌙` の完全一致**のみ
- 追加処理は12秒間隔、失敗時は即停止・自動再試行なし
- noteアカウントを毎回 `NERO_URLNAME` と照合
- サイトは `noindex, nofollow, noarchive`
- GitHub Actionsは使用しない。定期実行はCloudflare Worker Cronのみ

## 構成

- `packed/` — Reader/Bridge/自動運転Workerの大きいソースをgzip+base64分割で保存（SHA-256検証付き）
- `scripts/materialize-sources.mjs` — `packed/` から実行ソースを完全復元
- `extension/` — Firefox Bridgeテンプレート。公開URLは未固定
- `scripts/build-extension.mjs` — 新Reader URLを安全に埋め込む
- `tests/safety-check.mjs` — 秘密情報・接続先・安全装置を検査
- `wrangler.jsonc` — 独立Reader Worker `nero-swipe-reader`
- `automation/worker.js` — 自動スキ + 自動マガジン追加専用Worker（materialize時に復元）
- `docs/AUTOMATION.md` — Cloudflare Cron / KV / Secret の導入手順

## ローカル検査

```bash
npm run check
```

## Reader公開順序

1. 新しい独立WorkerとしてReaderを公開
2. 公開された **新Reader URL** を `READER_ORIGIN` に設定
3. Bridgeをビルド
4. Mozilla署名を通したXPIだけを配布

```bash
READER_ORIGIN=https://NEW-READER-ORIGIN.example npm run build:extension
READER_ORIGIN=https://NEW-READER-ORIGIN.example npm run package:extension
```

> ZIPはソース/署名前パッケージです。Android版Firefoxの通常利用にはMozilla署名済みXPIが必要です。

## 自動運転

自動スキと `ネロのお気に入り🌙` への自動追加はReaderとは別の `nero-engagement-worker` で動かします。

- 毎時0分のCloudflare Cron
- JST 08:00〜22:59
- 1回最大1記事、1日最大15記事
- 自己紹介・初心者・挑戦・交流・日常・創作系の候補を優先
- 強い勧誘、相互フォロー/スキ返し目的、ギャンブル系を除外
- スキ後12秒待ってマガジン追加
- 同一クリエイター7日、同一記事30日の再処理をKVで抑止
- 認証不一致や書き込み失敗でサーキットブレーカーを発動し、明示的な `/resume` まで停止

詳細は `docs/AUTOMATION.md` を参照してください。

## 注意

noteの書き込み処理はnote公式公開APIではなく、Webクライアントで観測される非公式エンドポイントに依存します。仕様変更時は安全側に停止させます。

## GitHub転送の完全性

大きいソースはGitHub連携の転送途中で切れないよう、`packed/manifest.json` のSHA-256と元バイト数を照合してから復元します。ハッシュが一致しない場合、ビルド・デプロイは停止します。
