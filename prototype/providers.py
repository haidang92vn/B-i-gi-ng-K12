"""Provider-neutral structured generation boundary.

Secrets are deliberately accepted only by these server-side adapters. Callers
receive a normalised error and never receive provider exception text.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Protocol


DEFAULT_MODELS = {"openai": "gpt-4.1-mini", "gemini": "gemini-2.5-flash"}


class ProviderError(RuntimeError):
    """An external provider could not produce a usable response."""


@dataclass
class ProviderResult:
    payload: dict
    metadata: dict = field(default_factory=dict)


class AIProvider(Protocol):
    def generate_structured(self, *, prompt: str, schema: dict) -> ProviderResult: ...


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
