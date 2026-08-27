# NERO Favorite Reader 🌙

`ネロのお気に入り🌙` 専用の独立 Swipe Reader です。Cloudflareやユーザー定義GitHub Actionsを使わず、GitHub Pages + Firefox拡張で動かします。

## 公開Reader

- GitHub Pages: `https://cosmos-invest.github.io/nero-swipe-reader/`
- Pagesの役割: Reader画面、検索、スキ/コメント/フォロー/マガジン追加操作、自動運転、過去スキ整理、履歴表示
- 自動運転: Firefox拡張の `browser.alarms` が担当。Pagesを閉じていてもFirefoxが稼働していれば継続

## 記事本文表示 v0.1.40

検索結果やコメント最優先リストからReaderを開始すると、概要文だけではなくnote記事の本文をカード内へ読み込みます。

- note API v3から表示中の記事本文を取得
- 見出し、段落、改行、リスト、引用、リンクをReader内で再現
- 本文中の画像・GIF・figure/figcaptionを表示
- コードブロックもReader向けに整形
- script/style/noscriptは破棄し、URLのプロトコルを検証してからDOMを再構築
- 本文取得に失敗した場合は従来の概要文へ自動フォールバック
- 記事取得はFirefox拡張側で行い、Cookieや本文をGitHub Pagesへ保存しない

## 自動運転 v0.1.39

- 5分おきに候補を1件処理
- `ネロのお気に入り🌙` への通常自動追加は直近60分で最大10件
- 通常はスキ後12秒待ってマガジン追加
- スキ制限時はスキだけ1時間休止し、マガジン追加は継続
- 認証不一致やマガジン側異常は安全側に停止
- 処理履歴はFirefox `browser.storage.local` に最大2,000件・最長365日保存

## 過去スキの一括整理

v0.1.33では、ログイン中のNEROアカウントが過去にスキした記事を読み取り、`ネロのお気に入り🌙` へ一度だけ整理できます。

- 過去スキを全ページ走査
- 同じ記事は重複排除
- 12秒以上あけて順番にマガジン追加
- すでにマガジン入りの記事は `追加済み` としてスキップ
- 同期中だけ通常自動運転を一時停止し、完了後に元のON/OFFへ復帰
- 進捗を端末内へ逐次保存し、Firefox再起動後も続きから再開
- バックフィル件数は通常自動運転の「直近60分10件」には含めない

## コメント最優先リスト

v0.1.39では、直近30日にコメントをくれた人を確認し、1人1件の最新記事を最優先リストへ設定できます。

- 初回は「コメント相手を更新」を押したときだけ確認
- 設定後はFirefoxで6時間ごとに差分更新
- コメント日時が新しい人を優先
- 同じ人は最新記事1件だけ
- ユーザー名と最新記事一覧は利用中のFirefox端末内だけに保存

## 指定記事へのスキ返し

`https://note.com/nero_notelover/n/ne4843208abbe` にスキまたはコメントをくれた人を取得し、その人の最新記事へ1人1回だけスキを返します。

- コメントをくれた人を先に処理
- 新しいスキは5分に1件
- すでにスキ済みの記事は待たずに次の人へ進む
- 返礼済みのユーザー名をFirefox端末内へ保存し、次回確認でも重複返礼しない
- noteのスキ制限を検知したら1時間休止し、自動再開

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
