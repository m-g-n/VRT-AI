# VRT AI - テスト導入計画

## 概要

本ドキュメントは、VRT AI システムにテストを導入する際の戦略、テスト種別、実装優先度をまとめたもの。

---

## 1. テスト対象システムの特性分析

### 1.1 主要モジュール

| モジュール | 言語 | 主要処理 | テスト難度 | リスク度 |
|-----------|------|--------|---------|--------|
| **capture.js** | JavaScript | Playwright によるスクリーンショット取得 | 中 | 高 |
| **compare.py** | Python | PyTorch による機械学習ベース比較 | 中 | 中 |
| **vision-compare.js** | JavaScript | OpenAI Vision API による LLM 分析 | 高 | 高 |

### 1.2 テストの課題

1. **外部依存性**
   - Playwright（ブラウザ自動化）
   - OpenAI API（課金、レート制限）
   - PyTorch（大規模モデル）

2. **ファイル I/O 中心**
   - スクリーンショット取得・変換
   - 画像ファイル比較
   - JSON 出力

3. **非決定的な出力**
   - ネットワーク遅延（タイムアウト処理）
   - 圧縮の微細な差（WebP quality=50）
   - モデルの推論ばらつき

---

## 2. テスト戦略（ピラミッド構造）

```
       統合テスト (E2E)
         /          \
    ユーザー        API
    ジャーニー      テスト
      /              \
   単体テスト (Unit) 
```

### 2.1 テストレベルごとの方針

| レベル | 対象 | 手法 | ツール | カバレッジ目標 |
|-------|------|------|-------|-------------|
| **ユニット** | 関数・メソッド | ホワイトボックステスト | Jest (JS) / pytest (Python) | 70%+ |
| **統合** | モジュール間 | ブラックボックステスト | Jest (JS) / pytest (Python) | 主要フロー |
| **E2E** | 全体ワークフロー | リアルシナリオ | Playwright / pytest | 主要シナリオ |

---

## 3. テスト対象の詳細計画

### フェーズ 1: 基盤テスト（優先度：高）

#### 3.1.1 **capture.js - ユニットテスト**

**対象関数**:
```javascript
generateNameFromUrl(urlString)      // URL → ファイル名生成
captureScreenshot(url, name)        // スクリーンショット取得
```

**テストケース例**:

| 項目 | ケース | 期待値 |
|------|--------|-------|
| URL変換 | `https://example.com` | `home` |
| | `https://example.com/about` | `about` |
| | `https://example.com/blog/article-123` | `blog-article-123` |
| ファイル操作 | targets.json 読み込み成功 | URL リスト取得 |
| | targets.json 未存在 | エラー処理 |
| スクリーンショット | 有効な URL | WebP ファイル生成 |
| | タイムアウト URL | 警告ログ + 継続 |

**ツール**: Jest + `@testing-library/dom`（optional）

**実装例**:
```javascript
// __tests__/capture.test.js
describe('capture.js', () => {
  describe('generateNameFromUrl', () => {
    it('should return "home" for root path', () => {
      expect(generateNameFromUrl('https://example.com')).toBe('home');
    });
    
    it('should convert path to kebab-case', () => {
      expect(generateNameFromUrl('https://example.com/blog/Article-123'))
        .toBe('blog-article-123');
    });
  });
});
```

---

#### 3.1.2 **compare.py - ユニットテスト**

**対象関数**:
```python
extract_features(image_path)                    # ResNet18 特徴抽出
divide_into_tiles(image_path, tile_size=8)    # タイル分割
detect_differences(baseline_path, candidate_path, output_path)  # 差分検出
```

**テストケース例**:

