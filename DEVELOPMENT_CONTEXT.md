# VRT AI - Development Context

プロジェクトの全体像、アーキテクチャ、実装済み機能、拡張ポイントをまとめたドキュメント。

## 1. プロジェクト概要

**VRT AI** は AI 駆動型ビジュアル回帰テストシステム。

- **目的**: Webページのビジュアル変更を自動検出・分析
- **方式**: Playwright（キャプチャ）+ PyTorch（機械学習）+ OpenAI Vision（LLM 分析）
- **ストレージ**: WebP 形式（50% 品質で圧縮率 90% 削減）
- **リポジトリ**: https://github.com/m-g-n/VRT-AI

## 2. アーキテクチャ

```
vrt-ai/
├── packages/
│   ├── capture/         # スクリーンショット取得
│   │   ├── src/
│   │   │   ├── capture.js        # Playwright キャプチャロジック
│   │   │   └── vision-compare.js # OpenAI Vision 比較
│   │   ├── baseline/             # ベースライン画像（WebP）
│   │   ├── candidate/            # 候補画像（WebP）
│   │   ├── targets.json          # キャプチャ対象 URL リスト
│   │   └── package.json          # @playwright, sharp, openai
│   │
│   └── compare/         # 画像比較・分析
│       ├── src/
│       │   └── compare.py        # PyTorch ResNet18 比較
│       ├── results/              # 結果出力
│       │   ├── comparison_results.json       # PyTorch 結果
│       │   ├── vision_comparison_results.json # Vision 結果
│       │   └── {画像名}/
│       │       └── diff.webp     # 差分ハイライト（赤）
│       ├── venv/                 # Python 仮想環境
│       ├── requirements.txt      # torch, torchvision, scipy, pillow
│       └── package.json          # 空（スクリプト実行用）
│
├── .openai-key                   # OpenAI API キー（.gitignore）
├── capture.sh                    # キャプチャスクリプト
├── compare.sh                    # 比較スクリプト
├── package.json                  # ワークスペース定義 + npm scripts
├── README.md                     # ユーザー向けドキュメント
├── VISION_SETUP.md               # Vision 機能セットアップ
└── DEVELOPMENT_CONTEXT.md        # このファイル
```

## 3. 実装済み機能

### 3.1 キャプチャ（capture.js）

**機能**:
- Playwright でフルページスクリーンショット取得
- PNG 一時保存後、sharp で WebP 変換（quality=50）
- 自動ファイル名生成（URL パス → ファイル名）
- レイジーロード画像トリガー（スクロール処理）
- 固定ヘッダー位置修正（CSS 注入）
- アニメーション削減（CSS 注入）
- ネットワークタイムアウト対応（20秒、continue-on-error）

**コマンド**:
```bash
npm run capture:baseline   # ベースラインキャプチャ
npm run capture:candidate  # 候補キャプチャ
```

**出力**: `packages/capture/baseline/*.webp` または `packages/capture/candidate/*.webp`

**設定**: `packages/capture/targets.json`
```json
[
  "https://example.com",
  "https://example.com/about"
]
```

**パフォーマンス**: 11-30秒/ページ（ページ複雑度による）

---

### 3.2 PyTorch 比較（compare.py）

**機能**:
- ResNet18（ImageNet 事前学習）で特徴抽出
- グローバル特徴 + 8×8 タイル特徴の抽出
- コサイン類似度計算
- 3段階ステータス判定（OK/CHECK/NG）
- ピクセル差分検出
- 圧縮ノイズ自動除外（モルフォロジー処理）
- 差分画像を WebP で出力（赤色ハイライト）

**コマンド**:
```bash
npm run compare              # 比較実行（OK時は diff なし）
npm run compare -- --all     # すべてのステータスで diff 生成
```

**出力**:
```
packages/compare/results/
├── comparison_results.json  # 比較結果（JSON）
└── {画像名}/
    └── diff.webp           # 差分画像
```

**結果形式**:
```json
{
  "name": "home",
  "overall_similarity": 0.958,
  "global_similarity": 0.945,
  "avg_tile_similarity": 0.971,
  "status": "CHECK",
  "tile_similarities": [[...64 tiles...]],
  "tile_size": 8,
  "diff": {
    "image_path": "diff.webp",
    "diff_ratio": 2.34,
    "diff_pixels": 356640,
    "total_pixels": 15161600
  }
}
```

**ステータス判定**:
- `OK`: overall_similarity > 0.97
- `CHECK`: 0.90 ≤ overall_similarity ≤ 0.97
- `NG`: overall_similarity < 0.90

**ノイズ除外**:
- ピクセル値差分閾値: 10 以上
- モルフォロジー処理: オープニング 2回 + クロージング 1回
- 最小コンポーネント: 500 ピクセル未満を除外

