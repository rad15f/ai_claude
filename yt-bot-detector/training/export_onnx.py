#!/usr/bin/env python3
"""
Export the fine-tuned DistilBERT to quantized ONNX for @xenova/transformers.

Output layout (mirrors what Xenova/transformers expects):
  models/yt-bot-detector-onnx/
    config.json
    tokenizer_config.json
    tokenizer.json
    vocab.txt
    special_tokens_map.json
    onnx/model.onnx           ← full precision (~250 MB)
    onnx/model_quantized.onnx ← int8 quantized (~65 MB)

Usage:
    cd yt-bot-detector
    python3 training/export_onnx.py
    (onnxruntime already installed; no other new deps needed)
"""

import shutil
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer
from onnxruntime.quantization import quantize_dynamic, QuantType

# ─── Config ──────────────────────────────────────────────────────────────────

SRC_MODEL  = Path(__file__).parent.parent / "models" / "yt-bot-detector"
ONNX_DIR   = Path(__file__).parent.parent / "models" / "yt-bot-detector-onnx"
ONNX_SUBDIR = ONNX_DIR / "onnx"
ONNX_FILE  = ONNX_SUBDIR / "model.onnx"
QUANT_FILE = ONNX_SUBDIR / "model_quantized.onnx"
MAX_LENGTH = 128


def main() -> None:
    if not SRC_MODEL.exists():
        raise FileNotFoundError(f"Trained model not found: {SRC_MODEL}\nRun train_classifier.py first.")

    ONNX_SUBDIR.mkdir(parents=True, exist_ok=True)

    # ── Step 1: load model + tokenizer ───────────────────────────────────────
    print("Loading model …")
    tokenizer = AutoTokenizer.from_pretrained(str(SRC_MODEL))
    model = AutoModelForSequenceClassification.from_pretrained(str(SRC_MODEL))
    model.eval()

    # ── Step 2: export to ONNX via torch ─────────────────────────────────────
    print("Exporting to ONNX …")
    dummy = tokenizer(
        "This video is amazing keep it up great content!",
        return_tensors="pt",
        truncation=True,
        padding="max_length",
        max_length=MAX_LENGTH,
    )
    input_ids      = dummy["input_ids"]
    attention_mask = dummy["attention_mask"]

    with torch.no_grad():
        torch.onnx.export(
            model,
            (input_ids, attention_mask),
            str(ONNX_FILE),
            input_names=["input_ids", "attention_mask"],
            output_names=["logits"],
            dynamic_axes={
                "input_ids":      {0: "batch_size", 1: "sequence_length"},
                "attention_mask": {0: "batch_size", 1: "sequence_length"},
                "logits":         {0: "batch_size"},
            },
            opset_version=14,
            do_constant_folding=True,
        )
    full_mb = ONNX_FILE.stat().st_size / 1024 / 1024
    print(f"  ✓ {ONNX_FILE.name}  ({full_mb:.1f} MB)")

    # ── Step 3: int8 dynamic quantization ────────────────────────────────────
    print("Quantizing (int8 dynamic) …")
    quantize_dynamic(
        model_input=str(ONNX_FILE),
        model_output=str(QUANT_FILE),
        weight_type=QuantType.QInt8,
    )
    quant_mb = QUANT_FILE.stat().st_size / 1024 / 1024
    print(f"  ✓ {QUANT_FILE.name}  ({quant_mb:.1f} MB)")

    # ── Step 4: copy tokenizer + config files ─────────────────────────────────
    for fname in ["config.json", "tokenizer_config.json", "tokenizer.json",
                  "vocab.txt", "special_tokens_map.json"]:
        src = SRC_MODEL / fname
        dst = ONNX_DIR / fname
        if src.exists():
            shutil.copy(src, dst)

    print(f"\n✓ Done.")
    print(f"  Full:      {full_mb:.1f} MB  → {ONNX_FILE}")
    print(f"  Quantized: {quant_mb:.1f} MB → {QUANT_FILE}")
    print(f"\nNext: upload {ONNX_DIR} to HuggingFace Hub")
    print("  huggingface-cli login")
    print("  huggingface-cli upload <username>/yt-bot-comment-detector models/yt-bot-detector-onnx .")


if __name__ == "__main__":
    main()
