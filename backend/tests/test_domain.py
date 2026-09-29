from datetime import date
from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from ledgerlens.domain import balance_delta, month_bounds, previous_period, to_minor


@given(st.integers(min_value=1, max_value=9_000_000_000))
def test_eur_integer_round_trip(cents: int) -> None:
    assert to_minor(str(Decimal(cents) / 100), "EUR") == cents


@given(st.integers(min_value=1, max_value=9_000_000_000))
def test_jpy_integer_round_trip(yen: int) -> None:
    assert to_minor(str(yen), "JPY") == yen


@pytest.mark.parametrize(
    "value,currency,reason",
    [
        ("0", "EUR", "amount_must_be_positive"),
        ("-1", "EUR", "amount_must_be_positive"),
        ("NaN", "EUR", "amount_must_be_positive"),
        ("1.001", "EUR", "unsupported_precision"),
        ("1.1", "JPY", "unsupported_precision"),
        ("1", "CHF", "unsupported_currency"),
        ("1e1000000", "EUR", "amount_too_large"),
    ],
)
def test_invalid_money(value: str, currency: str, reason: str) -> None:
    with pytest.raises(ValueError, match=reason):
        to_minor(value, currency)


def test_calendar_and_transfer_invariant() -> None:
    assert month_bounds(date(2024, 2, 29)) == (date(2024, 2, 1), date(2024, 3, 1))
    assert month_bounds(date(2025, 12, 31)) == (date(2025, 12, 1), date(2026, 1, 1))
    assert previous_period(date(2026, 1, 1), date(2026, 1, 31)) == (
        date(2025, 12, 1),
        date(2025, 12, 31),
    )
    assert balance_delta("transfer", 875, "in") + balance_delta("transfer", 875, "out") == 0