| 項目 | ケース | 期待値 |
|------|--------|-------|
| 特徴抽出 | 有効な PNG/WebP | 1024 次元特徴ベクトル |
| | 無効な画像 | エラー処理 |
| タイル分割 | 正方形画像 | 64 タイル（8×8） |
| | 非正方形画像 | 正確に 64 タイルに分割 |
| 差分検出 | 同一画像 | diff_ratio ≈ 0% |
| | 完全異なる画像 | diff_ratio > 50% |
| | サイズ不一致 | リサイズ後に処理 |
| ステータス判定 | similarity > 0.97 | status = 'OK' |
| | 0.90 ≤ similarity ≤ 0.97 | status = 'CHECK' |
| | similarity < 0.90 | status = 'NG' |

**ツール**: pytest + `pytest-cov`（カバレッジ測定）

**実装例**:
```python
# tests/test_compare.py
import pytest
from compare import extract_features, divide_into_tiles

class TestFeatureExtraction:
    def test_extract_features_returns_correct_shape(self, sample_image):
        features = extract_features(sample_image)
        assert features.shape == (1024,)
    
    def test_divide_into_tiles_returns_64_tiles(self, sample_image):
        tiles = divide_into_tiles(sample_image, tile_size=8)
        assert len(tiles) == 64
```

---

#### 3.1.3 **vision-compare.js - ユニットテスト**

**対象関数**:
```javascript
loadApiKey()              // API キー読み込み
imageToBase64(imagePath)  // 画像 → Base64 エンコード
getMimeType(imagePath)    // MIME タイプ判定
```

**テストケース例**:

| 項目 | ケース | 期待値 |
|------|--------|-------|
| API キー読み込み | 有効なキー | キー文字列返却 |
| | ファイル未存在 | エラー処理 + プロセス終了 |
| | キーが空 | エラー処理 + プロセス終了 |
| Base64 エンコード | PNG ファイル | Base64 文字列 |
| | WebP ファイル | Base64 文字列 |
| MIME タイプ | `.webp` | `image/webp` |
| | `.png` | `image/png` |
| | `.jpg` | `image/jpeg` |

**ツール**: Jest + `jest-mock-fs`（ファイルシステムモック）

**実装例**:
```javascript
// __tests__/vision-compare.test.js
describe('vision-compare.js', () => {
  describe('getMimeType', () => {
    it('should return correct MIME type for WebP', () => {
      expect(getMimeType('image.webp')).toBe('image/webp');
    });
    
    it('should return image/webp as default', () => {
      expect(getMimeType('unknown.xyz')).toBe('image/webp');
    });
  });
});
```

---

### フェーズ 2: 統合テスト（優先度：中-高）

#### 3.2.1 **capture.js - 統合テスト**

**シナリオ**:
1. targets.json から URL リスト読み込み
2. 各 URL でスクリーンショット取得
3. WebP 変換 + ファイル保存
4. 出力ディレクトリの検証

**テストケース**:

