"""Phase 2 tests — _EdgeInfo dataclass and _build_graph_cache populate new fields."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

import app.services.pipeline_router as router


def _make_summary(pid="pid-1", name="test_pipeline"):
    return {"id": pid, "name": name, "is_active": True}


def _make_graph_response(edge_overrides=None):
    edge = {
        "id": "edge-1",
        "source_node_id": "node-a",
        "target_node_id": "node-b",
        "edge_type": "sequential",
        "is_parallel": False,
        "wait_for_group": None,
        "is_optional": False,
    }
    if edge_overrides:
        edge.update(edge_overrides)
    return {
        "nodes": [
            {"id": "node-a", "node_key": "AgentA", "agent": {"name": "AgentA", "input_topic": "a.input", "output_topic": "a.output"}, "config_override": {}},
            {"id": "node-b", "node_key": "AgentB", "agent": {"name": "AgentB", "input_topic": "b.input", "output_topic": "b.output"}, "config_override": {}},
        ],
        "edges": [edge],
    }


@pytest.mark.asyncio
async def test_cyclic_edge_loaded_into_cache():
    graph_data = _make_graph_response({
        "edge_type": "cyclic_feedback",
        "max_iterations": 5,
        "break_field": "done",
        "break_value": "true",
    })

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=[
        MagicMock(status_code=200, json=MagicMock(return_value=[_make_summary()])),
        MagicMock(status_code=200, json=MagicMock(return_value=graph_data)),
    ])
    mock_client.raise_for_status = MagicMock()

    with patch("app.services.pipeline_router.httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        # Only test _build_graph_cache directly
        await router._build_graph_cache(mock_client, [_make_summary()])

    graph = router._graphs.get("pid-1")
    assert graph is not None
    edge = graph.edges[0]
    assert edge.edge_type == "cyclic_feedback"
    assert edge.max_iterations == 5
    assert edge.break_field == "done"
    assert edge.break_value == "true"


@pytest.mark.asyncio
async def test_agent_routed_edge_loaded():
    graph_data = _make_graph_response({
        "edge_type": "agent_routed",
        "candidate_agents": ["AgentB", "AgentC"],
    })

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=MagicMock(
        status_code=200, json=MagicMock(return_value=graph_data)
    ))

    await router._build_graph_cache(mock_client, [_make_summary()])

    graph = router._graphs.get("pid-1")
    edge = graph.edges[0]
    assert edge.edge_type == "agent_routed"
    assert "AgentB" in edge.candidate_agents
    assert "AgentC" in edge.candidate_agents


@pytest.mark.asyncio
async def test_missing_new_fields_use_defaults():
    """Old edge records without new cols don't crash the cache build."""
    graph_data = _make_graph_response()  # no max_iterations / candidate_agents

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=MagicMock(
        status_code=200, json=MagicMock(return_value=graph_data)
    ))

    await router._build_graph_cache(mock_client, [_make_summary()])

    edge = router._graphs["pid-1"].edges[0]
    assert edge.max_iterations == 3
    assert edge.candidate_agents == []
    assert edge.break_field is None
    assert edge.break_value is None
