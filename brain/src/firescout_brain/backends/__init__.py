"""Swappable decision backends behind one `DecisionBackend` protocol."""

from firescout_brain.backends.base import BackendResult, DecisionBackend
from firescout_brain.backends.laya import LayaBackend
from firescout_brain.backends.mock import MockBackend

__all__ = ["BackendResult", "DecisionBackend", "LayaBackend", "MockBackend"]