---

### 3.3 OpenAI Vision 比較（vision-compare.js）

**機能**:
- GPT-4o-mini モデルで Vision 分析
- ベースライン + 候補 + diff.webp の 3 画像を送信
- レイアウト崩れを人間的視点で評価
- 構造化 JSON 出力（area/type/severity）
- API キーを .openai-key から読み込み（.gitignore 保護）

**コマンド**:
```bash
npm run vision:compare
```

**出力**:
```
packages/compare/results/vision_comparison_results.json
```

**結果形式**:
```json
{
  "name": "home",
  "result": "NG",
  "summary": "レイアウトの重大な変更が一部発生しています。",
  "diff_analysis": "差分画像には重要な要素が欠如しており...",
  "differences": [
    {
      "area": "メインビジュアル",
      "type": "missing-element",
      "severity": "major",
      "description": "メインビジュアルの一部要素が欠落..."
    }
  ],
  "has_diff_image": true
}
```

**判定ルール**:
- major の layout-change / missing-element / overlap → NG
- その他 → OK

**プロンプト特徴**:
- リスト/カード並び順の変更は必ずレイアウト差分として扱う
- 軽微な画像/テキスト内容変更は除外
- 差分画像の赤色ハイライト領域を確認して判定

---

## 4. ワークフロー

### 基本ワークフロー
```bash
# 1. ベースラインキャプチャ
npm run capture:baseline

# 2. 候補キャプチャ
npm run capture:candidate

# 3. PyTorch 比較
npm run compare

# 4. Vision 分析（オプション）
npm run vision:compare
```

### 相互検証ワークフロー
```bash
# PyTorch と Vision の両方を実行
npm run compare && npm run vision:compare

# 両方の結果を比較：
# - comparison_results.json （機械学習）
# - vision_comparison_results.json （LLM 分析）
```

---

## 5. 技術スタック

| レイヤー | 技術 | 用途 | バージョン |
|---------|------|------|-----------|
| **キャプチャ** | Playwright | ブラウザ自動化 | 1.40.0+ |
| | sharp | 画像処理（PNG→WebP） | 0.34.5+ |
| **機械学習** | PyTorch | ニューラルネットワーク | 2.1.1+ |
| | torchvision | ResNet18 + transforms | 0.16.1+ |
| | scipy | コサイン類似度 | - |
| | Pillow | 画像操作 | - |
| **Vision** | OpenAI API | GPT-4o-mini | v1+ |
| **言語** | Node.js | キャプチャ/Vision | 18+ |
| | Python | 比較/分析 | 3.9+ |

---

## 6. API キーおよび環境設定

### OpenAI API キー
```bash
# プロジェクトルートに作成
echo "sk-..." > .openai-key

# または手動で以下に配置
/Users/9988megane/Downloads/vrt-ai/.openai-key
```

**セキュリティ**: `.gitignore` で保護（コミット対象外）

