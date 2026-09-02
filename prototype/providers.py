"""Provider-neutral structured generation boundary.

Secrets are deliberately accepted only by these server-side adapters. Callers
receive a normalised error and never receive provider exception text.
"""
from __future__ import annotations

import json
import base64
import io
import wave
from dataclasses import dataclass, field
from typing import Protocol


DEFAULT_MODELS = {"openai": "gpt-4.1-mini", "gemini": "gemini-2.5-flash"}
MEDIA_MODELS = {
    "openai": {"image": "gpt-image-1", "tts": "gpt-4o-mini-tts"},
    "gemini": {"image": "gemini-3.1-flash-image", "tts": "gemini-3.1-flash-tts-preview"},
}


class ProviderError(RuntimeError):
    """An external provider could not produce a usable response."""


@dataclass
class ProviderResult:
    payload: dict
    metadata: dict = field(default_factory=dict)


@dataclass
class MediaResult:
    content: bytes
    mime_type: str
    metadata: dict = field(default_factory=dict)


class AIProvider(Protocol):
    def generate_structured(self, *, prompt: str, schema: dict) -> ProviderResult: ...


class MediaProvider(Protocol):
    def generate_image(self, *, prompt: str) -> MediaResult: ...
    def synthesize_speech(self, *, text: str, voice: str) -> MediaResult: ...


class MockProvider:
    def generate_structured(self, *, prompt: str, schema: dict) -> ProviderResult:
        return ProviderResult({"provider": "mock", "notice": "No external request was made."}, {"model": "mock"})


class OpenAIProvider:
    def __init__(self, api_key: str, model: str):
        self.api_key, self.model = api_key, model

    def generate_structured(self, *, prompt: str, schema: dict) -> ProviderResult:
        try:
            from openai import OpenAI
            response = OpenAI(api_key=self.api_key).responses.create(
                model=self.model, input=prompt, store=False,
                text={"format": {"type": "json_schema", "name": "course_output",
                                  "strict": False, "schema": schema}},
            )
            usage = getattr(response, "usage", None)
            return ProviderResult(json.loads(response.output_text), {
                "model": getattr(response, "model", self.model), "request_id": getattr(response, "id", None),
                "input_tokens": getattr(usage, "input_tokens", None), "output_tokens": getattr(usage, "output_tokens", None),
            })
        except Exception as exc:
            raise ProviderError("OpenAI could not generate a valid response.") from exc


class GeminiProvider:
    def __init__(self, api_key: str, model: str):
        self.api_key, self.model = api_key, model

    def generate_structured(self, *, prompt: str, schema: dict) -> ProviderResult:
        try:
            from google import genai
            response = genai.Client(api_key=self.api_key).models.generate_content(
                model=self.model, contents=prompt,
                config={"response_mime_type": "application/json", "response_json_schema": schema},
            )
            usage = getattr(response, "usage_metadata", None)
            return ProviderResult(json.loads(response.text), {
                "model": self.model, "request_id": getattr(response, "response_id", None),
                "input_tokens": getattr(usage, "prompt_token_count", None), "output_tokens": getattr(usage, "candidates_token_count", None),
            })
        except Exception as exc:
            raise ProviderError("Gemini could not generate a valid response.") from exc


def provider_for(provider: str, *, api_key: str, model: str | None) -> AIProvider:
    selected_model = model or DEFAULT_MODELS.get(provider)
    if provider == "openai":
        return OpenAIProvider(api_key, selected_model or "gpt-4.1-mini")
    if provider == "gemini":
        return GeminiProvider(api_key, selected_model or "gemini-2.5-flash")
    raise ValueError("Unsupported AI provider.")


def _wav_from_pcm(content: bytes, sample_rate: int = 24000) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(content)
    return output.getvalue()


class MockMediaProvider:
    """Deterministic preview assets so the demo works without a provider key."""
    _PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4WAAAAABJRU5ErkJggg==")

    def generate_image(self, *, prompt: str) -> MediaResult:
        return MediaResult(self._PNG, "image/png", {"model": "mock-image"})

    def synthesize_speech(self, *, text: str, voice: str) -> MediaResult:
        return MediaResult(_wav_from_pcm(b"\x00\x00" * 2400), "audio/wav", {"model": "mock-tts", "voice": voice})


class OpenAIMediaProvider:
    def __init__(self, api_key: str):
        self.api_key = api_key

    def generate_image(self, *, prompt: str) -> MediaResult:
        try:
            from openai import OpenAI
            response = OpenAI(api_key=self.api_key).images.generate(
                model=MEDIA_MODELS["openai"]["image"], prompt=prompt, size="1536x1024",
                quality="low", output_format="png",
            )
            encoded = response.data[0].b64_json
            if not encoded:
                raise ValueError("Image response was empty.")
            return MediaResult(base64.b64decode(encoded), "image/png", {
                "model": MEDIA_MODELS["openai"]["image"], "request_id": getattr(response, "_request_id", None),
            })
        except Exception as exc:
            raise ProviderError("OpenAI could not generate an image.") from exc

    def synthesize_speech(self, *, text: str, voice: str) -> MediaResult:
        try:
            from openai import OpenAI
            response = OpenAI(api_key=self.api_key).audio.speech.create(
                model=MEDIA_MODELS["openai"]["tts"], voice=voice, input=text, response_format="mp3",
            )
            content = response.read() if hasattr(response, "read") else response.content
            return MediaResult(content, "audio/mpeg", {
                "model": MEDIA_MODELS["openai"]["tts"], "request_id": getattr(response, "_request_id", None), "voice": voice,
            })
        except Exception as exc:
            raise ProviderError("OpenAI could not synthesize speech.") from exc


class GeminiMediaProvider:
    def __init__(self, api_key: str):
        self.api_key = api_key

    def generate_image(self, *, prompt: str) -> MediaResult:
        try:
            from google import genai
            response = genai.Client(api_key=self.api_key).interactions.create(
                model=MEDIA_MODELS["gemini"]["image"], input=prompt,
                response_format={"type": "image", "mime_type": "image/png", "aspect_ratio": "16:9"},
            )
            encoded = response.output_image.data
            return MediaResult(base64.b64decode(encoded), "image/png", {
                "model": MEDIA_MODELS["gemini"]["image"], "request_id": getattr(response, "id", None),
            })
        except Exception as exc:
            raise ProviderError("Gemini could not generate an image.") from exc

    def synthesize_speech(self, *, text: str, voice: str) -> MediaResult:
        try:
            from google import genai
            response = genai.Client(api_key=self.api_key).interactions.create(
                model=MEDIA_MODELS["gemini"]["tts"], input=text,
                response_format={"type": "audio"}, generation_config={"speech_config": [{"voice": voice}]},
            )
            encoded = response.output_audio.data
            return MediaResult(_wav_from_pcm(base64.b64decode(encoded)), "audio/wav", {
                "model": MEDIA_MODELS["gemini"]["tts"], "request_id": getattr(response, "id", None), "voice": voice,
            })
        except Exception as exc:
            raise ProviderError("Gemini could not synthesize speech.") from exc


def media_provider_for(provider: str, *, api_key: str | None = None) -> MediaProvider:
    if provider == "mock":
        return MockMediaProvider()
    if not api_key:
        raise ValueError("An API key is required for this media provider.")
    if provider == "openai":
        return OpenAIMediaProvider(api_key)
    if provider == "gemini":
        return GeminiMediaProvider(api_key)
    raise ValueError("Unsupported media provider.")
