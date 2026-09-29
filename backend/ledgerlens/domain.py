"""Money and calendar invariants shared by API and CSV import."""

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

MINOR_DIGITS = {"EUR": 2, "USD": 2, "GBP": 2, "JPY": 0}


def to_minor(value: str, currency: str) -> int:
    digits = MINOR_DIGITS.get(currency)
    if digits is None:
        raise ValueError("unsupported_currency")
    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("invalid_amount") from exc
    if not amount.is_finite() or amount <= 0:
        raise ValueError("amount_must_be_positive")
    quantum = Decimal(1).scaleb(-digits)
    if amount > Decimal(9_000_000_000_000_000).scaleb(-digits):
        raise ValueError("amount_too_large")
    try:
        rounded = amount.quantize(quantum, rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:
        raise ValueError("invalid_amount") from exc
    if amount != rounded:
        raise ValueError("unsupported_precision")
    return int((rounded * (10**digits)).to_integral_exact())


def month_bounds(day: date) -> tuple[date, date]:
    start = day.replace(day=1)
    end = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
    return start, end


def previous_period(start: date, end_inclusive: date) -> tuple[date, date]:
    length = (end_inclusive - start).days + 1
    return start - timedelta(days=length), start - timedelta(days=1)


def balance_delta(kind: str, amount_minor: int, direction: str | None = None) -> int:
    if kind in ("income", "refund") or (kind == "transfer" and direction == "in"):
        return amount_minor
    return -amount_minor
