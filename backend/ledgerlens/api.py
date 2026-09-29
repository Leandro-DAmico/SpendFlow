"""Local REST API. Amounts enter as decimal strings and leave as integer minor units."""

import os
import uuid
from datetime import date, timedelta
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import get_db
from .domain import MINOR_DIGITS, balance_delta, month_bounds, previous_period, to_minor
from .models import Account, Budget, Category, Transaction

FRONTEND_ORIGIN = os.getenv("SPENDFLOW_FRONTEND_ORIGIN", os.getenv("LEDGERLENS_FRONTEND_ORIGIN", "http://127.0.0.1:5173"))
app = FastAPI(
    title="SpendFlow API",
    version="0.1.0",
    description="Local-first expense tracking. Monetary values are integer minor units.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def guard_origin(request: Request, call_next):  # type: ignore[no-untyped-def]
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        if origin and origin != FRONTEND_ORIGIN:
            return JSONResponse(status_code=403, content={"error": "origin_not_allowed"})
    try:
        body_length = int(request.headers.get("content-length", "0"))
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "invalid_content_length"})
    if body_length > 2_200_000:
        return JSONResponse(status_code=413, content={"error": "body_too_large"})
    if (
        body_length
        and request.method in {"POST", "PUT", "PATCH"}
        and not request.url.path.startswith("/api/import/")
    ):
        if not request.headers.get("content-type", "").lower().startswith("application/json"):
            return JSONResponse(status_code=415, content={"error": "json_content_type_required"})
    return await call_next(request)


@app.exception_handler(ValueError)
async def value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": str(exc)})


@app.exception_handler(HTTPException)
async def http_error_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    fields = [".".join(str(part) for part in item["loc"]) for item in exc.errors()]
    return JSONResponse(status_code=422, content={"error": "validation_error", "fields": fields})


def require(db: Session, model: type, item_id: int):  # type: ignore[no-untyped-def]
    item = db.get(model, item_id)
    if item is None:
        raise HTTPException(404, detail="not_found")
    return item


class NamedInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    currency: str | None = None


class TransactionInput(BaseModel):
    date: date
    kind: Literal["income", "expense", "refund"]
    amount: str
    currency: str
    account_id: int
    category_id: int | None = None
    merchant: str = Field(default="", max_length=160)
    tags: str = Field(default="", max_length=300)
    note: str = Field(default="", max_length=1000)
    refund_of_id: int | None = None


class TransferInput(BaseModel):
    date: date
    amount: str
    currency: str
    from_account_id: int
    to_account_id: int
    note: str = Field(default="", max_length=1000)


class BudgetInput(BaseModel):
    category_id: int
    month: date
    currency: str
    amount: str


def account_json(x: Account) -> dict[str, Any]:
    return {"id": x.id, "name": x.name, "currency": x.currency, "archived": x.archived}


def category_json(x: Category) -> dict[str, Any]:
    return {"id": x.id, "name": x.name, "archived": x.archived}


def tx_json(
    x: Transaction, accounts: dict[int, Account], categories: dict[int, Category]
) -> dict[str, Any]:
    return {
        "id": x.id,
        "date": x.date.isoformat(),
        "kind": x.kind,
        "amount_minor": x.amount_minor,
        "currency": x.currency,
        "account_id": x.account_id,
        "account": accounts[x.account_id].name,
        "category_id": x.category_id,
        "category": categories[x.category_id].name if x.category_id else None,
        "merchant": x.merchant,
        "tags": x.tags,
        "note": x.note,
        "refund_of_id": x.refund_of_id,
        "transfer_group": x.transfer_group,
        "direction": x.direction,
        "demo": x.demo,
    }


def lookup_maps(db: Session) -> tuple[dict[int, Account], dict[int, Category]]:
    return (
        {x.id: x for x in db.scalars(select(Account))},
        {x.id: x for x in db.scalars(select(Category))},
    )


