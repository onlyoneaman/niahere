#!/usr/bin/env python3
"""
Generate an image using Gemini image generation, optionally with a reference image.
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
PROJECT_ROOT = SCRIPT_DIR.parent
NIA_HOME = Path(os.environ.get("NIA_HOME", Path.home() / ".niahere"))
NIA_CONFIG = NIA_HOME / "config.yaml"
DEFAULT_MODEL = "gemini-3.1-flash-image-preview"
PRO_MODEL = "gemini-3-pro-image-preview"
BASIC_MODEL = "gemini-2.5-flash-image"
USER_REFERENCE = str(NIA_HOME / "images" / "reference.png")
DEFAULT_REFERENCE = str(PROJECT_ROOT / "assets" / "nia-reference.webp")
DEFAULT_OUTPUT = str(NIA_HOME / "images")
DEFAULT_PROMPT = (
    "Generate a warm, natural portrait matching the reference image. "
    "Keep the same face and style. Realistic skin, natural lighting, photorealistic."
)
TIMESTAMP_FORMAT = "%Y%m%d_%H%M%S"
DEFAULT_ASPECT_RATIO = "3:4"
ALLOWED_ASPECT_RATIOS = (
    "1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "4:5", "5:4", "21:9",
)


def safe_mime(path: str) -> str:
    mime, _ = mimetypes.guess_type(path)
    return mime or "image/png"


def encode_file(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def resolve_output_path(output: str | None, mime_type: str) -> Path:
    ext = ".png" if "png" in mime_type else ".jpg"
    if output:
        out = Path(output).expanduser()
        if out.suffix:
            return out
        return out / f"nia_{time.strftime(TIMESTAMP_FORMAT)}{ext}"
    return Path(f"/tmp/nia_{time.strftime(TIMESTAMP_FORMAT)}{ext}")


def read_config_key() -> str:
    """Read gemini_api_key from niahere config.yaml."""
    if not NIA_CONFIG.is_file():
        return ""
    try:
        import importlib
        yaml = importlib.import_module("yaml")
        with NIA_CONFIG.open("r") as f:
            config = yaml.safe_load(f)
        if config and isinstance(config, dict):
            return config.get("gemini_api_key", "") or ""
    except Exception:
        # Fall back to simple grep if PyYAML not available
        for line in NIA_CONFIG.read_text().splitlines():
            if line.startswith("gemini_api_key:"):
                val = line.split(":", 1)[1].strip().strip("'\"")
                return val
    return ""


def resolve_api_key(cli_key: str | None) -> str:
    if cli_key:
        return cli_key
    # Check environment variable
    env_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if env_key:
        return env_key
    # Read from niahere config.yaml
    return read_config_key()


def generate_image(
    api_key: str, prompt: str, reference_path: str | None, model: str, aspect_ratio: str
) -> tuple[bytes, str]:
    url = (
        "https://generativelanguage.googleapis.com/"
        f"v1beta/models/{model}:generateContent?key={api_key}"
    )

    parts: list[dict] = []
    if reference_path:
        mime_type = safe_mime(reference_path)
        reference_b64 = encode_file(reference_path)
        parts.append({
            "inlineData": {"mimeType": mime_type, "data": reference_b64}
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
            f"Gemini API error (HTTP {e.code}). Response: {detail or e.reason}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error while calling Gemini API: {e}") from e

    candidates = response.get("candidates", [])
    if not candidates:
        raise RuntimeError("No candidates in Gemini response.")

    response_parts = candidates[0].get("content", {}).get("parts", [])
    for part in response_parts:
        inline = part.get("inlineData")
        if not inline:
            continue
        mime = inline.get("mimeType")
        img_data = inline.get("data")
        if mime and img_data:
            return base64.b64decode(img_data), mime

    raise RuntimeError(
        f"No image part in Gemini response. Full response: {json.dumps(response, indent=2)}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate Nia image using Gemini image generation."
    )
    parser.add_argument(
        "--prompt", default=DEFAULT_PROMPT,
        help="Prompt describing the requested visual output.",
    )
    parser.add_argument(
        "--reference", default=None,
        help=f"Path to reference image for identity consistency. Defaults to {DEFAULT_REFERENCE} if it exists.",
    )
    parser.add_argument(
        "--no-reference", action="store_true",
        help="Generate without a reference image (for initial reference creation).",
    )
    parser.add_argument(
        "--model", default=DEFAULT_MODEL,
        help=f"Gemini model. Defaults to {DEFAULT_MODEL}. Alternatives: {PRO_MODEL}, {BASIC_MODEL}.",
    )
    parser.add_argument(
        "--output", default=DEFAULT_OUTPUT,
        help="Output file or directory path.",
    )
    parser.add_argument(
        "--api-key", default=None,
        help="Optional explicit API key. If omitted, reads from GEMINI_API_KEY env var or config.yaml.",
    )
    parser.add_argument(
        "--aspect-ratio", default=DEFAULT_ASPECT_RATIO,
        choices=ALLOWED_ASPECT_RATIOS,
        help=f"Target aspect ratio. Defaults to {DEFAULT_ASPECT_RATIO}.",
    )
    args = parser.parse_args()

    try:
        api_key = resolve_api_key(args.api_key)
        if not api_key:
            raise RuntimeError(
                "Missing API key. Provide --api-key, set GEMINI_API_KEY env var, "
                f"or add gemini_api_key to {NIA_CONFIG}."
            )

        # Resolve reference image: user's ~/.niahere/images/reference.png > skill default > none
        ref_path: str | None = None
        if not args.no_reference:
            if args.reference:
                ref_resolved = Path(args.reference).expanduser()
                if ref_resolved.is_file():
                    ref_path = str(ref_resolved)
                else:
                    raise RuntimeError(f"Reference image not found: {ref_resolved}")
            else:
                user_ref = Path(USER_REFERENCE).expanduser()
                default_ref = Path(DEFAULT_REFERENCE)
                if user_ref.is_file():
                    ref_path = str(user_ref)
                elif default_ref.is_file():
                    ref_path = str(default_ref)

        image_data, mime_type = generate_image(
            api_key=api_key,
            prompt=args.prompt,
            reference_path=ref_path,
            model=args.model,
            aspect_ratio=args.aspect_ratio,
        )

        out = resolve_output_path(args.output, mime_type)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(image_data)
        print(f"Saved: {out}")
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
