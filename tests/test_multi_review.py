"""Unit tests for multi-review orchestrator."""
import json
import os
import sys
import tempfile
import textwrap
from pathlib import Path
from unittest.mock import MagicMock, patch

# Import the module by path since the filename has a hyphen
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "run_multi_review",
    Path(__file__).resolve().parent.parent / "multi-review" / "run-multi-review.py",
)
mr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mr)


class TestLoadPersona:
    def test_load_builtin_quality(self):
        persona = mr.load_builtin_persona("quality")
        assert persona is not None
        assert "prompt" in persona
        assert "code quality" in persona["prompt"].lower()

    def test_load_builtin_security(self):
        persona = mr.load_builtin_persona("security")
        assert persona is not None
        assert "security" in persona["prompt"].lower()

    def test_load_builtin_performance(self):
        persona = mr.load_builtin_persona("performance")
        assert persona is not None

    def test_load_builtin_architecture(self):
        persona = mr.load_builtin_persona("architecture")
        assert persona is not None

    def test_load_unknown_returns_none(self):
        persona = mr.load_builtin_persona("nonexistent")
        assert persona is None


class TestParseTeamString:
    def test_single_persona(self):
        personas = {"quality": {"name": "quality", "prompt": "test"}}
        result = mr._parse_team_string("quality:1", personas)
        assert len(result) == 1
        assert result[0]["name"] == "quality"
        assert result[0]["count"] == 1

    def test_multiple_personas(self):
        personas = {
            "quality": {"name": "quality", "prompt": "test"},
            "security": {"name": "security", "prompt": "test"},
        }
        result = mr._parse_team_string("quality:1,security:1", personas)
        assert len(result) == 2

    def test_redundancy_count(self):
        personas = {"quality": {"name": "quality", "prompt": "test"}}
        result = mr._parse_team_string("quality:3", personas)
        assert len(result) == 1
        assert result[0]["count"] == 3

    def test_default_count(self):
        personas = {"quality": {"name": "quality", "prompt": "test"}}
        result = mr._parse_team_string("quality", personas)
        assert len(result) == 1
        assert result[0]["count"] == 1

    def test_unknown_persona_skipped(self):
        personas = {"quality": {"name": "quality", "prompt": "test"}}
        result = mr._parse_team_string("quality:1,unknown:1", personas)
        assert len(result) == 1


class TestResolveReviewers:
    def test_default_team(self):
        reviewers = mr.resolve_reviewers(None, None)
        assert len(reviewers) == 2
        names = [r["persona"] for r in reviewers]
        assert "quality" in names
        assert "security" in names

    def test_custom_team_string(self):
        reviewers = mr.resolve_reviewers(None, "quality:1,performance:1")
        assert len(reviewers) == 2
        names = [r["persona"] for r in reviewers]
        assert "quality" in names
        assert "performance" in names

    def test_redundancy_instances(self):
        reviewers = mr.resolve_reviewers(None, "quality:2")
        assert len(reviewers) == 2
        assert reviewers[0]["name"] == "quality-1"
        assert reviewers[1]["name"] == "quality-2"

    def test_config_file_not_found(self):
        try:
            mr.resolve_reviewers("/nonexistent/path.yaml", None)
            assert False, "Should have exited"
        except SystemExit:
            pass


class TestFormatPrComment:
    def test_coordinator_output_with_reviewers(self):
        results = [
            {"name": "quality", "status": "success", "output": "LGTM"},
            {"name": "security", "status": "success", "output": "No issues"},
        ]
        comment = mr.format_pr_comment("可合并\nAll good", results)
        assert "可合并" in comment
        assert "<details>" in comment
        assert "quality" in comment
        assert "security" in comment
        assert "LGTM" in comment

    def test_error_reviewer_marked(self):
        results = [
            {"name": "quality", "status": "error", "output": "Failed"},
        ]
        comment = mr.format_pr_comment("有条件合并\nSome issues", results)
        assert "⚠️" in comment

    def test_long_output_truncated(self):
        results = [
            {"name": "quality", "status": "success", "output": "x" * 10000},
        ]
        comment = mr.format_pr_comment("ok", results)
        assert "output truncated" in comment


class TestFallbackComment:
    def test_fallback_format(self):
        results = [
            {"name": "quality", "status": "success", "output": "good"},
            {"name": "security", "status": "timeout", "output": "timed out"},
        ]
        comment = mr.post_fallback_comment(results)
        assert "Coordinator agent failed" in comment
        assert "quality" in comment
        assert "security" in comment


class TestSupportsModel:
    def test_zhipuai_with_key(self):
        with patch.dict(os.environ, {"ZHIPU_API_KEY": "test"}):
            assert mr._supports_model("zhipuai-model") is True

    def test_zhipuai_without_key(self):
        with patch.dict(os.environ, {}, clear=True):
            assert mr._supports_model("zhipuai-model") is False

    def test_generic_model_always_supported(self):
        assert mr._supports_model("some-other-model") is True


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
