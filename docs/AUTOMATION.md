# NERO 自動スキ + 自動マガジン追加

`nero-engagement-worker` は GitHub Actions を使わず、Cloudflare Worker Cron だけで動く独立Workerです。

## 動作

- 毎時0分にCron起動
- JST 08:00〜22:59のみ実行
- 1回につき最大1記事、1日最大15記事
- `はじめてのnote / note初心者 / 初投稿 / 自己紹介 / 挑戦 / 日常 / noteを楽しむ / 創作` から候補を巡回
- 強い勧誘・相互フォロー/スキ返し目的・ギャンブル系は除外
- noteログイン中のアカウントが `NERO_URLNAME` と完全一致することを毎回確認
- スキ済みなら二重スキせず、そのままマガジン追加へ進む
- スキ後12秒待って、`ネロのお気に入り🌙` に追加
- マガジンは完全一致1件・無料マガジンだけ許可
- 同一クリエイター7日、同一記事30日の再処理をKVで抑止
- 認証不一致・書き込み拒否・追加結果不明などはサーキットブレーカーで自動停止
- `/resume` を明示的に呼ぶまで自動再開しない

## GitHub Actions

`.github/workflows` は作成しません。定期実行はCloudflare Cronのみです。

## Cloudflare側だけに置く値

GitHubへは保存しません。

- `NOTE_SESSION_COOKIE` — `_note_session_v5` の値またはCookie文字列
- `STATE_ENCRYPTION_KEY` — 32バイトをBase64化した暗号鍵
- `NERO_URLNAME` — ネロのnote urlname
- `ADMIN_TOKEN` — `/health`, `/run`, `/pause`, `/resume` 用Bearer token

KVには更新されたnoteセッションをAES-GCM暗号化して保存します。

## 初回セットアップ

1. CloudflareでWorkers KV namespaceを1つ作成し、namespace idを取得。
2. `NERO_KV_NAMESPACE_ID=<32桁ID>` をローカル環境へ設定。
3. `NERO_AUTO_ENABLED=false npm run deploy:automation` で書き込み停止状態のWorkerを先に公開。
4. 次を1つずつ登録。

```bash
npm run secret:automation -- NOTE_SESSION_COOKIE
npm run secret:automation -- STATE_ENCRYPTION_KEY
npm run secret:automation -- NERO_URLNAME
npm run secret:automation -- ADMIN_TOKEN
```

暗号鍵の例:

```bash
openssl rand -base64 32
```

5. `/health` で設定確認後、`NERO_AUTO_ENABLED=true npm run deploy:automation` で自動運転を有効化。

## 管理API

すべて `Authorization: Bearer <ADMIN_TOKEN>` が必要です。

- `GET /health` — 現在状態と直近実行
- `POST /run` — 手動で1回実行
- `POST /pause` — 即時停止
- `POST /resume` — サーキットブレーカー解除

## 注意

noteへの書き込みは公式公開APIではなく、Webクライアントで観測される非公式エンドポイントに依存します。仕様変更時に無理な再試行はせず停止する設計です。
