# VRT AI - AI-Powered Visual Regression Testing

WebP ベースの AI 駆動型ビジュアル回帰テストシステム。Playwright でスクリーンショット取得、複数の比較エンジンを搭載。

## 構成

- **capture** (`packages/capture/`) - Node.js + Playwright でスクリーンショット取得
- **compare** (`packages/compare/`) - Python + PyTorch でビジュアル比較
- **vision-compare** - OpenAI Vision (GPT-4o-mini) によるレイアウト検証

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

### 設定ファイルの準備

```bash
# targets_sample.json をコピーして targets.json を作成
cp packages/capture/targets_sample.json packages/capture/targets.json
```

**注意**: `targets.json` は `.gitignore` で保護されているため、リポジトリにはコミットされません。

## 使用方法

### 1. キャプチャ対象 URL を設定

**重要**: `targets.json` は `.gitignore` で保護されています。

以下の手順で設定ファイルを作成してください：

```bash
# targets_sample.json をコピーして targets.json を作成
cp packages/capture/targets_sample.json packages/capture/targets.json

# targets.json を編集（URL のリストのみ）
```

編集後の `packages/capture/targets.json`：

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

**クエリパラメータ付きの URL は別ファイルとして扱われます：**
- `https://example.com/?s=test` → `home-21fd16a1.webp`（ハッシュ付き）
- `https://example.com/?s=other` → `home-c6d2f1c5.webp`（異なるハッシュ）

パラメータが異なる URL は自動的に異なるファイル名が生成されるため、個別に比較されます。

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

#### 機械学習ベースの比較（PyTorch + ResNet18）

基本的な比較（OK の場合は差分画像なし）：
```bash
npm run compare
```

すべてのステータスで差分画像を生成：
```bash
npm run compare -- --all
```

結果は `packages/compare/results/comparison_results.json` に出力されます。
差分画像は `packages/compare/results/{画像名}/diff.webp` に保存されます。

#### Vision ベースの比較（OpenAI GPT-4o-mini）

レイアウト崩れを人間のような視点で検証：
```bash
npm run vision:compare
```

**セットアップ**: `VISION_SETUP.md` を参照してください。

結果は `packages/compare/results/vision_comparison_results.json` に出力されます。

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

### Vision 比較（OpenAI GPT-4o-mini）
- 画像を Base64 エンコーディング
- OpenAI API で画像を同時に送信
- レイアウト崩れを人間のような視点で評価
- 結果を JSON で構造化（area/type/severity/description）
- **判定ルール**:
  - major の layout-change / missing-element / overlap があれば "NG"
  - その他は "OK"

## 比較エンジンの選択

| エンジン | 方式 | 速度 | コスト | 特徴 |
|---------|------|------|--------|------|
| **PyTorch (デフォルト)** | 機械学習 | 高速 | 無料 | 自動・量的分析、ノイズに強い |
| **Vision (GPT-4o-mini)** | LLM Vision | 中速 | 低額 | 人間的判断、レイアウト評価、詳細説明 |

両方実行して相互検証することも可能です。
