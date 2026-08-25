# Security Policy

NERO Swipe Readerは、noteのログイン情報を外部サーバーへ保存しない設計です。

## Firefoxローカル自動運転

- 自動スキ / マガジン追加はFirefox拡張のバックグラウンド内で実行
- Cookieやnoteセッション値を `browser.storage.local` へコピーしない
- 保存するのは実行履歴、固定したurlname、停止状態、スキ休止期限のみ
- 初回ON時のnoteアカウントを固定し、以後不一致なら全体停止
- マガジン名は `ネロのお気に入り🌙` 完全一致のみ
- スキのレート制限時はスキAPIを1時間休止し、マガジン追加だけ継続
- 認証不一致・マガジン結果不明・マガジン通信失敗はサーキットブレーカーで停止

## GitHub

- GitHub Actionsは使用しない
- `.env`, `.dev.vars`, Cookie, API token等をコミットしない
- Publicリポジトリには処理コードだけを置く

## 外部サービス

Cloudflareはローカル自動運転には不要です。GitHub Pagesを使う場合も静的UIのみで、note認証情報はPagesへ渡しません。