def validate_tx(
    db: Session, data: TransactionInput, current_id: int | None = None
) -> tuple[int, int | None]:
    amount = to_minor(data.amount, data.currency)
    account = require(db, Account, data.account_id)
    if account.archived or account.currency != data.currency:
        raise ValueError("account_currency_or_archive_mismatch")
    category_id = data.category_id
    if data.kind == "refund" and data.refund_of_id is not None:
        original = require(db, Transaction, data.refund_of_id)
        if original.deleted or original.kind != "expense" or original.currency != data.currency:
            raise ValueError("invalid_refund_reference")
        category_id = original.category_id
        other_refunds = (
            db.scalar(
                select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(
                    Transaction.refund_of_id == original.id,
                    Transaction.deleted.is_(False),
                    Transaction.id != current_id,
                )
            )
            or 0
        )
        if other_refunds + amount > original.amount_minor:
            raise ValueError("refund_exceeds_expense")
    elif data.refund_of_id is not None:
        raise ValueError("refund_reference_only_for_refund")
    if data.kind in ("expense", "refund") and category_id is None:
        raise ValueError("category_required")
    if category_id is not None:
        category = require(db, Category, category_id)
        current = db.get(Transaction, current_id) if current_id is not None else None
        if category.archived and (current is None or current.category_id != category_id):
            raise ValueError("category_archived")
    return amount, category_id


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    return {"currencies": MINOR_DIGITS, "privacy": "local-only"}


@app.get("/api/accounts")
def accounts(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return [account_json(x) for x in db.scalars(select(Account).order_by(Account.name))]


@app.post("/api/accounts", status_code=201)
def create_account(data: NamedInput, db: Session = Depends(get_db)) -> dict[str, Any]:
    if data.currency not in MINOR_DIGITS:
        raise ValueError("unsupported_currency")
    name = data.name.strip()
    if not name:
        raise ValueError("name_required")
    item = Account(name=name, currency=data.currency)
    db.add(item)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail="name_exists") from exc
    return account_json(item)


@app.get("/api/categories")
def categories(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return [category_json(x) for x in db.scalars(select(Category).order_by(Category.name))]


@app.post("/api/categories", status_code=201)
def create_category(data: NamedInput, db: Session = Depends(get_db)) -> dict[str, Any]:
    name = data.name.strip()
    if not name:
        raise ValueError("name_required")
    item = Category(name=name)
    db.add(item)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail="name_exists") from exc
    return category_json(item)


