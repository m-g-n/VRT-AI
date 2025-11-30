import sys
import warnings

# ワーニング抑制（最優先）
warnings.filterwarnings('ignore')

import torch
import torchvision.transforms as transforms
from torchvision.models import resnet18, ResNet18_Weights
from PIL import Image
import numpy as np
import json
import os
from pathlib import Path
from scipy.spatial.distance import cosine

# デバイス設定
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# ResNet18 モデルのロード（ImageNet 事前学習）
model = resnet18(weights=ResNet18_Weights.DEFAULT)
model.eval()
model.to(device)

# 特徴抽出用の transform
transform = transforms.Compose([
    transforms.Resize((256, 256)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

def extract_features(image_path):
    """画像から特徴ベクトルを抽出"""
    image = Image.open(image_path).convert('RGB')
    image = transform(image).unsqueeze(0).to(device)
    
    with torch.no_grad():
        features = model(image)
    
    return features.cpu().numpy().flatten()

def divide_into_tiles(image_path, tile_size=8):
    """画像をタイルに分割して各タイルの特徴を抽出"""
    image = Image.open(image_path).convert('RGB')
    image_array = np.array(image)
    
    h, w = image_array.shape[:2]
    tile_h, tile_w = h // tile_size, w // tile_size
    
    tile_features = []
    
    for i in range(tile_size):
        for j in range(tile_size):
            y_start = i * tile_h
            x_start = j * tile_w
            y_end = (i + 1) * tile_h if i < tile_size - 1 else h
            x_end = (j + 1) * tile_w if j < tile_size - 1 else w
            
            tile = image_array[y_start:y_end, x_start:x_end]
            tile_image = Image.fromarray(tile)
            
            # タイルを transform して特徴を抽出
            tile_tensor = transform(tile_image).unsqueeze(0).to(device)
            with torch.no_grad():
                features = model(tile_tensor).cpu().numpy().flatten()
            tile_features.append(features)
    
    return tile_features

def detect_differences(baseline_path, candidate_path, output_path, threshold=10):
    """
    ベースラインと候補画像の差分を検出
    output_path: 差分画像を保存するパス（拡張子は .webp で自動変換）
    threshold: ピクセル差分の閾値（この値以上の差があるピクセルを検出）
    圧縮ノイズ（小さな変化）は無視
    形態学的処理でノイズを除外
    """
    from PIL import Image, ImageChops
    import numpy as np
    from scipy import ndimage
    
    baseline = Image.open(baseline_path).convert('RGB')
    candidate = Image.open(candidate_path).convert('RGB')
    
    # サイズを統一
    if baseline.size != candidate.size:
        candidate = candidate.resize(baseline.size, Image.Resampling.LANCZOS)
    
    # 差分画像を計算
    diff = ImageChops.difference(baseline, candidate)
    diff_array = np.array(diff)
    
    # 圧縮ノイズを無視（閾値以下の差分は除外）
    # RGB 各チャネルの差分を計算
    r_diff = diff_array[:, :, 0].astype(int)
    g_diff = diff_array[:, :, 1].astype(int)
    b_diff = diff_array[:, :, 2].astype(int)
    
    # 総変化量（L1 norm）
    total_diff = r_diff + g_diff + b_diff
    
    # 閾値以上の差分を検出
    significant_diff = total_diff >= threshold
    
    # モルフォロジー処理でノイズを除外
    # オープニング操作（小さなノイズを除去）
    struct = ndimage.generate_binary_structure(2, 2)
    significant_diff = ndimage.binary_opening(significant_diff, structure=struct, iterations=2)
    
    # クロージング操作で細かい隙間を埋める
    significant_diff = ndimage.binary_closing(significant_diff, structure=struct, iterations=1)
    
    # ラベリングで連結成分を分析
    labeled, num_features = ndimage.label(significant_diff, structure=struct)
    
    # 小さな連結成分を除外（ノイズ除外）
    min_component_size = 500  # 500ピクセル未満は除外（100から500に増加）
    for component_id in range(1, num_features + 1):
        component_size = np.sum(labeled == component_id)
        if component_size < min_component_size:
            significant_diff[labeled == component_id] = False
    
    # 差分マップを作成（赤でハイライト）
    diff_visualization = baseline.copy()
    pixels = diff_visualization.load()
    h, w = significant_diff.shape
    
    for y in range(h):
        for x in range(w):
            if significant_diff[y, x]:
                pixels[x, y] = (255, 0, 0)  # 差分部分は赤
    
    # 出力パスを .webp に統一
    webp_path = output_path if output_path.endswith('.webp') else output_path.replace('.png', '.webp')
    
    # 古い PNG ファイルを削除
    png_path = webp_path.replace('.webp', '.png')
    if os.path.exists(png_path):
        os.remove(png_path)
    
    # 差分画像を WebP で保存（quality=50）
    diff_visualization.save(webp_path, 'WEBP', quality=50)
    
    # 差分の統計
    diff_ratio = np.sum(significant_diff) / (h * w) * 100  # 差分比率
    
    return {
        'diff_ratio': float(diff_ratio),
        'diff_pixels': int(np.sum(significant_diff)),
        'total_pixels': int(h * w)
    }

def compare_images(baseline_path, candidate_path, output_dir=None, tile_size=8, force_diff=False):
    """
    ベースライン画像と候補画像を比較
    output_dir: 差分画像を保存するディレクトリ
    force_diff: True の場合は status に関わらず差分画像を生成
    Returns: {
        'overall_similarity': float,
        'tile_similarities': list,
        'status': 'OK' | 'CHECK' | 'NG',
        'diff': {...}  # force_diff=True または status != 'OK' の場合に含まれる
    }
    """
    # グローバル特徴の比較
    baseline_features = extract_features(baseline_path)
    candidate_features = extract_features(candidate_path)
    
    # コサイン類似度
    global_similarity = 1.0 - cosine(baseline_features, candidate_features)
    
    # タイルごとの比較
    baseline_tiles = divide_into_tiles(baseline_path, tile_size)
    candidate_tiles = divide_into_tiles(candidate_path, tile_size)
    
    tile_similarities = []
    for b_tile, c_tile in zip(baseline_tiles, candidate_tiles):
        sim = 1.0 - cosine(b_tile, c_tile)
        tile_similarities.append(float(sim))
    
    avg_tile_similarity = np.mean(tile_similarities)
    
    # 総合スコア
    overall_similarity = (global_similarity + avg_tile_similarity) / 2
    
    # ステータス判定
    if overall_similarity > 0.97:
        status = 'OK'
    elif overall_similarity < 0.90:
        status = 'NG'
    else:
        status = 'CHECK'
    
    result = {
        'overall_similarity': float(overall_similarity),
        'global_similarity': float(global_similarity),
        'avg_tile_similarity': float(avg_tile_similarity),
        'tile_similarities': tile_similarities,
        'status': status,
        'tile_size': tile_size
    }
    
    # force_diff=True または OK以外の場合、差分画像を生成
    if output_dir and (force_diff or status != 'OK'):
        os.makedirs(output_dir, exist_ok=True)
        diff_output = os.path.join(output_dir, 'diff.webp')
        diff_stats = detect_differences(baseline_path, candidate_path, diff_output, threshold=10)
        
        result['diff'] = {
            'image_path': 'diff.webp',
            'diff_ratio': diff_stats['diff_ratio'],
            'diff_pixels': diff_stats['diff_pixels'],
            'total_pixels': diff_stats['total_pixels']
        }
    
    return result

def main():
    # スクリプトのある場所から相対パスを計算
    script_dir = Path(__file__).parent
    capture_dir = script_dir.parent.parent / 'capture'
    
    baseline_dir = capture_dir / 'baseline'
    candidate_dir = capture_dir / 'candidate'
    output_dir = script_dir.parent / 'results'
    
    os.makedirs(output_dir, exist_ok=True)
    
    # コマンドライン引数を処理（--all または --force で全て差分生成）
    force_diff = '--all' in sys.argv or '--force' in sys.argv
    
    # 候補画像を比較
    results = []
    baseline_files = sorted(baseline_dir.glob('*.webp'))
    
    if not baseline_files:
        print(f"⚠ No baseline images found in {baseline_dir}")
        return
    
    for baseline_file in baseline_files:
        candidate_file = candidate_dir / baseline_file.name
        
        if not candidate_file.exists():
            print(f"⚠ Candidate not found: {candidate_file}")
            continue
        
        print(f"🔍 Comparing {baseline_file.name}...")
        
        # 差分画像を保存するサブディレクトリを作成
        diff_dir = output_dir / baseline_file.stem
        
        result = compare_images(
            str(baseline_file), 
            str(candidate_file),
            output_dir=str(diff_dir),
            force_diff=force_diff  # オプションを渡す
        )
        result['name'] = baseline_file.stem
        results.append(result)
        print(f"   Status: {result['status']} (similarity: {result['overall_similarity']:.4f})")
        
        if 'diff' in result:
            print(f"   📊 Diff generated (ratio: {result['diff']['diff_ratio']:.2f}%)")
    
    # 結果を JSON に保存
    output_file = output_dir / 'comparison_results.json'
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\n✓ Results saved to {output_file}")

if __name__ == '__main__':
    main()
