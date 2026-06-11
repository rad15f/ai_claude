#!/usr/bin/env python3
"""Convert Hello-SimpleAI/chatgpt-detector-roberta to ONNX + int8 for Transformers.js."""

import shutil
import subprocess
import sys
from pathlib import Path

MODEL_ID = "Hello-SimpleAI/chatgpt-detector-roberta"
OUTPUT_DIR = Path(__file__).resolve().parent / "chatgpt-detector-roberta-onnx"
VENV_DIR = Path(__file__).resolve().parent / ".venv-onnx"

REQUIRED_PACKAGES = [
    "optimum[onnxruntime]",
    "transformers",
    "onnx",
    "onnxruntime",
    "torch",
    "huggingface_hub",
]


def venv_python() -> Path:
    if sys.prefix == str(VENV_DIR.resolve()):
        return Path(sys.executable)

    if not VENV_DIR.exists():
        print(f"Creating virtualenv at {VENV_DIR}...")
        if shutil.which("uv"):
            subprocess.check_call(["uv", "venv", str(VENV_DIR), "--python", "3.11"])
        else:
            subprocess.check_call([sys.executable, "-m", "venv", str(VENV_DIR)])

    return VENV_DIR / "bin" / "python"


def ensure_packages() -> None:
    python = venv_python()
    if python.resolve() != Path(sys.executable).resolve():
        subprocess.check_call([str(python), __file__])
        raise SystemExit(0)

    install_cmd = [str(python), "-m", "pip", "install", "-q", "--upgrade", "pip"]
    if shutil.which("uv"):
        install_cmd = ["uv", "pip", "install", "--python", str(python), "-q"]

    for package in REQUIRED_PACKAGES:
        print(f"Ensuring {package} is installed...")
        subprocess.check_call(install_cmd + [package])


def export_to_onnx() -> None:
    from optimum.exporters.onnx import main_export

    print(f"Exporting {MODEL_ID} to ONNX...")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    main_export(
        model_name_or_path=MODEL_ID,
        output=str(OUTPUT_DIR),
        task="text-classification",
    )
    print(f"ONNX export saved to {OUTPUT_DIR}")


def quantize_int8() -> None:
    from optimum.onnxruntime import ORTQuantizer
    from optimum.onnxruntime.configuration import AutoQuantizationConfig

    print("Quantizing to int8 (dynamic)...")
    quantizer = ORTQuantizer.from_pretrained(str(OUTPUT_DIR))
    qconfig = AutoQuantizationConfig.avx512(is_static=False, per_channel=False)
    quantizer.quantize(save_dir=str(OUTPUT_DIR), quantization_config=qconfig)

    quantized = OUTPUT_DIR / "model_quantized.onnx"
    if not quantized.exists():
        raise FileNotFoundError(f"Expected quantized model at {quantized}")

    size_mb = quantized.stat().st_size / (1024 * 1024)
    print(f"Quantized model: {quantized} ({size_mb:.1f} MB)")


def main() -> None:
    ensure_packages()
    export_to_onnx()
    quantize_int8()
    print("\nDone. Upload with:")
    print(f"  huggingface-cli upload <username>/chatgpt-detector-roberta-onnx {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
