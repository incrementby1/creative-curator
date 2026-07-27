"""Lazy application dependency graph for settings and project routes."""

from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from typing import Any, TypeVar

from pydantic import BaseModel
from supabase import create_client

from app.config import RuntimeConfig
from app.llm.router import StructuredLlmRouter
from app.llm.schemas import (
    GraphAnalysisOutput,
    ProposedEdgeOutput,
    ProposedNodeOutput,
)
from app.llm.transports import LlmDispatcher
from app.llm.types import AiConfigurationRequired, AllProvidersFailed, AttemptFailure
from app.persistence.settings_store import InMemorySettingsStore, SettingsStore, SupabaseSettingsStore
from app.projects.analysis import GraphAnalysisService
from app.projects.blueprint import BlueprintCompiler
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

    def analysis_route(self, user_id: str) -> tuple[str, str]:
        try:
            routing = self._store.get_routing(user_id)
        except Exception:
            raise AllProvidersFailed((AttemptFailure("settings", "configuration"),)) from None
        if not routing.primary_provider_slug or not routing.primary_model:
            raise AiConfigurationRequired() from None
        return routing.primary_provider_slug, routing.primary_model


class DeterministicStructuredRouter:
    """Typed, offline creative outputs for guarded test composition."""

    def generate(
        self,
        user_id: str,
        output_model: type[TOutput],
        system_prompt: str,
        user_json: dict[str, Any],
    ) -> TOutput:
        del user_id, system_prompt
        if output_model is GraphAnalysisOutput:
            selected_node_id = user_json.get("selected_node_id", "selected-node")
            if not isinstance(selected_node_id, str) or not selected_node_id:
                selected_node_id = "selected-node"
            selected_node_id = selected_node_id.strip()[:120] or "selected-node"
            value = GraphAnalysisOutput(
                summary="Deterministic graph analysis for offline verification.",
                proposed_nodes=(ProposedNodeOutput(
                    client_key="deterministic-challenge",
                    node_type="challenge",
                    title="Test the selected assumption",
                    content="The selected claim needs explicit evidence before approval.",
                    rationale="Hermes found an unsupported claim in the relevant semantic scope.",
                    dependencies=(selected_node_id,),
                    confidence=78,
                    downstream_effect="Positioning and messaging may need revision.",
                ),),
                proposed_edges=(ProposedEdgeOutput(
                    source_key="deterministic-challenge",
                    target_key=selected_node_id,
                    edge_type="contradicts",
                ),),
                affected_node_ids=(selected_node_id,),
            )
        else:  # pragma: no cover - composition owns the complete supported set
            raise TypeError("Unsupported deterministic output model")
        return value  # type: ignore[return-value]


@dataclass
class ApplicationComposition:
    settings_store: SettingsStore
    settings_service: SettingsService
    router: Any
    dispatcher: LlmDispatcher | None
    project_store: ProjectStore
    project_service: ProjectService
    analysis_service: GraphAnalysisService
    blueprint_compiler: BlueprintCompiler

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
        project_store: ProjectStore = InMemoryProjectStore()
    else:
        if not config.supabase_service_role_key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for local persistence")
        client = create_client(config.supabase_url, config.supabase_service_role_key)
        settings_store = SupabaseSettingsStore(client)
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
    readiness = SettingsRoutingReadiness(settings_store)
    project_service = ProjectService(project_store)
    analysis_service = GraphAnalysisService(project_store, router, readiness)
    blueprint_compiler = BlueprintCompiler(project_store)
    return ApplicationComposition(
        settings_store=settings_store,
        settings_service=settings_service,
        router=router,
        dispatcher=dispatcher,
        project_store=project_store,
        project_service=project_service,
        analysis_service=analysis_service,
        blueprint_compiler=blueprint_compiler,
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
