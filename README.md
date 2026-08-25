# NERO Swipe Reader

NERO専用のSwipe ReaderとFirefox Bridgeです。

## 自動運転

v0.1.31から、自動スキと `ネロのお気に入り🌙` への自動追加は **Firefox拡張内だけ** で動きます。

- 5分おきに候補を1件処理
- 直近60分でマガジン追加最大10件
- スキ成功後は12秒待ってマガジン追加
- スキ制限に当たった場合はスキだけ1時間休止
- スキ休止中もマガジン追加は5分おきに継続
- noteログインアカウント完全一致
- マガジン名 `ネロのお気に入り🌙` 完全一致
- マガジン側の失敗・認証不一致は全体停止
- 履歴と状態はFirefox端末内 `browser.storage.local` のみ

詳細: [docs/LOCAL_AUTOMATION.md](docs/LOCAL_AUTOMATION.md)

## 外部実行基盤

自動運転にCloudflareは使いません。GitHub Actionsも使いません。

GitHub PagesはReaderの静的UIを公開したい場合に利用できますが、定期実行やnote書き込みはPagesではなくFirefox拡張が担当します。

## ビルド

```bash
npm install
npm run check
READER_ORIGIN=https://<NERO専用HTTPSホスト> npm run build:extension
npm run package:extension
```

通常のAndroid Firefoxへ恒久インストールする場合は、生成ZIPとは別にMozilla署名済みXPIが必要です。

## セキュリティ

- note Cookie / セッション値をGitHubへ保存しない
- 外部サーバーへnote認証情報を送らない
- 自動運転のアカウントは初回ON時に端末へ固定
- 対象マガジンは `ネロのお気に入り🌙` 完全一致のみ
- マガジン追加結果不明時は自動停止
- `.github/workflows` は作成しない

> noteへの操作は公式公開APIではなく、Webクライアントで観測されるエンドポイントに依存します。仕様変更時は安全側に停止します。
