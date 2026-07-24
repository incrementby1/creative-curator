"""Compatibility exports for the provider-neutral structured router."""

from app.llm.router import StructuredLlmRouter
from app.llm.types import AiConfigurationRequired, AllProvidersFailed

__all__ = ["AiConfigurationRequired", "AllProvidersFailed", "StructuredLlmRouter"]
