#!/usr/bin/env python3
"""
Fine-tune DistilBERT on training_data.csv to detect YouTube bot comments.
Output: models/yt-bot-detector/  (HuggingFace model directory)

Usage:
    cd yt-bot-detector
    pip install transformers torch scikit-learn
    python3 training/train_classifier.py
"""

import csv
import random
from pathlib import Path

import torch
from sklearn.metrics import classification_report
from torch.utils.data import Dataset
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
    EarlyStoppingCallback,
)

# ─── Config ──────────────────────────────────────────────────────────────────

BASE_MODEL   = "distilbert-base-uncased"
DATA_FILE    = Path(__file__).parent.parent / "dataset" / "training_data.csv"
OUTPUT_DIR   = Path(__file__).parent.parent / "models" / "yt-bot-detector"
MAX_LENGTH   = 128
TRAIN_SPLIT  = 0.85
SEED         = 42
BATCH_SIZE   = 32
EPOCHS       = 4
LR           = 2e-5

# Use MPS on Apple Silicon, CUDA if available, else CPU
DEVICE = (
    "mps"  if torch.backends.mps.is_available() else
    "cuda" if torch.cuda.is_available()         else
    "cpu"
)

# ─── Dataset ─────────────────────────────────────────────────────────────────

class CommentDataset(Dataset):
    def __init__(self, encodings: dict, labels: list[int]):
        self.encodings = encodings
        self.labels    = labels

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, idx: int) -> dict:
        item = {k: torch.tensor(v[idx]) for k, v in self.encodings.items()}
        item["labels"] = torch.tensor(self.labels[idx])
        return item


def load_data(path: Path) -> tuple[list[str], list[int]]:
    texts, labels = [], []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            text = row["text"].strip()
            if text:
                texts.append(text)
                labels.append(int(row["label"]))
    return texts, labels


def split(texts: list[str], labels: list[int], ratio: float, seed: int):
    combined = list(zip(texts, labels))
    random.seed(seed)
    random.shuffle(combined)
    cut = int(len(combined) * ratio)
    train = combined[:cut]
    val   = combined[cut:]
    return (
        [t for t, _ in train], [l for _, l in train],
        [t for t, _ in val],   [l for _, l in val],
    )


# ─── Metrics ─────────────────────────────────────────────────────────────────

import numpy as np
from transformers import EvalPrediction

def compute_metrics(p: EvalPrediction) -> dict:
    preds  = np.argmax(p.predictions, axis=1)
    labels = p.label_ids
    report = classification_report(labels, preds, target_names=["human", "bot"], output_dict=True)
    return {
        "accuracy":  report["accuracy"],
        "f1_bot":    report["bot"]["f1-score"],
        "f1_human":  report["human"]["f1-score"],
        "precision_bot": report["bot"]["precision"],
        "recall_bot":    report["bot"]["recall"],
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    print(f"Device: {DEVICE}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading data …")
    texts, labels = load_data(DATA_FILE)
    print(f"  {len(texts)} rows  |  bot={sum(labels)}  human={len(labels)-sum(labels)}")

    train_texts, train_labels, val_texts, val_labels = split(texts, labels, TRAIN_SPLIT, SEED)
    print(f"  train={len(train_texts)}  val={len(val_texts)}")

    print("Tokenizing …")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    train_enc = tokenizer(train_texts, truncation=True, padding=True, max_length=MAX_LENGTH)
    val_enc   = tokenizer(val_texts,   truncation=True, padding=True, max_length=MAX_LENGTH)

    train_ds = CommentDataset(train_enc, train_labels)
    val_ds   = CommentDataset(val_enc,   val_labels)

    print("Loading model …")
    model = AutoModelForSequenceClassification.from_pretrained(
        BASE_MODEL,
        num_labels=2,
        id2label={0: "human", 1: "bot"},
        label2id={"human": 0, "bot": 1},
    )

    args = TrainingArguments(
        output_dir=str(OUTPUT_DIR / "checkpoints"),
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        per_device_eval_batch_size=BATCH_SIZE,
        learning_rate=LR,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1_bot",
        logging_steps=50,
        seed=SEED,
        use_mps_device=(DEVICE == "mps"),
        report_to="none",
    )

    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2)],
    )

    print("Training …")
    trainer.train()

    print("Saving model + tokenizer …")
    trainer.save_model(str(OUTPUT_DIR))
    tokenizer.save_pretrained(str(OUTPUT_DIR))

    # Final eval
    print("\nFinal evaluation:")
    metrics = trainer.evaluate()
    for k, v in metrics.items():
        print(f"  {k}: {v:.4f}" if isinstance(v, float) else f"  {k}: {v}")

    print(f"\n✓ Model saved → {OUTPUT_DIR}")
    print("Next: python3 training/export_onnx.py")


if __name__ == "__main__":
    main()
