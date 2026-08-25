# Security policy

- Cookie、noteセッション、パスワード、API tokenをコミットしない。
- `.env`, `.dev.vars`, `dist/` はコミット対象外。
- `READER_ORIGIN` は必ず新しいNERO ReaderのHTTPS originを指定する。
- 旧NERO Reader originへのBridge接続は禁止し、ビルドスクリプトが拒否する。
- noteへの変更操作は本人のFirefoxログイン状態を使い、外部サーバーへ認証情報を転送しない。
- 書き込み失敗・認証不一致・対象マガジンの曖昧さを検出した場合は停止する。
