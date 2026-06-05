"""
Unified LLM client — dispatches to the right SDK based on provider.

Supported providers:
  "anthropic"    — Anthropic Claude (native SDK, streaming)
  "llamacpp"     — local llama.cpp server (OpenAI-compat /v1/chat/completions)
  "openai_compat"— any OpenAI-compatible endpoint (vLLM, together.ai, etc.)
  "gemini"       — Google Gemini (google-generativeai SDK, run in thread)

Returns an `LLMResult` carrying the full text plus token usage. `result.text`
is convenient for callers that only want the string. `bool(result)` works the
same as `bool(result.text)` so existing truthy checks keep working.

Usage:
    result = await chat_completion(
        messages=[{"role": "system", "content": sys}, {"role": "user", "content": usr}],
        provider="anthropic",
        base_url="https://api.anthropic.com",
        model_name="claude-sonnet-4-6",
        api_key="sk-...",
        max_tokens=2048,
        temperature=0.3,
        stream_cb=lambda token: write_token(job_id, token),
    )
    text = result.text
    await track_response_async(service_name="reasoning_agent", result=result)
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)


@dataclass
class LLMResult:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    model_name: str = ""
    provider: str = ""

    # Backwards compat — old callers did `raw = await chat_completion(...)`
    # then operated on `raw` as a string. Keep those working.
    def __str__(self) -> str:
        return self.text

    def __bool__(self) -> bool:
        return bool(self.text)

    def __len__(self) -> int:
        return len(self.text)

    def __contains__(self, item: object) -> bool:
        return item in self.text

    def strip(self, *args, **kwargs) -> str:
        return self.text.strip(*args, **kwargs)


async def chat_completion(
    messages: list[dict],
    *,
    provider: str,
    base_url: str,
    model_name: str,
    api_key: str | None = None,
    max_tokens: int = 2048,
    temperature: float = 0.3,
    stream_cb: Callable[[str], Awaitable[None]] | None = None,
) -> LLMResult:
    """
    Run a chat completion. Returns an LLMResult with full text + token usage.
    If stream_cb is provided, each token/chunk is passed to it as it arrives.
    """
    logger.debug("LLM call: provider=%s model=%s tokens=%d", provider, model_name, max_tokens)

    if provider == "anthropic":
        return await _anthropic(
            messages, model_name=model_name, api_key=api_key,
            max_tokens=max_tokens, temperature=temperature, stream_cb=stream_cb,
        )
    if provider in ("llamacpp", "openai_compat"):
        return await _openai_compat(
            messages, base_url=base_url, model_name=model_name, api_key=api_key,
            max_tokens=max_tokens, temperature=temperature, stream_cb=stream_cb,
            provider=provider,
        )
    if provider == "gemini":
        return await _gemini(
            messages, model_name=model_name, api_key=api_key,
            max_tokens=max_tokens, temperature=temperature, stream_cb=stream_cb,
        )
    raise ValueError(f"Unknown LLM provider: {provider!r}")


# ── Provider implementations ───────────────────────────────────────────────────

async def _anthropic(
    messages: list[dict],
    *,
    model_name: str,
    api_key: str | None,
    max_tokens: int,
    temperature: float,
    stream_cb: Callable[[str], Awaitable[None]] | None,
) -> LLMResult:
    import anthropic

    system = ""
    chat = []
    for m in messages:
        if m["role"] == "system":
            system = m["content"]
        else:
            chat.append(m)

    client = anthropic.AsyncAnthropic(api_key=api_key or "")
    kwargs: dict = dict(
        model=model_name,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=chat,
    )
    if system:
        kwargs["system"] = system

    full_text = ""
    in_tok = 0
    out_tok = 0
    async with client.messages.stream(**kwargs) as stream:
        async for token in stream.text_stream:
            full_text += token
            if stream_cb:
                await stream_cb(token)
        try:
            final = await stream.get_final_message()
            usage = getattr(final, "usage", None)
            if usage is not None:
                in_tok = int(getattr(usage, "input_tokens", 0) or 0)
                out_tok = int(getattr(usage, "output_tokens", 0) or 0)
        except Exception as exc:
            logger.debug("anthropic usage extract failed: %s", exc)

    return LLMResult(
        text=full_text,
        input_tokens=in_tok,
        output_tokens=out_tok,
        model_name=model_name,
        provider="anthropic",
    )


async def _openai_compat(
    messages: list[dict],
    *,
    base_url: str,
    model_name: str,
    api_key: str | None,
    max_tokens: int,
    temperature: float,
    stream_cb: Callable[[str], Awaitable[None]] | None,
    provider: str,
) -> LLMResult:
    """
    Works with llama.cpp server (--parallel N --cont-batching) and any
    other OpenAI-compatible endpoint.
    """
    import openai

    url = base_url.rstrip("/")
    if not url.endswith("/v1"):
        url = f"{url}/v1"

    client = openai.AsyncOpenAI(
        base_url=url,
        api_key=api_key or "no-key-needed",
    )

    full_text = ""
    in_tok = 0
    out_tok = 0
    if stream_cb:
        stream = await client.chat.completions.create(
            model=model_name,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True,
            stream_options={"include_usage": True},
        )
        async for chunk in stream:
            if getattr(chunk, "usage", None):
                u = chunk.usage
                in_tok = int(getattr(u, "prompt_tokens", 0) or 0)
                out_tok = int(getattr(u, "completion_tokens", 0) or 0)
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content or ""
            if delta:
                full_text += delta
                await stream_cb(delta)
    else:
        resp = await client.chat.completions.create(
            model=model_name,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        full_text = resp.choices[0].message.content or ""
        usage = getattr(resp, "usage", None)
        if usage is not None:
            in_tok = int(getattr(usage, "prompt_tokens", 0) or 0)
            out_tok = int(getattr(usage, "completion_tokens", 0) or 0)

    return LLMResult(
        text=full_text,
        input_tokens=in_tok,
        output_tokens=out_tok,
        model_name=model_name,
        provider=provider,
    )


async def _gemini(
    messages: list[dict],
    *,
    model_name: str,
    api_key: str | None,
    max_tokens: int,
    temperature: float,
    stream_cb: Callable[[str], Awaitable[None]] | None,
) -> LLMResult:
    """
    Google Gemini via google-generativeai SDK.
    SDK calls are synchronous — we run them in a thread pool.
    """
    import google.generativeai as genai

    genai.configure(api_key=api_key or "")

    system = ""
    user_parts: list[str] = []
    for m in messages:
        if m["role"] == "system":
            system = m["content"]
        elif m["role"] == "user":
            user_parts.append(m["content"])

    model = genai.GenerativeModel(
        model_name=model_name,
        system_instruction=system or None,
    )
    user_text = "\n\n".join(user_parts)

    gen_cfg = genai.GenerationConfig(max_output_tokens=max_tokens, temperature=temperature)

    def _sync_call():
        return model.generate_content(user_text, generation_config=gen_cfg)

    resp = await asyncio.to_thread(_sync_call)
    full_text = getattr(resp, "text", "") or ""

    in_tok = 0
    out_tok = 0
    meta = getattr(resp, "usage_metadata", None)
    if meta is not None:
        in_tok = int(getattr(meta, "prompt_token_count", 0) or 0)
        out_tok = int(getattr(meta, "candidates_token_count", 0) or 0)

    if stream_cb:
        await stream_cb(full_text)

    return LLMResult(
        text=full_text,
        input_tokens=in_tok,
        output_tokens=out_tok,
        model_name=model_name,
        provider="gemini",
    )
