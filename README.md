# VRT AI - AI-Powered Visual Regression Testing

WebP ベースの AI 駆動型ビジュアル回帰テストシステム。Playwright でスクリーンショット取得、Python + PyTorch で高度な画像比較を行う。

## 構成

- **capture** (`packages/capture/`) - Node.js + Playwright でスクリーンショット取得
- **compare** (`packages/compare/`) - Python + PyTorch でビジュアル比較

## セットアップ

### 前提条件
- Node.js 18+
- Python 3.9+
- pip

#### Node.jsのインストールについて

```bash
# Node.jsの確認
which node
```

コマンドが見つからない場合は、Volta経由でのNodeのインストールを推奨
- https://volta.sh/

#### Pythonのインストールについて

```bash
# pythonの確認
which python3
```

コマンドが見つからない場合は、HomeBrew経由でのpythonのインストールを推奨

```bash
# pythonのインストール
brew install python
```

### インストール

```bash
# Node.js パッケージをインストール
npm install

# Playwright ブラウザをダウンロード
npx playwright install

# Python 環境を作成・有効化
cd packages/compare
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 使用方法

### 1. キャプチャ対象 URL を設定

`packages/capture/targets.json` を編集（URL のリストのみ）：

```json
[
  "https://example.com",
  "https://example.com/about",
  "https://example.com/contact"
]
```

**ファイル名は URL のパスから自動生成されます：**
- `https://example.com/` → `home.webp`
- `https://example.com/about` → `about.webp`
- `https://example.com/contact` → `contact.webp`

### 2. ベースラインスクリーンショット取得

```bash
npm run capture:baseline
```

スクリーンショットは `packages/capture/baseline/` に WebP 形式で保存されます。

### 3. 候補画像スクリーンショット取得

```bash
npm run capture:candidate
```

スクリーンショットは `packages/capture/candidate/` に WebP 形式で保存されます。

### 4. 比較実行

基本的な比較（OK の場合は差分画像なし）：
```bash
npm run compare
```

すべてのステータスで差分画像を生成：
```bash
npm run compare -- --all
```

結果は `packages/compare/results/comparison_results.json` に出力されます。
差分画像は `packages/compare/results/{画像名}/diff.png` に保存されます。

## 結果の見方

```json
{
  "name": "example-home",
  "overall_similarity": 0.958,
  "global_similarity": 0.945,
  "avg_tile_similarity": 0.971,
  "status": "CHECK",
  "tile_size": 8,
  "diff": {
    "image_path": "diff.png",
    "diff_ratio": 2.34,
    "diff_pixels": 356640,
    "total_pixels": 15161600
  }
}
```

### ステータス
- **OK**: overall_similarity > 0.97
- **CHECK**: 0.90 <= overall_similarity <= 0.97
- **NG**: overall_similarity < 0.90

### 差分画像について
- **--all オプション時**: すべてのステータスで差分画像を生成
- **オプションなし**: OK 以外（CHECK、NG）の場合のみ差分画像を生成
- **diff_ratio**: 有意な差分が占める割合（%）
  - 圧縮ノイズは自動的に除外されます
  - モルフォロジー処理で 500 ピクセル未満のノイズを除去

## 仕組み

### キャプチャ
- Playwright で全ページスクリーンショット取得
- PNG で一時保存
- `sharp` で PNG → WebP (quality=50) に変換して効率化
- アニメーション削減 CSS を注入して余計な差分を排除
- スクロール処理でレイジーロード画像をトリガー
- 固定ヘッダーを static ポジショニングに変更して正確なキャプチャを実現

### 比較
- ResNet18 (ImageNet 事前学習) で特徴抽出
- 画像を 8×8 タイルに分割
- 各タイルとグローバル特徴でコサイン類似度を計算
- スコア集約で総合判定

### 差分検出
- ピクセル値の差分を計算（L1 norm）
- 閾値以上の差分（>= 10）のみを検出
- **圧縮ノイズ除外**:
  - モルフォロジー処理（オープニング 2 回 + クロージング 1 回）
  - 500 ピクセル未満の小さい連結成分を自動除去
- 差分部分を赤でハイライトした PNG を出力
