import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// コマンドライン引数を処理
const args = process.argv.slice(2);
const isCandidate = args.includes('-c') || args.includes('--candidate');
const baseDir = path.dirname(__dirname); // packages/capture に移動
const outputRelativePath = isCandidate ? 'candidate' : 'baseline';
const OUTPUT_DIR = path.join(baseDir, outputRelativePath);

console.log(`🎯 Mode: ${isCandidate ? 'CANDIDATE' : 'BASELINE'}`);
console.log(`📁 Output: ${OUTPUT_DIR}\n`);

const CSS_ANIMATION_REDUCER = `
  * {
    animation: none !important;
    transition: none !important;
  }
  
  /* Fixed 要素を一時的に static に変更（スクリーンショット用） */
  [data-scroll-lock-padding],
  [class*="header"],
  [class*="Header"],
  [class*="navbar"],
  [class*="Navbar"],
  .sticky,
  [style*="position: fixed"] {
    position: static !important;
  }
`;

async function captureScreenshot(url, name) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // アニメーション削減 CSS を注入
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent = CSS_ANIMATION_REDUCER;
      document.head.appendChild(style);
    });

    // ページ読み込み（timeout 時も continue）
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 10000 });
    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.warn(`⚠ Page load timeout for ${name}, continuing...`);
      } else {
        throw error;
      }
    }
    
    // ページが安定するまで待つ
    await page.waitForTimeout(2000);

    // Lazy load 画像を読み込ませるためにスクロール
    await page.evaluate(async () => {
      const scrollHeight = document.documentElement.scrollHeight;
      let scrollPosition = 0;
      const scrollStep = window.innerHeight * 0.5;

      while (scrollPosition < scrollHeight) {
        window.scrollBy(0, scrollStep);
        scrollPosition += scrollStep;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // スクロールをリセット
      window.scrollTo(0, 0);
      
      // ページレイアウトが完全に安定するまで待機
      await new Promise(resolve => setTimeout(resolve, 1000));
    });

    // ネットワークアイドル待機（timeout 時は continue）
    try {
      await page.waitForLoadState('networkidle');
    } catch (error) {
      console.warn(`⚠ networkidle timeout for ${name}, skipping...`);
    }
    
    // 最終的な安定待機
    await page.waitForTimeout(500);

    // 出力ディレクトリを作成
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const tempPngPath = path.join(OUTPUT_DIR, `${name}.png`);
    const webpPath = path.join(OUTPUT_DIR, `${name}.webp`);
    
    // PNG で一時保存
    await page.screenshot({
      path: tempPngPath,
      fullPage: true,
      type: 'png'
    });

    // PNG を WebP に変換
    try {
      await sharp(tempPngPath)
        .webp({ quality: 50 })
        .toFile(webpPath);
      fs.unlinkSync(tempPngPath); // 一時ファイルを削除
      console.log(`✓ Captured: ${webpPath}`);
    } catch (error) {
      console.error(`✗ Failed to convert to WebP: ${name}`);
      throw error;
    }
  } finally {
    await browser.close();
  }
}

// 設定ファイルから targets を読み込む
const targetsPath = path.join(__dirname, '../targets.json');
const targetsData = fs.readFileSync(targetsPath, 'utf-8');
const targetUrls = JSON.parse(targetsData);

console.log(`📋 ${targetUrls.length} target(s) loaded\n`);

// URL からファイル名を生成
function generateNameFromUrl(urlString) {
  const url = new URL(urlString);
  let pathname = url.pathname.replace(/^\/|\/$/g, ''); // スラッシュを削除
  
  // ベースとなるファイル名を生成（小文字に変換してから不要な文字を削除）
  let baseName = pathname 
    ? pathname.toLowerCase().replace(/\//g, '-').replace(/[^a-z0-9-]/g, '') 
    : 'home';
  
  // クエリパラメータが存在する場合、ハッシュをファイル名に追加
  if (url.search) {
    // クエリパラメータのハッシュを生成（8文字、SHA-256使用）
    const queryHash = createHash('sha256').update(url.search).digest('hex').substring(0, 8);
    baseName = `${baseName}-${queryHash}`;
  }
  
  return baseName;
}

for (const url of targetUrls) {
  const name = generateNameFromUrl(url);
  await captureScreenshot(url, name);
}

console.log('\n✓ All captures completed');
