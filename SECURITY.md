# Security policy

- Cookie、noteセッション、パスワード、API tokenをGitHubへコミットしない。
- `.env`, `.dev.vars`, `dist/`, `.wrangler.automation.generated.jsonc` はコミット対象外。
- Reader用Firefox Bridgeの `READER_ORIGIN` は必ず新しいNERO ReaderのHTTPS originを指定する。
- 自動運転用の `NOTE_SESSION_COOKIE`, `STATE_ENCRYPTION_KEY`, `NERO_URLNAME`, `ADMIN_TOKEN` はCloudflare Secretだけに登録する。
- 更新されたnoteセッションをKVへ保存する場合は、`STATE_ENCRYPTION_KEY` を使ってAES-GCMで暗号化する。
- 自動運転は毎回 `NERO_URLNAME` とnoteの現在ログインアカウントを完全一致確認してから書き込む。
- 対象マガジンは `ネロのお気に入り🌙` の完全一致1件かつ無料マガジンだけ許可する。
- 1回最大1記事、1日最大15記事、スキからマガジン追加まで12秒待機する。
- 認証不一致・書き込み失敗・対象マガジンの曖昧さを検出した場合はサーキットブレーカーを発動し、明示的な `/resume` まで停止する。
- GitHub Actionsは使用しない。定期実行はCloudflare Worker Cronだけを使う。
