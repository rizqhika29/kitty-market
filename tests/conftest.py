"""Test bootstrap for KittyMarket contract tests.

Two concerns handled here:

1. Windows gltest direct-mode fix — os.unlink() on the stdin temp file
   while fd 0 still maps to it raises PermissionError; cleanup is
   best-effort, so swallow it. No-op on POSIX.

2. SDK priming — the `genlayer` placeholder package on PyPI is an empty
   stub, and gltest's `create_address` helper imports `genlayer.py.types`
   BEFORE `load_contract_class` installs the real SDK paths. The empty
   stub then wins the race and poisons `sys.modules['genlayer']`, making
   every contract fail with "name 'u256' is not defined". Priming the
   SDK paths up front and purging any site-packages stub avoids that.
"""

import sys
from pathlib import Path

import pytest


def _prime_genlayer_sdk() -> None:
    contract = Path(__file__).resolve().parent.parent / "contracts" / "kitty_market.py"
    try:
        from gltest.direct.sdk_loader import setup_sdk_paths

        setup_sdk_paths(contract)
    except Exception:
        return  # offline or cache missing; let gltest handle it later

    # Evict a prematurely-imported empty stub so the real SDK wins.
    for name in [
        n
        for n in list(sys.modules)
        if n == "genlayer" or n.startswith("genlayer.")
    ]:
        origin = getattr(sys.modules[name], "__file__", "") or ""
        if "gltest-direct" not in origin and "genvm" not in origin:
            del sys.modules[name]


_prime_genlayer_sdk()


@pytest.fixture(autouse=True)
def _re_prime_sdk_per_test():
    """gltest's VM teardown strips SDK paths from sys.path after every
    test; without re-priming, the empty PyPI `genlayer` stub wins the next
    import race and poisons sys.modules for the following tests."""
    _prime_genlayer_sdk()
    yield


if sys.platform == "win32":
    try:
        from gltest.direct import loader as _loader
    except ImportError:
        pass
    else:
        _original_inject = _loader._inject_message_to_fd0

        def _patched_inject(vm):
            try:
                _original_inject(vm)
            except PermissionError:
                pass

        _loader._inject_message_to_fd0 = _patched_inject
