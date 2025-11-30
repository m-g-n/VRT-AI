# OpenAI Vision 比較機能

OpenAI の GPT-4o-mini を使用して、ベースライン画像と候補画像をビジュアル的に比較します。

## セットアップ

### 1. API キーを設定

プロジェクトルートに `.openai-key` ファイルを作成して、OpenAI API キーを記入してください：

```bash
echo "sk-..." > .openai-key
```

または手動で `vrt-ai/.openai-key` に OpenAI API キーを配置してください。

**⚠️ セキュリティ注意**: `.openai-key` は `.gitignore` に含まれており、Git にコミットされません。

### 2. 依存関係をインストール

```bash
npm install
```

## 使用方法

### Vision 比較を実行

```bash
npm run vision:compare
```

## 出力

結果は `packages/compare/results/vision_comparison_results.json` に保存されます。

### 結果の形式

```json
[
  {
    "name": "home",
    "result": "OK" | "NG" | "ERROR",
    "summary": "人間向けの説明",
    "differences": [
      {
        "area": "ヘッダー",
        "type": "layout-change | missing-element | overlap | text-change | image-change",
        "severity": "minor | major",
        "description": "具体的な差分説明"
      }
    ]
  }
]
```

### ステータス

- **OK**: レイアウト上の重大な変更がない
- **NG**: レイアウト崩れまたは重大な要素の変更がある
- **ERROR**: API エラーまたは処理エラー

## モデル

- **gpt-4o-mini**: 高精度な Vision 処理と低コスト

## 料金

GPT-4o-mini は従来の GPT-4 Vision より大幅に低コスト（約 90% 削減）です。
詳細は [OpenAI 料金ページ](https://openai.com/pricing) を参照してください。
