import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from firescout_brain.protocol import CLIENT_MESSAGE, SERVER_MESSAGE

ROOT = Path(__file__).resolve().parents[2] / "shared" / "fixtures" / "protocol"
VALID = sorted((ROOT / "valid").glob("*.json"))
INVALID = sorted((ROOT / "invalid").glob("*.json"))


def test_fixtures_exist():
    assert VALID and INVALID


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.name)
def test_valid_round_trips(path):
    raw = json.loads(path.read_text())
    adapter = CLIENT_MESSAGE if raw["type"] == "decide" else SERVER_MESSAGE
    assert adapter.dump_python(adapter.validate_python(raw), mode="json", exclude_unset=True) == raw


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.name)
def test_invalid_rejected(path):
    raw = json.loads(path.read_text())
    with pytest.raises(ValidationError):
        CLIENT_MESSAGE.validate_python(raw)
    with pytest.raises(ValidationError):
        SERVER_MESSAGE.validate_python(raw)
