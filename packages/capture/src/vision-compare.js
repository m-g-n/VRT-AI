import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// API キーを読み込む
function loadApiKey() {
  const keyPath = path.join(__dirname, '..', '..', '..', '.openai-key');
  if (!fs.existsSync(keyPath)) {
    console.error('❌ API キーが見つかりません');
    console.error(`📍 ${keyPath} にファイルを作成してください`);
    process.exit(1);
  }
  const apiKey = fs.readFileSync(keyPath, 'utf-8').trim();
  if (!apiKey) {
    console.error('❌ API キーが空です');
    console.error(`📍 ${keyPath} に有効な API キーを記入してください`);
    process.exit(1);
  }
  return apiKey;
}

// 画像をBase64に変換
function imageToBase64(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  return imageBuffer.toString('base64');
}

// WebP/PNG から MIME タイプを判定
function getMimeType(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  return 'image/webp'; // デフォルト
}

async function compareWithVision(baselineDir, candidateDir, outputDir) {
  const apiKey = loadApiKey();
  const client = new OpenAI({
    apiKey: apiKey,
  });

  // 比較対象の画像をスキャン
  const baselineFiles = fs.readdirSync(baselineDir)
    .filter(f => /\.(webp|png|jpg|jpeg|gif)$/i.test(f))
    .sort();

  if (baselineFiles.length === 0) {
    console.log('⚠️  比較対象のベースライン画像がありません');
    return;
  }

  const results = [];

  for (const filename of baselineFiles) {
    const baselinePath = path.join(baselineDir, filename);
    const candidatePath = path.join(candidateDir, filename);

    if (!fs.existsSync(candidatePath)) {
      console.log(`⚠️  候補画像が見つかりません: ${filename}`);
      continue;
    }

    console.log(`🔍 Vision で比較中: ${filename}...`);

    try {
      // 画像を Base64 に変換
      const baselineBase64 = imageToBase64(baselinePath);
      const candidateBase64 = imageToBase64(candidatePath);

      const mimeType = getMimeType(baselinePath);
      
      // diff.webp がある場合は読み込む
      const imageName = path.parse(filename).name;
      const diffPath = path.join(outputDir, imageName, 'diff.webp');
      let diffBase64 = null;
      if (fs.existsSync(diffPath)) {
        diffBase64 = imageToBase64(diffPath);
      }

      const systemPrompt = `あなたはWebページの視覚レグレッションテストを行うレビュアーだ。
与えられた画像を比較し、以下を行うこと。

### 入力画像について
1. 最初の画像: ベースライン（変更前）
2. 次の画像: 候補（変更後）
3. 差分画像（赤色でハイライト）: 検出された差分領域（存在する場合）

### 判定ルール
- レイアウト上の差分（位置・サイズ・余白・重なり・要素の有無）に注目する。
- 画像やテキスト内容そのものの違いは「軽微な差分」として扱い、レイアウト崩れを優先的に判定する。
- 各セクションにおいて、listやカードの並び順の増減は必ずレイアウト差分として扱う。
- 差分画像が提供されている場合は、その赤色ハイライト領域を確認して判定の根拠とする。

### 出力形式
結果は必ず次のJSON形式で返すこと：

{
  "result": "OK" | "NG",
  "summary": "人間向けの短い説明",
  "diff_analysis": "差分画像の分析結果（差分画像がある場合）",
  "differences": [
    {
      "area": "ヘッダー / メインビジュアル / サイドバー など",
      "type": "layout-change | missing-element | overlap | text-change | image-change",
      "severity": "minor | major",
      "description": "具体的な差分説明"
    }
  ]
}

### ステータス判定
- 「major の layout-change / missing-element / overlap」が一つでもあれば "NG"
- それ以外のみなら "OK"`;

      // メッセージコンテンツを組み立て
      const messageContent = [
        {
          type: 'text',
          text: systemPrompt + '\n\n上記の画像を分析し、判定してください。',
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${baselineBase64}`,
          },
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${candidateBase64}`,
          },
        },
      ];
      
      // 差分画像がある場合は追加
      if (diffBase64) {
        messageContent.push({
          type: 'image_url',
          image_url: {
            url: `data:image/webp;base64,${diffBase64}`,
          },
        });
      }

      // OpenAI API で比較
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: messageContent,
          },
        ],
      });

      // レスポンスを解析
      const responseText = response.choices[0].message.content;

      let visionResult;
      try {
        // JSON を抽出
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          visionResult = JSON.parse(jsonMatch[0]);
        } else {
          visionResult = {
            result: 'ERROR',
            summary: 'JSON パースに失敗しました',
            differences: [],
            raw_response: responseText,
          };
        }
      } catch (parseError) {
        visionResult = {
          result: 'ERROR',
          summary: 'JSON パースエラー',
          differences: [],
          raw_response: responseText,
        };
      }

      visionResult.name = imageName;
      visionResult.has_diff_image = !!diffBase64;
      results.push(visionResult);

      console.log(`   結果: ${visionResult.result} - ${visionResult.summary}`);
      if (diffBase64) {
        console.log(`   📊 差分画像をレビューに含めました`);
      }
      if (visionResult.differences && visionResult.differences.length > 0) {
        console.log(`   差分: ${visionResult.differences.length} 件検出`);
      }
    } catch (error) {
      console.error(`❌ エラー (${filename}): ${error.message}`);
      results.push({
        name: path.parse(filename).name,
        result: 'ERROR',
        summary: error.message,
        differences: [],
        has_diff_image: false,
      });
    }
  }

  // 結果を保存
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, 'vision_comparison_results.json');
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));

  console.log(`\n✓ Vision 比較結果を保存しました: ${outputFile}`);
  console.log(`📊 比較件数: ${results.length}`);
  console.log(
    `✅ OK: ${results.filter(r => r.result === 'OK').length} | ⚠️  NG: ${results.filter(r => r.result === 'NG').length}`
  );
}

async function main() {
  const baselineDir = path.join(__dirname, '..', 'baseline');
  const candidateDir = path.join(__dirname, '..', 'candidate');
  const outputDir = path.join(__dirname, '..', '..', 'compare', 'results');

  await compareWithVision(baselineDir, candidateDir, outputDir);
}

main().catch(error => {
  console.error('エラーが発生しました:', error);
  process.exit(1);
});
