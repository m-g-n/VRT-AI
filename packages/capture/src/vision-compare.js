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
  return fs.readFileSync(keyPath, 'utf-8').trim();
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
  const client = new OpenAI({ apiKey });

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

      // OpenAI API で比較
      const response = await client.messages.create({
        model: 'gpt-4o-mini',
        max_tokens: 1024,
        system: `
あなたはWebページの視覚レグレッションテストを行うレビュアーだ。
与えられた2枚のスクリーンショット画像を比較し、以下を行うこと。

- レイアウト上の差分（位置・サイズ・余白・重なり・要素の有無）に注目する。
- 画像やテキスト内容そのものの違いは「軽微な差分」として扱い、レイアウト崩れがあるかどうかを優先的に判定する。
- 結果は必ず次のJSON形式で返すこと：

{
  "result": "OK" | "NG",
  "summary": "人間向けの短い説明",
  "differences": [
    {
      "area": "ヘッダー / メインビジュアル / サイドバー など",
      "type": "layout-change | missing-element | overlap | text-change | image-change",
      "severity": "minor | major",
      "description": "具体的な差分説明"
    }
  ]
}

- result は以下のルールで決めること：
  - 「major の layout-change / missing-element / overlap」が一つでもあれば "NG"
  - それ以外のみなら "OK"
`,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: '次の2枚の画像を比較し、上記ルールに従って判定してください。\n\n最初の画像がベースライン（変更前）、次の画像が候補（変更後）です。',
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: baselineBase64,
                },
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: candidateBase64,
                },
              },
            ],
          },
        ],
      });

      // レスポンスを解析
      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

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

      visionResult.name = path.parse(filename).name;
      results.push(visionResult);

      console.log(`   結果: ${visionResult.result} - ${visionResult.summary}`);
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
