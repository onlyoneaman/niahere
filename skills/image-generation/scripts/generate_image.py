#!/usr/bin/env python3
"""
General-purpose image generation using OpenAI (default) or Gemini.

Supports:
  - OpenAI: gpt-image-1.5 (default), gpt-image-1, gpt-image-1-mini
  - Gemini: gemini-3.1-flash-image-preview (default), gemini-3-pro-image-preview, gemini-2.5-flash-image

Usage:
  # OpenAI (default)
  python3 generate_image.py --prompt "A sunset over mountains"

  # OpenAI with reference image (edit mode)
  python3 generate_image.py --prompt "Add a hot air balloon" --reference photo.png

  # Gemini
  python3 generate_image.py --provider gemini --prompt "A sunset over mountains"

  # Gemini with reference image
  python3 generate_image.py --provider gemini --prompt "Same person in a cafe" --reference face.png
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
NIA_HOME = Path(os.environ.get("NIA_HOME", Path.home() / ".niahere"))
NIA_CONFIG = NIA_HOME / "config.yaml"
TIMESTAMP_FORMAT = "%Y%m%d_%H%M%S"

# --- Provider defaults ---
OPENAI_DEFAULT_MODEL = "gpt-image-1.5"
GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-image-preview"

DEFAULT_ASPECT_RATIO = "1:1"
ALLOWED_ASPECT_RATIOS = (
    "1:1", "3:4", "4:3", "9:16", "16:9",
    "2:3", "3:2", "4:5", "5:4", "21:9",
)

# OpenAI size mappings (closest match for aspect ratio)
OPENAI_SIZE_MAP = {
    "1:1": "1024x1024",
    "3:4": "1024x1536",
    "4:3": "1536x1024",
    "9:16": "1024x1536",
    "16:9": "1536x1024",
    "2:3": "1024x1536",
    "3:2": "1536x1024",
    "4:5": "1024x1536",
    "5:4": "1536x1024",
    "21:9": "1536x1024",
}

# OpenAI quality options
OPENAI_QUALITIES = ("auto", "high", "medium", "low")


def safe_mime(path: str) -> str:
    mime, _ = mimetypes.guess_type(path)
    return mime or "image/png"


def encode_file(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def resolve_output_path(output: str | None, ext: str = ".png") -> Path:
    if output:
        out = Path(output).expanduser()
        if out.suffix:
            return out
        return out / f"image_{time.strftime(TIMESTAMP_FORMAT)}{ext}"
    return Path(f"/tmp/image_{time.strftime(TIMESTAMP_FORMAT)}{ext}")


def read_config_key(key: str) -> str:
    """Read a key from ~/.niahere/config.yaml."""
    if not NIA_CONFIG.is_file():
        return ""
    try:
        import importlib
        yaml = importlib.import_module("yaml")
        with NIA_CONFIG.open("r") as f:
            config = yaml.safe_load(f)
        if config and isinstance(config, dict):
            return config.get(key, "") or ""
    except Exception:
        for line in NIA_CONFIG.read_text().splitlines():
            if line.startswith(f"{key}:"):
                val = line.split(":", 1)[1].strip().strip("'\"")
                return val
    return ""


def resolve_api_key(provider: str, cli_key: str | None) -> str:
    if cli_key:
        return cli_key

    if provider == "openai":
        return (
            os.environ.get("OPENAI_API_KEY", "")
            or read_config_key("openai_api_key")
        )
    else:
        return (
            os.environ.get("GEMINI_API_KEY", "")
            or os.environ.get("GOOGLE_API_KEY", "")
            or read_config_key("gemini_api_key")
        )


# --- OpenAI Generation ---

def generate_openai(
    api_key: str,
    prompt: str,
    model: str,
    size: str,
    quality: str,
    reference_path: str | None = None,
    n: int = 1,
) -> tuple[bytes, str]:
    """Generate image via OpenAI Images API."""
    if reference_path and Path(reference_path).is_file():
        return _openai_edit(api_key, prompt, reference_path, model, size, quality, n)
    return _openai_generate(api_key, prompt, model, size, quality, n)


def _openai_generate(
    api_key: str, prompt: str, model: str, size: str, quality: str, n: int
) -> tuple[bytes, str]:
    url = "https://api.openai.com/v1/images/generations"
    payload: dict = {
        "model": model,
        "prompt": prompt,
        "n": n,
        "size": size,
        "response_format": "b64_json",
    }
    if model == "gpt-image-1":
        payload["quality"] = quality

    req = urllib.request.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    return _openai_request(req)


def _openai_edit(
    api_key: str, prompt: str, reference_path: str, model: str, size: str,
    quality: str, n: int
) -> tuple[bytes, str]:
    """Use OpenAI images/edits endpoint with a reference image."""
    import io

    boundary = f"----PythonBoundary{int(time.time() * 1000)}"
    body = io.BytesIO()

    def add_field(name: str, value: str) -> None:
        body.write(f"--{boundary}\r\n".encode())
        body.write(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        body.write(f"{value}\r\n".encode())

    def add_file(name: str, filepath: str) -> None:
        filename = Path(filepath).name
        mime = safe_mime(filepath)
        body.write(f"--{boundary}\r\n".encode())
        body.write(
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode()
        )
        body.write(f"Content-Type: {mime}\r\n\r\n".encode())
        with open(filepath, "rb") as f:
            body.write(f.read())
        body.write(b"\r\n")

    add_file("image[]", reference_path)
    add_field("prompt", prompt)
    add_field("model", model)
    add_field("n", str(n))
    add_field("size", size)
    if model == "gpt-image-1":
        add_field("quality", quality)
    body.write(f"--{boundary}--\r\n".encode())

    url = "https://api.openai.com/v1/images/edits"
    req = urllib.request.Request(
        url=url,
        data=body.getvalue(),
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Authorization": f"Bearer {api_key}",
        },
    )
    return _openai_request(req)


def _openai_request(req: urllib.request.Request) -> tuple[bytes, str]:
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            response = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(
            f"OpenAI API error (HTTP {e.code}): {detail or e.reason}"
        ) from e

    data_list = response.get("data", [])
    if not data_list:
        raise RuntimeError(f"No data in OpenAI response: {json.dumps(response, indent=2)}")

    b64 = data_list[0].get("b64_json")
    if not b64:
        raise RuntimeError("No b64_json in OpenAI response.")

    return base64.b64decode(b64), "image/png"


# --- Gemini Generation ---

def generate_gemini(
    api_key: str,
    prompt: str,
    model: str,
    aspect_ratio: str,
    reference_path: str | None = None,
) -> tuple[bytes, str]:
    """Generate image via Gemini API."""
    url = (
        "https://generativelanguage.googleapis.com/"
        f"v1beta/models/{model}:generateContent?key={api_key}"
    )

    parts: list[dict] = []
    if reference_path and Path(reference_path).is_file():
        parts.append({
            "inlineData": {
                "mimeType": safe_mime(reference_path),
                "data": encode_file(reference_path),
            }
        })
    parts.append({"text": prompt})

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "imageConfig": {"aspectRatio": aspect_ratio},
            "responseModalities": ["TEXT", "IMAGE"],
        },
    }

    req = urllib.request.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            response = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(
            f"Gemini API error (HTTP {e.code}): {detail or e.reason}"
        ) from e

    candidates = response.get("candidates", [])
    if not candidates:
        raise RuntimeError("No candidates in Gemini response.")

    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        inline = part.get("inlineData")
        if not inline:
            continue
        mime = inline.get("mimeType")
        img_data = inline.get("data")
        if mime and img_data:
            return base64.b64decode(img_data), mime

    raise RuntimeError(
        f"No image in Gemini response: {json.dumps(response, indent=2)}"
    )


# --- CLI ---

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate images using OpenAI (default) or Gemini.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --prompt "A cat on a skateboard"
  %(prog)s --prompt "Oil painting of a forest" --quality high
  %(prog)s --provider gemini --prompt "Watercolor sunset" --aspect-ratio 16:9
  %(prog)s --prompt "Add wings to this bird" --reference bird.png
  %(prog)s --provider gemini --reference face.png --prompt "Same person at beach" --aspect-ratio 9:16
        """,
    )
    parser.add_argument(
        "--provider", choices=["openai", "gemini"], default="openai",
        help="Image generation provider. Default: openai.",
    )
    parser.add_argument(
        "--prompt", required=True,
        help="Text prompt describing the image to generate.",
    )
    parser.add_argument(
        "--reference", default=None,
        help="Path to a reference image. OpenAI uses edit mode; Gemini includes it as context.",
    )
    parser.add_argument(
        "--model", default=None,
        help=f"Model override. Defaults: OpenAI={OPENAI_DEFAULT_MODEL}, Gemini={GEMINI_DEFAULT_MODEL}.",
    )
    parser.add_argument(
        "--aspect-ratio", default=DEFAULT_ASPECT_RATIO, choices=ALLOWED_ASPECT_RATIOS,
        help=f"Aspect ratio. Default: {DEFAULT_ASPECT_RATIO}.",
    )
    parser.add_argument(
        "--quality", default="auto", choices=OPENAI_QUALITIES,
        help="OpenAI quality (gpt-image-1 only). Default: auto.",
    )
    parser.add_argument(
        "--n", type=int, default=1,
        help="Number of images (OpenAI only). Default: 1.",
    )
    parser.add_argument(
        "--output", default=None,
        help="Output path. Directory = timestamped file. Default: /tmp/.",
    )
    parser.add_argument(
        "--api-key", default=None,
        help="API key override. Otherwise reads from env var or ~/.niahere/config.yaml.",
    )
    args = parser.parse_args()

    provider = args.provider
    model = args.model or (OPENAI_DEFAULT_MODEL if provider == "openai" else GEMINI_DEFAULT_MODEL)

    api_key = resolve_api_key(provider, args.api_key)
    if not api_key:
        config_key = "openai_api_key" if provider == "openai" else "gemini_api_key"
        env_var = "OPENAI_API_KEY" if provider == "openai" else "GEMINI_API_KEY"
        raise SystemExit(
            f"Missing API key. Provide --api-key, set {env_var} in environment, "
            f"or add {config_key} to {NIA_CONFIG}."
        )

    if args.reference and not Path(args.reference).expanduser().is_file():
        raise SystemExit(f"Reference image not found: {args.reference}")

    ref = str(Path(args.reference).expanduser()) if args.reference else None

    try:
        if provider == "openai":
            size = OPENAI_SIZE_MAP.get(args.aspect_ratio, "1024x1024")
            image_data, mime = generate_openai(
                api_key=api_key, prompt=args.prompt, model=model,
                size=size, quality=args.quality, reference_path=ref, n=args.n,
            )
        else:
            image_data, mime = generate_gemini(
                api_key=api_key, prompt=args.prompt, model=model,
                aspect_ratio=args.aspect_ratio, reference_path=ref,
            )

        ext = ".png" if "png" in mime else ".jpg"
        out = resolve_output_path(args.output, ext)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(image_data)
        print(f"Saved: {out}")
        print(f"Provider: {provider} | Model: {model} | Size/Ratio: {args.aspect_ratio}")
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