### Python 仮想環境
```bash
cd packages/compare
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

---

## 7. パフォーマンス特性

### キャプチャ時間
- **最小**: 11 秒
- **平均**: 15-25 秒
- **最大**: 30+ 秒（複雑なページ）

**最適化ポイント**:
- ページ読み込みタイムアウト: 20秒（デフォルト）
- networkidle スキップ: 外部スクリプト（TikTok等）回避
- スクロール間隔: 200ms

### 比較時間
- **PyTorch**: 5-10秒/画像
- **Vision**: 3-8秒/画像（API 遅延を含む）

### ストレージサイズ
- **PNG**: 5-10MB/ページ
- **WebP**: 300-800KB/ページ（90% 削減）
- **diff.webp**: 100-500KB

---

## 8. 拡張ポイント

### 今後の追加機能候補

#### 8.1 キャプチャ側（capture.js）
- [ ] モバイルビューポート対応
- [ ] デバイスエミュレーション（スマホ、タブレット）
- [ ] 複数ブラウザ対応（Chrome, Firefox, Safari）
- [ ] スクリーンショット品質調整
- [ ] キャプチャ前のウォーミングアップ（キャッシュ削除など）

#### 8.2 比較側（compare.py）
- [ ] 異なるモデルの選択（VGG16, EfficientNet など）
- [ ] 指定領域のマスキング（特定エリアのみ比較）
- [ ] 色差分検出（色のみ変更した場合の検出）
- [ ] テキスト認識（OCR）による違い検出
- [ ] 結果のレポート生成（HTML）

#### 8.3 Vision 側（vision-compare.js）
- [ ] 複数言語対応
- [ ] カスタムプロンプト機能
- [ ] 他の LLM 対応（Claude, Gemini など）
- [ ] バッチ処理の最適化
- [ ] キャッシング機能（同一画像の再分析回避）

#### 8.4 統合機能
- [ ] 前回実行結果との比較
- [ ] トレンド分析（時系列で変化を追跡）
- [ ] HTML レポート生成
- [ ] Slack/メール通知
- [ ] CI/CD パイプライン統合（GitHub Actions など）
- [ ] Web UI ダッシュボード
- [ ] データベース保存（MongoDB, PostgreSQL など）

---

## 9. ファイル構成詳細

### capture.js

**主要変数**:
- `baseUrl`: キャプチャ対象の基本 URL
- `targets`: targets.json から読み込んだ URL リスト
- `outputDir`: 出力ディレクトリ（baseline/candidate）
- `screenshotPath`: PNG 一時保存パス
- `webpPath`: WebP 最終出力パス

**主要関数**:
- `generateFilename(url)`: URL → ファイル名（拡張子なし）
- `capturePageWithRetry(page, url)`: タイムアウト対応のページ読み込み
- `injectCss(page)`: CSS 注入（固定ヘッダー、アニメーション削減）
- `triggerLazyLoad(page)`: スクロール処理でレイジーロード起動
- `captureFullPage(page)`: フルページスクリーンショット
- `convertToWebP(pngPath, webpPath)`: PNG → WebP 変換

**環境変数・オプション**:
- `-c` または `--candidate`: candidate ディレクトリを対象
- デフォルト: baseline ディレクトリを対象

---

### compare.py

**主要クラス/関数**:
- `extract_features(image_path)`: ResNet18 で特徴抽出
- `divide_into_tiles(image_path, tile_size=8)`: 画像を 8×8 タイルに分割
- `detect_differences(baseline_path, candidate_path, output_path)`: 差分検出
  - ピクセル値計算（L1 norm）
  - モルフォロジー処理
  - 連結成分ラベリング
  - WebP 出力
- `compare_images(baseline_path, candidate_path, output_dir, force_diff)`: 比較実行
- `main()`: エントリーポイント

**デバイス**:
- CUDA 有無の自動判定（GPU 利用可能なら CUDA）

**出力ファイル**:
- `results/comparison_results.json`: JSON 結果
- `results/{画像名}/diff.webp`: 差分画像

---

### vision-compare.js

**主要関数**:
- `loadApiKey()`: .openai-key から API キーを読み込み
- `imageToBase64(imagePath)`: 画像ファイル → Base64 エンコード
- `getMimeType(imagePath)`: 拡張子から MIME タイプを判定
- `compareWithVision()`: Vision 比較メイン処理
  - diff.webp の有無確認
  - 3 画像を Base64 に変換
  - OpenAI API 呼び出し
  - JSON 解析
- `main()`: エントリーポイント

**API 仕様**:
- モデル: `gpt-4o-mini`
- max_tokens: 1024
- メッセージ形式: image_url（Base64 data URI）

---

## 10. デバッグおよびトラブルシューティング

### よくある問題

#### Playwright ブラウザが見つからない
```bash
npx playwright install
```

#### Python モジュールが見つからない
```bash
cd packages/compare
source venv/bin/activate
pip install -r requirements.txt
```

#### OpenAI API キーエラー
```bash
# .openai-key が存在することを確認
ls -la /Users/9988megane/Downloads/vrt-ai/.openai-key

# キーが有効かテスト
cat .openai-key  # sk-... で始まることを確認
```

#### WebP 変換エラー
```bash
# sharp が正しくインストールされているか確認
npm list sharp
```

### ログ出力

各スクリプトは以下の形式でログを出力:
- ✅ 成功
- ⚠️  警告
- ❌ エラー
- 🔍 進行中

---

## 11. 今後の開発指針

### 優先度別推奨事項

1. 本システムにおけるテストの導入
2. 同URLからスマートフォンとPCの両方をテストできる
3. URLをテスト環境、本番環境などに切り替る
4. Basic認証の突破
5. ログインの突破

### 開発プロセス

1. **機能提案**: DEVELOPMENT_CONTEXT.md の拡張ポイント参照
2. **実装**: packages/*/src に新ファイル追加
3. **テスト**: 実環境で動作確認
4. **ドキュメント**: README.md を更新
5. **コミット**: 意味のあるコミットメッセージで記録

---

## 12. リポジトリ情報

- **GitHub**: https://github.com/m-g-n/VRT-AI
- **ブランチ**: main（デフォルト）
- **最後のコミット**: Vision diff.webp 統合

---

## 13. 参考資料

- **Playwright**: https://playwright.dev
- **PyTorch**: https://pytorch.org
- **OpenAI API**: https://platform.openai.com/docs
- **sharp**: https://sharp.pixelplumbing.com
- **torchvision**: https://pytorch.org/vision

---

**最終更新**: 2025年12月1日
**作成者**: GitHub Copilot
