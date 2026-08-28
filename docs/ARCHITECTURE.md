# NERO Favorite Reader Architecture v0.1.44

## 1. 目的

v0.1.44では、Readerページに複数のcontent scriptと個別DOMイベントBridgeを追加していく構造をやめ、ページ側の通信口を1本に統一する。

## 2. Reader → Firefox

Readerページで実行する拡張content scriptは `extension/app-bridge.js` のみ。

```text
GitHub Pages UI
  ↓ nero-app-request
app-bridge.js
  ├─ 長い取得 → NERO_APP_V2 Port → app-api-router.js
  └─ 既存自動化 → runtime.sendMessage → local-auto.js / return-likes-v141.js
```

ページ側から見る通信APIは `nero-app-request / nero-app-result / nero-app-progress` に統一する。

`NERO_APP_V2` はコメント走査中に接続を維持し、進捗・結果を同じPortで返す。Portが切断された場合、content scriptは段階的に再接続する。

## 3. Background API

- `app-api-core.js` — 共通処理、認証確認、記事本文、マガジン追加、キャッシュ
- `app-api-inbox.js` — 返信待ちコメントの差分走査と返信
- `app-api-priority.js` — コメント相手の集計と最新記事取得
- `app-api-router.js` — Portリクエストのルーティング
- `local-auto.js` — 既存の自動運転 / 過去スキ整理
- `return-likes-v141.js` — 1分間隔スキ返し補助、対象一覧

note.com上では既存 `note-bridge.js` を使用する。

## 4. 返信待ち判定

コメントを `threadIndex` ごとにグループ化する。各スレッドで本人の最後の返信位置を求め、その位置より後にある他ユーザーのコメントを返信待ちとする。

**`creatorLiked` は返信待ち判定に使用しない。**

したがって、本人がコメントへスキしていても返信していなければ返信待ちに残る。

## 5. 差分走査

初回または「全件再確認」だけ全対象を確認する。通常更新では以下を再確認する。

- コメント数が変化した記事
- 返信待ちが残っている記事
- キャッシュが古い記事
- キャッシュが存在しない記事

コメント取得は最大2並列。一定件数ごとに途中結果を `browser.storage.local` へ保存する。

## 6. UI

GitHub Pagesは5画面に分割する。

1. Home
2. Comments
3. Read
4. Return
5. Manage

初期表示で重い走査は開始しない。Homeでは接続診断と端末内キャッシュの状態だけを読み込む。

## 7. 接続状態

以下を別々に扱う。

- Firefox拡張Bridgeが接続済みか
- 拡張バージョンが必要条件を満たすか
- noteアカウント確認が成功したか

3つを満たした場合だけUIに「接続正常」と表示する。
