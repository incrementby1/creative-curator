"""Lazy application dependency graph shared by settings and creative routes."""

from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from typing import Any, TypeVar

from pydantic import BaseModel
from supabase import create_client

from app.agents.content_agent import ContentAgent
from app.agents.critic_agent import CriticAgent
from app.agents.direction_agent import DirectionAgent
from app.agents.dna_agent import DnaAgent
from app.config import RuntimeConfig
from app.core.hermes import Hermes
from app.llm.router import StructuredLlmRouter
from app.llm.schemas import (
    ArtifactLayoutSpec,
    ArtifactTextBlock,
    ContentOutput,
    CriticOutput,
    DirectionOutput,
    DirectionSpec,
    DnaOutput,
    RefinedDirectionOutput,
    ToneSliderOutput,
)
from app.llm.transports import LlmDispatcher
from app.llm.types import AiConfigurationRequired, AllProvidersFailed, AttemptFailure
from app.persistence.session_store import InMemorySessionStore, SupabaseSessionStore
from app.persistence.settings_store import InMemorySettingsStore, SettingsStore, SupabaseSettingsStore
from app.projects.service import ProjectService
from app.projects.store import InMemoryProjectStore, ProjectStore
from app.projects.supabase_store import SupabaseProjectStore
from app.security.credential_cipher import CredentialCipher
from app.settings.provider_registry import ProviderRegistry
from app.settings.service import (
    DeterministicTestProviderOperations,
    SettingsService,
    TransportProviderOperations,
)


TOutput = TypeVar("TOutput", bound=BaseModel)


class SettingsRoutingReadiness:
    def __init__(self, store: SettingsStore) -> None:
        self._store = store

    def require_configured(self, user_id: str) -> None:
        try:
            routing = self._store.get_routing(user_id)
        except Exception:
            raise AllProvidersFailed((AttemptFailure("settings", "configuration"),)) from None
        if not routing.primary_provider_slug or not routing.primary_model:
            raise AiConfigurationRequired() from None


class DeterministicStructuredRouter:
    """Typed, offline creative outputs for guarded test composition."""

    def generate(
        self,
        user_id: str,
        output_model: type[TOutput],
        system_prompt: str,
        user_json: dict[str, Any],
    ) -> TOutput:
        del user_id, system_prompt, user_json
        directions = tuple(
            DirectionSpec(
                name=f"Test Direction {index}",
                tone=("Warm", "Bold", "Quiet")[index - 1],
                visual_style=f"Test visual system {index}",
                creative_intent=f"Test creative intent {index}",
                palette=(("#17324D", "#F2C14E"), ("#5C2751", "#E8C1C5"), ("#214E34", "#F4F1DE"))[index - 1],
                channels=("social",),
                why_it_works=f"Grounded test rationale {index}",
            )
            for index in range(1, 4)
        )
        if output_model is DnaOutput:
            value: BaseModel = DnaOutput(
                beliefs=("Make useful work", "Stay recognizably human", "Prefer clarity"),
                tone_sliders=(
                    ToneSliderOutput(label="Energy", left="Calm", right="Bold", value=55),
                    ToneSliderOutput(label="Voice", left="Formal", right="Casual", value=65),
                ),
            )
        elif output_model is DirectionOutput:
            value = DirectionOutput(directions=directions)
        elif output_model is CriticOutput:
            value = CriticOutput(constraints=("Keep the concept specific", "Preserve the brand voice"))
        elif output_model is RefinedDirectionOutput:
            value = RefinedDirectionOutput(direction=DirectionSpec(
                name="Refined Test Direction",
                tone="Warm and precise",
                visual_style="Focused editorial system",
                creative_intent="Apply all selected constraints",
                palette=("#17324D", "#F2C14E"),
                channels=("social",),
                why_it_works="It reflects the accepted direction and feedback",
            ))
        elif output_model is ContentOutput:
            value = ContentOutput(
                caption="A deterministic creative artifact for offline verification.",
                rationale=("Matches the brand", "Applies feedback", "Fits the channel"),
                layout=ArtifactLayoutSpec(
                    layout="poster",
                    palette=("#17324D", "#F2C14E"),
                    text_blocks=(ArtifactTextBlock(text="Creative Curator", role="headline"),),
                    cta="Explore",
                ),
            )
        else:  # pragma: no cover - composition owns the complete supported set
            raise TypeError("Unsupported deterministic output model")
        return value  # type: ignore[return-value]


@dataclass
class ApplicationComposition:
    settings_store: SettingsStore
    session_store: Any
    settings_service: SettingsService
    hermes: Hermes
    router: Any
    dispatcher: LlmDispatcher | None
    project_store: ProjectStore
    project_service: ProjectService

    def __post_init__(self) -> None:
        self._close_lock = Lock()
        self._closed = False

    def close(self) -> None:
        with self._close_lock:
            if self._closed:
                return
            self._closed = True
        self.settings_service.close()


def build_composition(config: RuntimeConfig) -> ApplicationComposition:
    if len(config.master_key) != 32:
        raise RuntimeError("BYOK_MASTER_KEY must decode to exactly 32 bytes")
    if config.settings_store_mode == "memory":
        settings_store: SettingsStore = InMemorySettingsStore()
        session_store = InMemorySessionStore()
        project_store: ProjectStore = InMemoryProjectStore()
    else:
        if not config.supabase_service_role_key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for local persistence")
        client = create_client(config.supabase_url, config.supabase_service_role_key)
        settings_store = SupabaseSettingsStore(client)
        session_store = SupabaseSessionStore(config.supabase_url, config.supabase_service_role_key)
        project_store = SupabaseProjectStore(client)

    cipher = CredentialCipher(config.master_key)
    registry = ProviderRegistry.load_default()
    dispatcher: LlmDispatcher | None
    if config.llm_transport_mode == "test":
        dispatcher = None
        operations = DeterministicTestProviderOperations()
        router: Any = DeterministicStructuredRouter()
    else:
        dispatcher = LlmDispatcher()
        operations = TransportProviderOperations(dispatcher)
        router = StructuredLlmRouter(settings_store, cipher, registry, dispatcher)
    settings_service = SettingsService(
        store=settings_store,
        cipher=cipher,
        registry=registry,
        operations=operations,
    )
    hermes = Hermes(
        store=session_store,
        readiness=SettingsRoutingReadiness(settings_store),
        dna_agent=DnaAgent(router),
        direction_agent=DirectionAgent(router),
        critic_agent=CriticAgent(router),
        content_agent=ContentAgent(router),
    )
    project_service = ProjectService(project_store)
    return ApplicationComposition(
        settings_store=settings_store,
        session_store=session_store,
        settings_service=settings_service,
        hermes=hermes,
        router=router,
        dispatcher=dispatcher,
        project_store=project_store,
        project_service=project_service,
    )


_composition_lock = Lock()
_application_composition: ApplicationComposition | None = None


def get_application_composition() -> ApplicationComposition:
    global _application_composition
    with _composition_lock:
        if _application_composition is None:
            _application_composition = build_composition(RuntimeConfig.from_env())
        return _application_composition


def clear_application_composition_cache() -> None:
    global _application_composition
    with _composition_lock:
        composition = _application_composition
        _application_composition = None
    if composition is not None:
        composition.close()
