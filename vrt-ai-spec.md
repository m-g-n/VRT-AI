# VRT AI Spec (WebP-based Visual Regression Test)

## Overview

AI-powered visual regression testing using Playwright for capture and
Python for high-level image comparison. WebP is used for efficient
storage.

## Capture

-   Use Playwright to capture full-page screenshots.
-   Save as WebP (`quality=50`).
-   Inject CSS to reduce animations.

## Comparison

-   Python + PyTorch (ResNet18) for feature extraction.
-   Divide image into tiles (e.g., 8×8).
-   Compute cosine similarity between baseline and candidate.
-   Aggregate score + local tile scores.

## File Storage

-   Store WebP images.
-   Optionally store feature vectors only.
-   WebP results in significant size reduction.

## Suggested Thresholds

-   avg_similarity \> 0.97 → OK
-   avg_similarity \< 0.90 → NG
-   Otherwise → CHECK

## Output

-   JSON result file containing overall score and tile-level
    differences.