| シナリオ | 入力 | 期待値 |
|---------|------|-------|
| 正常系 | targets.json（2 URL） | baseline/*.webp（2ファイル） |
| 一部エラー | targets.json（1 有効 + 1 タイムアウト） | baseline/*.webp（1ファイル）+ 警告ログ |
| 空 targets.json | targets.json（[]） | 何も生成されない |

**実装方針**:
- モックサーバー（local-web-server など）を用意
- テスト HTML ページを複数パターン準備
- スクリーンショット出力の存在確認

---

#### 3.2.2 **compare.py - 統合テスト**

**シナリオ**:
1. baseline/*.webp + candidate/*.webp の配置
2. 全ペアを比較
3. comparison_results.json 生成
4. 差分画像生成（status != 'OK' の場合）

**テストケース**:

| シナリオ | baseline | candidate | 期待値 |
|---------|----------|-----------|-------|
| 同一画像 | test1.webp | test1.webp（同内容） | status='OK', diff なし |
| 軽微な差分 | test2.webp | test2.webp（5% 変更） | status='CHECK', diff あり |
| 大きな差分 | test3.webp | test3.webp（50% 変更） | status='NG', diff あり |
| 候補なし | test4.webp | （なし） | スキップ + 警告 |

**実装方針**:
- テスト用ダミー画像を pytest fixtures で用意
- PIL で画像を生成（サイズ統一）
- JSON 結果の検証

---

#### 3.2.3 **vision-compare.js - 統合テスト**

**シナリオ**:
1. baseline/*.webp + candidate/*.webp を読み込み
2. OpenAI Vision API で比較（モック）
3. vision_comparison_results.json 生成

**テストケース**:

| シナリオ | API レスポンス | 期待値 |
|---------|---------------|-------|
| 正常系 | OK JSON | 結果保存 + OK count 増加 |
| API エラー | 500 エラー | エラーログ + ERROR status |
| 不正 JSON | 有効な JSON でない | パースエラーハンドリング + 警告ログ |

**実装方針**:
- OpenAI API をモック（Nock など）
- テストレスポンスを用意
- API キーはテスト用ダミーキーを使用

---

### フェーズ 3: E2E テスト（優先度：中）

#### 3.3.1 **エンドツーエンド・ワークフロー**

**シナリオ**:
```bash
# 1. ベースラインキャプチャ
npm run capture:baseline

# 2. 候補キャプチャ（モック対象サイトの状態を変更）
npm run capture:candidate

# 3. PyTorch 比較
npm run compare

# 4. Vision 分析（オプション）
npm run vision:compare
```

**テストケース**:

| 項目 | 実施内容 | 期待値 |
|------|--------|-------|
| キャプチャ | モックサーバーで 3 ページ取得 | baseline/*.webp（3ファイル） |
| 変更適用 | モックサーバーの HTML を変更 | candidate/*.webp（3ファイル） |
| 比較 | `npm run compare` 実行 | comparison_results.json + diff.webp |
| Vision 分析 | `npm run vision:compare` 実行 | vision_comparison_results.json |
| 結果検証 | 両方の結果を確認 | status が一致するか確認 |

**実装ツール**:
- モックサーバー: `local-web-server` / `http-server` / `node-static`
- E2E テストランナー: Playwright Test / Jest（with subprocess）

---

## 4. テスト環境セットアップ

### 4.1 必要な依存関係

#### Node.js プロジェクト
```json
{
  "devDependencies": {
    "jest": "^29.7.0",
    "jest-mock-fs": "^1.1.5",
    "@testing-library/dom": "^9.3.4",
    "nock": "^13.4.0"
  }
}
```

#### Python プロジェクト
```txt
pytest==7.4.3
pytest-cov==4.1.0
pytest-mock==3.12.0
Pillow==10.1.0
```

### 4.2 ディレクトリ構造

```
vrt-ai/
├── packages/
│   ├── capture/
│   │   ├── src/
│   │   │   ├── capture.js
│   │   │   └── vision-compare.js
│   │   └── __tests__/              # ← Jest テスト
│   │       ├── capture.test.js
│   │       └── vision-compare.test.js
│   │
│   └── compare/
│       ├── src/
│       │   └── compare.py
│       ├── tests/                   # ← pytest テスト
│       │   ├── test_compare.py
│       │   ├── conftest.py
│       │   └── fixtures/
│       │       └── sample_images/   # テスト用ダミー画像
│       └── requirements.txt
│
├── e2e-tests/                       # ← E2E テスト
│   ├── mock-server.js
│   ├── e2e.test.js
│   └── fixtures/
│       └── test-pages/              # テスト用 HTML
│
├── jest.config.js                   # Jest 設定
├── pytest.ini                       # pytest 設定
└── TEST_STRATEGY.md                 # このドキュメント
```

---

## 5. テスト実装の優先順序

### 優先度 1: ユニットテスト基盤（1-2 週間）

1. **capture.js - generateNameFromUrl のテスト**
   - 実装難度: ★☆☆（簡単）
   - 効果: ★★★（高）
   - 推奨: 最初に実装

2. **compare.py - 特徴抽出・タイル分割のテスト**
   - 実装難度: ★★☆（中）
   - 効果: ★★☆（中）
   - 推奨: 次に実装

3. **vision-compare.js - ユーティリティ関数のテスト**
   - 実装難度: ★★☆（中）
   - 効果: ★★☆（中）
   - 推奨: 並行実装

### 優先度 2: 統合テスト（2-3 週間）

4. **capture.js - 統合テスト**
   - 実装難度: ★★★（難）
   - 効果: ★★★（高）
   - 推奨: モックサーバーを用意してから

5. **compare.py - 統合テスト**
   - 実装難度: ★★☆（中）
   - 効果: ★★★（高）
   - 推奨: ユニットテスト後

6. **vision-compare.js - 統合テスト**
   - 実装難度: ★★★（難）
   - 効果: ★★☆（中）
   - 推奨: API モック準備が必須

### 優先度 3: E2E テスト（3-4 週間）

7. **エンドツーエンド・ワークフロー**
   - 実装難度: ★★★（難）
   - 効果: ★★★（高）
   - 推奨: 全ユニット・統合テスト完了後

---

## 6. テスト実行方法（計画）

### ユニットテスト実行

```bash
# JavaScript
npm test --workspace=packages/capture

# Python
cd packages/compare
python -m pytest tests/ -v --cov=src

# 全て
npm test
```

### 統合テスト実行

```bash
# JavaScript
npm run test:integration --workspace=packages/capture

# Python
cd packages/compare
python -m pytest tests/integration/ -v
```

### E2E テスト実行

```bash
npm run test:e2e
```

### カバレッジ確認

```bash
# JavaScript + Python 統合
npm run test:coverage
```

---

## 7. CI/CD パイプライン統合（将来）

### GitHub Actions ワークフロー例

```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - uses: actions/setup-python@v4
        with:
          python-version: '3.9'
      - run: npm ci && npm test
  
  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci && npm run test:integration
  
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci && npm run test:e2e
```

---

## 8. 品質メトリクス目標

| メトリクス | 現状 | 目標 | タイムライン |
|-----------|------|------|-----------|
| コードカバレッジ | 0% | 70%+ | フェーズ 1-2 完了後 |
| ユニットテスト数 | 0 | 30+ | フェーズ 1 完了時 |
| 統合テスト数 | 0 | 10+ | フェーズ 2 完了時 |
| E2E テスト数 | 0 | 5+ | フェーズ 3 完了時 |
| テスト実行時間 | - | < 5 分 | 常時 |

---

## 9. 実装上の注意点

### 9.1 外部依存の処理

| 依存 | モック戦略 |
|------|----------|
| Playwright | ブラウザ実際起動（遅いため選択的） |
| OpenAI API | Nock / Jest Mock |
| ファイルシステム | jest-mock-fs / pytest monkeypatch |
| PyTorch モデル | 事前に保存した小さいモデル / ダミー特徴ベクトル |

### 9.2 テストデータ管理

```
__tests__/fixtures/
├── images/
│   ├── sample_1.png        # テスト用ダミー画像
│   ├── sample_2_diff.png   # 若干異なる版
│   └── large_diff.png      # 大きく異なる版
├── responses/
│   ├── vision_ok.json      # Vision API レスポンス例
│   └── vision_ng.json
└── html/
    └── sample_page.html    # モックサーバー用
```

### 9.3 非決定性への対応

```python
# 同じ出力を保証する
torch.manual_seed(42)
np.random.seed(42)

# 画像比較は許容範囲を設ける
assert abs(result['overall_similarity'] - expected) < 0.01
```

---

## 10. 今後の拡張

- [ ] パフォーマンステスト（ベンチマーク）
- [ ] セキュリティテスト（API キー管理）
- [ ] ストレステスト（大量画像処理）
- [ ] アクセシビリティテスト（UI 要素の見えやすさ）

---

**最終更新**: 2025年12月1日
**ステータス**: テスト導入計画策定完了
