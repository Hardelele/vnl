"""VNL -- язык описания нейронных микросхем и компилятор к симуляторам."""

from .ir import Model
from .resolve import Diagnostic, ValidationError, load, resolve

__all__ = ["Model", "Diagnostic", "ValidationError", "load", "resolve", "__version__"]

__version__ = "0.1.0"
