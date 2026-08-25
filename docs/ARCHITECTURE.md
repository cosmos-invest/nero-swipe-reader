# Architecture

## Reader Worker
公開記事の検索・本文取得を行う読み取り系Worker。ログインCookieは持たない。ルートは常にNEROモードで、検索エンジンには掲載しない。

## Firefox Bridge
`note.com` と新NERO Readerの2 originだけを許可する。noteへの書き込みはFirefox内の本人セッションで実行し、Reader WorkerへCookieを送らない。

## Magazine add
対象名は `ネロのお気に入り🌙` 完全一致。現在ログイン中のurlnameと端末固定アカウントを照合し、無料マガジンだけを対象にする。12秒間隔の直列キューで、失敗時は停止する。

## Separation boundary
ほかのReaderのoriginはBridgeの許可originに入れない。拡張IDも専用にして更新経路を分離する。