@app.post("/api/categories/{category_id}/archive")
def archive_category(category_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    item = require(db, Category, category_id)
    item.archived = True
    db.commit()
    return category_json(item)


@app.post("/api/transactions", status_code=201)
def create_transaction(data: TransactionInput, db: Session = Depends(get_db)) -> dict[str, Any]:
    amount, category_id = validate_tx(db, data)
    item = Transaction(
        **data.model_dump(exclude={"amount", "category_id"}),
        amount_minor=amount,
        category_id=category_id,
    )
    db.add(item)
    db.commit()
    accounts_map, categories_map = lookup_maps(db)
    return tx_json(item, accounts_map, categories_map)


@app.put("/api/transactions/{transaction_id}")
def update_transaction(
    transaction_id: int, data: TransactionInput, db: Session = Depends(get_db)
) -> dict[str, Any]:
    item = require(db, Transaction, transaction_id)
    if item.deleted or item.kind == "transfer":
        raise ValueError("transaction_not_editable")
    amount, category_id = validate_tx(db, data, transaction_id)
    if item.kind == "expense":
        total_refunds = (
            db.scalar(
                select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(
                    Transaction.refund_of_id == item.id, Transaction.deleted.is_(False)
                )
            )
            or 0
        )
        if total_refunds > amount or (
            total_refunds and (data.kind != "expense" or data.currency != item.currency)
        ):
            raise ValueError("expense_has_refunds")
    for key, value in data.model_dump(exclude={"amount", "category_id"}).items():
        setattr(item, key, value)
    item.amount_minor = amount
    item.category_id = category_id
    # An imported row that was edited no longer represents its original CSV fingerprint.
    # Preview derives a fresh fingerprint for manual/edited rows when this column is null.
    item.fingerprint = None
    if item.kind == "expense":
        for refund in db.scalars(select(Transaction).where(Transaction.refund_of_id == item.id)):
            refund.category_id = category_id
    db.commit()
    accounts_map, categories_map = lookup_maps(db)
    return tx_json(item, accounts_map, categories_map)


@app.post("/api/transfers", status_code=201)
def create_transfer(data: TransferInput, db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    if data.from_account_id == data.to_account_id:
        raise ValueError("transfer_accounts_must_differ")
    amount = to_minor(data.amount, data.currency)
    source = require(db, Account, data.from_account_id)
    destination = require(db, Account, data.to_account_id)
    if (
        source.archived
        or destination.archived
        or source.currency != data.currency
        or destination.currency != data.currency
    ):
        raise ValueError("transfer_currency_or_archive_mismatch")
    group = str(uuid.uuid4())
    legs = [
        Transaction(
            date=data.date,
            kind="transfer",
            amount_minor=amount,
            currency=data.currency,
            account_id=account_id,
            transfer_group=group,
            direction=direction,
            note=data.note,
        )
        for account_id, direction in ((source.id, "out"), (destination.id, "in"))
    ]
    db.add_all(legs)
    db.commit()
    accounts_map, categories_map = lookup_maps(db)
    return [tx_json(x, accounts_map, categories_map) for x in legs]


@app.delete("/api/transactions/{transaction_id}")
def delete_transaction(transaction_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    item = require(db, Transaction, transaction_id)
    if item.kind == "expense" and db.scalar(
        select(func.count())
        .select_from(Transaction)
        .where(Transaction.refund_of_id == item.id, Transaction.deleted.is_(False))
    ):
        raise ValueError("expense_has_refunds")
    group = [item]
    if item.transfer_group:
        group = list(
            db.scalars(select(Transaction).where(Transaction.transfer_group == item.transfer_group))
        )
    for entry in group:
        entry.deleted = True
    db.commit()
    return {"deleted_ids": [x.id for x in group]}


@app.post("/api/transactions/{transaction_id}/restore")
def restore_transaction(transaction_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    item = require(db, Transaction, transaction_id)
    if item.refund_of_id is not None:
        original = require(db, Transaction, item.refund_of_id)
        if original.deleted:
            raise ValueError("original_expense_deleted")
        other_refunds = (
            db.scalar(
                select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(
                    Transaction.refund_of_id == original.id,
                    Transaction.deleted.is_(False),
                )
            )
            or 0
        )
        if other_refunds + item.amount_minor > original.amount_minor:
            raise ValueError("refund_exceeds_expense")
    group = [item]
    if item.transfer_group:
        group = list(
            db.scalars(select(Transaction).where(Transaction.transfer_group == item.transfer_group))
        )
    for entry in group:
        entry.deleted = False
    db.commit()
    return {"restored_ids": [x.id for x in group]}


def filtered_transactions(
    db: Session,
    start: date | None,
    end: date | None,
    currency: str | None,
    account_id: int | None,
    category_id: int | None,
    tag: str | None,
    merchant: str | None,
    q: str | None,
) -> list[Transaction]:
    query = select(Transaction).where(Transaction.deleted.is_(False))
    if start:
        query = query.where(Transaction.date >= start)
    if end:
        query = query.where(Transaction.date <= end)
    if currency:
        query = query.where(Transaction.currency == currency)
    if account_id:
        query = query.where(Transaction.account_id == account_id)
    if category_id:
        query = query.where(Transaction.category_id == category_id)
    if tag:
        query = query.where(Transaction.tags.ilike(f"%{tag}%"))
    if merchant:
        query = query.where(Transaction.merchant.ilike(f"%{merchant}%"))
    if q:
        query = query.where(
            or_(
                Transaction.merchant.ilike(f"%{q}%"),
                Transaction.note.ilike(f"%{q}%"),
                Transaction.tags.ilike(f"%{q}%"),
            )
        )
    return list(db.scalars(query.order_by(Transaction.date.desc(), Transaction.id.desc())))


@app.get("/api/transactions")
def list_transactions(
    start: date | None = None,
    end: date | None = None,
    currency: str | None = None,
    account_id: int | None = None,
    category_id: int | None = None,
    tag: str | None = None,
    merchant: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    accounts_map, categories_map = lookup_maps(db)
    return [
        tx_json(x, accounts_map, categories_map)
        for x in filtered_transactions(
            db, start, end, currency, account_id, category_id, tag, merchant, q
        )
    ]


@app.post("/api/budgets", status_code=201)
def upsert_budget(data: BudgetInput, db: Session = Depends(get_db)) -> dict[str, Any]:
    amount = to_minor(data.amount, data.currency)
    category = require(db, Category, data.category_id)
    if category.archived:
        raise ValueError("category_archived")
    if data.month.day != 1:
        raise ValueError("month_must_start_on_first")
    item = db.scalar(
        select(Budget).where(
            Budget.category_id == data.category_id,
            Budget.month == data.month,
            Budget.currency == data.currency,
        )
    )
    if item is None:
        item = Budget(
            category_id=data.category_id,
            month=data.month,
            currency=data.currency,
            amount_minor=amount,
        )
        db.add(item)
    else:
        item.amount_minor = amount
    db.commit()
    return {
        "id": item.id,
        "category_id": item.category_id,
        "month": item.month,
        "currency": item.currency,
        "amount_minor": item.amount_minor,
    }


@app.get("/api/budgets")
def list_budgets(month: date, currency: str, db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    start, end = month_bounds(month)
    categories_map = {x.id: x for x in db.scalars(select(Category))}
    budgets = list(
        db.scalars(select(Budget).where(Budget.month == start, Budget.currency == currency))
    )
    txs = list(
        db.scalars(
            select(Transaction).where(
                Transaction.date >= start,
                Transaction.date < end,
                Transaction.currency == currency,
                Transaction.deleted.is_(False),
                Transaction.kind.in_(["expense", "refund"]),
            )
        )
    )
    actual: dict[int, int] = {}
    for tx in txs:
        if tx.category_id:
            actual[tx.category_id] = actual.get(tx.category_id, 0) + (
                tx.amount_minor if tx.kind == "expense" else -tx.amount_minor
            )
    return [
        {
            "id": b.id,
            "category_id": b.category_id,
            "category": categories_map[b.category_id].name,
            "month": b.month,
            "currency": currency,
            "amount_minor": b.amount_minor,
            "actual_minor": actual.get(b.category_id, 0),
            "remaining_minor": b.amount_minor - actual.get(b.category_id, 0),
        }
        for b in budgets
    ]


def totals(txs: list[Transaction]) -> dict[str, int]:
    income = sum(x.amount_minor for x in txs if x.kind == "income")
    gross = sum(x.amount_minor for x in txs if x.kind == "expense")
    refunds = sum(x.amount_minor for x in txs if x.kind == "refund")
    return {
        "income_minor": income,
        "gross_expense_minor": gross,
        "refund_minor": refunds,
        "net_expense_minor": gross - refunds,
        "cash_flow_minor": income - gross + refunds,
    }


@app.get("/api/dashboard")
def dashboard(
    start: date,
    end: date,
    currency: str,
    account_id: int | None = None,
    category_id: int | None = None,
    tag: str | None = None,
    merchant: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if start > end:
        raise ValueError("invalid_period")
    if currency not in MINOR_DIGITS:
        raise ValueError("unsupported_currency")
    current = filtered_transactions(
        db, start, end, currency, account_id, category_id, tag, merchant, q
    )
    prev_start, prev_end = previous_period(start, end)
    previous = filtered_transactions(
        db, prev_start, prev_end, currency, account_id, category_id, tag, merchant, q
    )
    current_totals, previous_totals = totals(current), totals(previous)
    all_to_end = filtered_transactions(db, None, end, currency, account_id, None, None, None, None)
    balances: dict[int, int] = {}
    opening_balance = 0
    daily_deltas: dict[date, int] = {}
    for tx in all_to_end:
        delta = balance_delta(tx.kind, tx.amount_minor, tx.direction)
        balances[tx.account_id] = balances.get(tx.account_id, 0) + delta
        if tx.date < start:
            opening_balance += delta
        else:
            daily_deltas[tx.date] = daily_deltas.get(tx.date, 0) + delta
    balance_series = []
    running_balance = opening_balance
    cursor_day = start
    while cursor_day <= end:
        running_balance += daily_deltas.get(cursor_day, 0)
        balance_series.append({"date": cursor_day, "balance_minor": running_balance})
        cursor_day += timedelta(days=1)
    categories_map = {x.id: x.name for x in db.scalars(select(Category))}
    by_category: dict[str, int] = {}
    by_merchant: dict[str, int] = {}
    by_month: dict[str, dict[str, int]] = {}
    for tx in current:
        if tx.kind == "transfer":
            continue
        month = tx.date.strftime("%Y-%m")
        row = by_month.setdefault(month, {"income_minor": 0, "expense_minor": 0, "refund_minor": 0})
        row[
            {"income": "income_minor", "expense": "expense_minor", "refund": "refund_minor"}[
                tx.kind
            ]
        ] += tx.amount_minor
        if tx.kind in ("expense", "refund"):
            sign = 1 if tx.kind == "expense" else -1
            label = categories_map.get(tx.category_id or 0, "Senza categoria")
            by_category[label] = by_category.get(label, 0) + sign * tx.amount_minor
            label = tx.merchant or "Senza merchant"
            by_merchant[label] = by_merchant.get(label, 0) + sign * tx.amount_minor
    months = []
    cursor = start.replace(day=1)
    while cursor <= end:
        key = cursor.strftime("%Y-%m")
        months.append(
            {
                "month": key,
                **by_month.get(key, {"income_minor": 0, "expense_minor": 0, "refund_minor": 0}),
            }
        )
        cursor = month_bounds(cursor)[1]
    insights = []
    base = previous_totals["net_expense_minor"]
    now = current_totals["net_expense_minor"]
    threshold_minor = 10 * (10 ** MINOR_DIGITS[currency])
    if base > 0 and now * 100 >= base * 125 and now - base >= threshold_minor:
        insights.append(
            {
                "rule": "Spesa netta almeno +25% e +10 unità rispetto al periodo precedente",
                "current_minor": now,
                "previous_minor": base,
                "start": start,
                "end": end,
                "previous_start": prev_start,
                "previous_end": prev_end,
            }
        )
    return {
        "currency": currency,
        "start": start,
        "end": end,
        "previous_start": prev_start,
        "previous_end": prev_end,
        "current": current_totals,
        "previous": previous_totals,
        "balance_minor": sum(balances.values()),
        "account_balances": balances,
        "opening_balance_minor": opening_balance,
        "balance_series": balance_series,
        "months": months,
        "categories": [
            {"name": k, "amount_minor": v}
            for k, v in sorted(by_category.items(), key=lambda x: -x[1])
        ],
        "merchants": [
            {"name": k, "amount_minor": v}
            for k, v in sorted(by_merchant.items(), key=lambda x: -x[1])
        ],
        "insights": insights,
    }


@app.post("/api/demo")
def seed_demo(db: Session = Depends(get_db)) -> dict[str, Any]:
    if db.scalar(select(func.count()).select_from(Transaction).where(Transaction.demo.is_(True))):
        return {"added": 0, "message": "Demo già presente"}
    account = db.scalar(select(Account).where(Account.name == "Conto demo EUR"))
    if account is None:
        account = Account(name="Conto demo EUR", currency="EUR")
        db.add(account)
        db.flush()
    sample = [("Casa", "Affitto", 85000), ("Spesa", "Mercato", 4560), ("Trasporti", "Metro", 2200)]
    today = date.today()
    added = 0
    for category_name, merchant_name, amount in sample:
        category = db.scalar(select(Category).where(Category.name == category_name))
        if category is None:
            category = Category(name=category_name)
            db.add(category)
            db.flush()
        db.add(
            Transaction(
                date=today.replace(day=min(today.day, 20)),
                kind="expense",
                amount_minor=amount,
                currency="EUR",
                account_id=account.id,
                category_id=category.id,
                merchant=merchant_name,
                demo=True,
            )
        )
        added += 1
    db.add(
        Transaction(
            date=today.replace(day=2),
            kind="income",
            amount_minor=245000,
            currency="EUR",
            account_id=account.id,
            merchant="Stipendio demo",
            demo=True,
        )
    )
    db.commit()
    return {"added": added + 1, "message": "Dati sintetici demo aggiunti"}


from . import csv_io  # noqa: E402,F401  Register CSV routes after app creation.
