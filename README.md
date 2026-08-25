# NERO Favorite Reader 🌙

`ネロのお気に入り🌙` 専用の独立 Swipe Reader です。Cloudflareやユーザー定義GitHub Actionsを使わず、GitHub Pages + Firefox拡張で動かします。

## 公開Reader

- GitHub Pages: `https://cosmos-invest.github.io/nero-swipe-reader/`
- Pagesの役割: Reader画面、検索、スキ/コメント/フォロー/マガジン追加操作、自動運転の状態確認
- 自動運転: Firefox拡張の `browser.alarms` が担当。Pagesを閉じていてもFirefoxが稼働していれば継続

## 自動運転 v0.1.32

- 5分おきに候補を1件処理
- `ネロのお気に入り🌙` への追加は直近60分で最大10件
- 通常はスキ後12秒待ってマガジン追加
- スキ制限時はスキだけ1時間休止し、マガジン追加は継続
- 認証不一致やマガジン側異常は全体停止
- 実行状態・履歴はFirefox `browser.storage.local` のみ

## 安全設計

- noteのCookie・セッション・パスワードをGitHub/Pagesへ保存しない
- マガジンは **`ネロのお気に入り🌙` 完全一致**のみ
- Firefox拡張IDを `nero-swipe-reader@local.invalid` として分離
- Bridgeは正規GitHub Pages URLのパスへ固定可能
- `.github/workflows` は置かない
- Cloudflareは使用しない

## GitHub Actionsの扱い

ユーザー定義workflowはありません。GitHub Pagesはbranch公開でもGitHub側のPages deployment workflowが内部で実行されますが、このリポジトリはPublicなので標準GitHub-hosted runnerの課金対象Actions分数は0です。

## Bridgeビルド

正規Pages URLが既定値なので、そのままビルドできます。

```bash
npm run check
npm run build:extension
npm run package:extension
```

別URLへ切り替える場合のみ `READER_URL` を指定します。

```bash
READER_URL=https://nero.example.com/ npm run build:extension
```

Android版Firefoxの通常インストールにはMozilla署名済みXPIが必要です。

## GitHub Pagesの公開設定

Repository Settings → Pages → Build and deployment → Source を **Deploy from a branch** にし、Branch **main /docs** を選びます。リポジトリにはユーザー定義のGitHub Actions workflowを追加しません。

## 検査

```bash
npm run check
```

詳細は `docs/LOCAL_AUTOMATION.md` を参照してください。
