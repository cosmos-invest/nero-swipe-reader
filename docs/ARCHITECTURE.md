# Architecture

## GitHub Pages Reader
`main/docs` を静的配信するNERO専用Reader。検索・スワイプ閲覧・操作ボタン・自動運転の状態表示だけを担当し、noteのCookieやセッションは保持しません。正規URLは `https://cosmos-invest.github.io/nero-swipe-reader/` です。

## Firefox Bridge
GitHub Pages Readerと `note.com` の間だけをつなぎます。noteへのスキ、コメント、フォロー、`ネロのお気に入り🌙` への追加はFirefox内の本人ログイン状態で実行します。認証情報をGitHub Pagesや外部サーバーへ送りません。

## Firefox local automation
`browser.alarms` で5分おきに起動します。1回につき候補1記事、マガジン追加は直近60分で最大10件です。通常はスキ後12秒待ってマガジン追加します。

スキが429または回数制限になった場合はスキ回路だけを1時間休止し、マガジン追加は5分おきに継続します。認証不一致やマガジン追加異常の場合だけ全体停止します。

指定記事へのスキ返しは別alarmで管理し、返礼済みユーザーを端末内で永続的に重複排除します。コメント相手の最新記事リストは、明示的な初回設定後にPagesのlocalStorageへ保存し、6時間ごとに差分更新します。

## Magazine add
対象名は `ネロのお気に入り🌙` 完全一致。現在ログイン中のurlnameと端末固定アカウントを照合し、無料マガジンだけを対象にします。

## State and privacy
自動運転ON/OFF、端末固定アカウント、処理履歴、スキ休止時刻はFirefox `browser.storage.local` に保存します。note Cookieやセッション値は保存しません。

## Separation boundary
Cloudflareとユーザー定義GitHub Actions workflowは使用しません。GitHub Pages公開時にGitHub内部のPages deployment workflowは実行されますが、Publicリポジトリの標準runnerなので課金対象Actions分数は0です。ほかのReaderのoriginは許可せず、拡張IDもNERO専用にして更新経路を分離します。
