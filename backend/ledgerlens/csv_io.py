"""Bounded CSV preview/import and safe exports."""

import csv
import hashlib
import io
import json
from datetime import date
from typing import Any

from fastapi import Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .api import TransactionInput, app, filtered_transactions, lookup_maps, tx_json, validate_tx
from .db import get_db
from .models import Account, Category, Transaction

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 10_000
FIELDS = ("date", "kind", "amount", "currency", "account", "category", "merchant", "tags", "note")


async def read_upload(file: UploadFile) -> tuple[str, str]:
    if file.content_type not in ("text/csv", "application/csv", "application/vnd.ms-excel"):
        raise HTTPException(415, detail="csv_content_type_required")
    buffer = bytearray()
    while chunk := await file.read(64 * 1024):
        buffer.extend(chunk)
        if len(buffer) > MAX_BYTES:
            raise HTTPException(413, detail="csv_too_large")
    try:
        content = buffer.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(422, detail="csv_utf8_required") from exc
    return content, hashlib.sha256(buffer).hexdigest()


def fingerprint(data: TransactionInput, amount_minor: int) -> str:
    values = [
        data.date.isoformat(),
        data.kind,
        amount_minor,
        data.currency,
        data.account_id,
        data.category_id,
        data.merchant.strip().casefold(),
        data.tags.strip().casefold(),
        data.note.strip().casefold(),
    ]
    return hashlib.sha256(
        json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def preview_rows(content: str, mapping: dict[str, str], db: Session) -> list[dict[str, Any]]:
    if not isinstance(mapping, dict) or any(
        not isinstance(k, str) or not isinstance(v, str) for k, v in mapping.items()
    ):
        raise HTTPException(422, detail="invalid_mapping")
    if not all(k in mapping for k in ("date", "kind", "amount", "currency", "account")):
        raise HTTPException(422, detail="mapping_missing_required_fields")
    lines = content.splitlines()
    if len(lines) < 2:
        raise HTTPException(422, detail="csv_header_or_rows_missing")
    if len(lines) - 1 > MAX_ROWS:
        raise HTTPException(413, detail="csv_too_many_rows")
    try:
        headers = next(csv.reader([lines[0]], strict=True))
    except csv.Error as exc:
        raise HTTPException(422, detail="csv_invalid_header") from exc
    if len(headers) > 40 or any(len(h) > 80 for h in headers):
        raise HTTPException(422, detail="csv_too_many_columns")
    if any(v not in headers for v in mapping.values()):
        raise HTTPException(422, detail="mapping_column_not_found")
    accounts = {a.name.casefold(): a for a in db.scalars(select(Account))}
    categories = {c.name.casefold(): c for c in db.scalars(select(Category))}
    known = set(
        db.scalars(select(Transaction.fingerprint).where(Transaction.fingerprint.is_not(None)))
    )
    for existing in db.scalars(
        select(Transaction).where(
            Transaction.fingerprint.is_(None),
            Transaction.kind != "transfer",
            Transaction.deleted.is_(False),
        )
    ):
        existing_data = TransactionInput(
            date=existing.date,
            kind=existing.kind,
            amount=str(existing.amount_minor),
            currency=existing.currency,
            account_id=existing.account_id,
            category_id=existing.category_id,
            merchant=existing.merchant,
            tags=existing.tags,
            note=existing.note,
        )
        known.add(fingerprint(existing_data, existing.amount_minor))
    rows = []
    for line_number, line in enumerate(lines[1:], 2):
        result: dict[str, Any] = {
            "line": line_number,
            "status": "rejected",
            "reason": "",
            "values": {},
        }
        try:
            cells = next(csv.reader([line], strict=True))
            if len(cells) != len(headers) or len(cells) > 40 or any(len(c) > 1000 for c in cells):
                raise ValueError("column_count_or_length")
            raw = dict(zip(headers, cells, strict=True))
            values = {field: raw.get(mapping.get(field, ""), "").strip() for field in FIELDS}
            result["values"] = values
            account = accounts.get(values["account"].casefold())
            category = categories.get(values["category"].casefold()) if values["category"] else None
            if account is None:
                raise ValueError("unknown_account")
            if values["category"] and category is None:
                raise ValueError("unknown_category")
            try:
                parsed_date = date.fromisoformat(values["date"])
            except ValueError as exc:
                raise ValueError("invalid_date") from exc
            data = TransactionInput(
                date=parsed_date,
                kind=values["kind"],
                amount=values["amount"],
                currency=values["currency"],
                account_id=account.id,
                category_id=category.id if category else None,
                merchant=values["merchant"],
                tags=values["tags"],
                note=values["note"],
            )
            amount, category_id = validate_tx(db, data)
            data.category_id = category_id
            key = fingerprint(data, amount)
            result.update(
                {
                    "status": "duplicate" if key in known else "valid",
                    "reason": "duplicate_fingerprint" if key in known else "",
                    "fingerprint": key,
                    "amount_minor": amount,
                    "data": data.model_dump(mode="json"),
                }
            )
            known.add(key)
        except ValidationError:
            result["reason"] = "invalid_row_fields"
        except csv.Error:
            result["reason"] = "malformed_csv_row"
        except (ValueError, TypeError) as exc:
            result["reason"] = str(exc)[:100]
        rows.append(result)
    return rows


def public_row(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if key != "data"}


@app.post("/api/import/preview")
async def import_preview(
    file: UploadFile = File(...), mapping: str = Form(...), db: Session = Depends(get_db)
) -> dict[str, Any]:
    content, digest = await read_upload(file)
    try:
        parsed_mapping = json.loads(mapping)
    except json.JSONDecodeError as exc:
        raise HTTPException(422, detail="invalid_mapping") from exc
    rows = preview_rows(content, parsed_mapping, db)
    return {
        "sha256": digest,
        "rows": [public_row(r) for r in rows],
        "valid": sum(r["status"] == "valid" for r in rows),
        "duplicate": sum(r["status"] == "duplicate" for r in rows),
        "rejected": sum(r["status"] == "rejected" for r in rows),
    }


@app.post("/api/import/confirm")
async def import_confirm(
    file: UploadFile = File(...),
    mapping: str = Form(...),
    sha256: str = Form(...),
    selected: str = Form(...),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    content, digest = await read_upload(file)
    if digest != sha256:
        raise HTTPException(409, detail="csv_digest_mismatch")
    try:
        parsed_mapping = json.loads(mapping)
        selected_lines = set(json.loads(selected))
    except (json.JSONDecodeError, TypeError) as exc:
        raise HTTPException(422, detail="invalid_import_selection") from exc
    if (
        not isinstance(parsed_mapping, dict)
        or not isinstance(selected_lines, set)
        or not all(isinstance(x, int) for x in selected_lines)
    ):
        raise HTTPException(422, detail="invalid_import_selection")
    rows = preview_rows(content, parsed_mapping, db)
    valid_lines = {r["line"] for r in rows if r["status"] == "valid"}
    if not selected_lines.issubset(valid_lines):
        raise HTTPException(422, detail="selection_contains_invalid_rows")
    try:
        for row in rows:
            if row["line"] not in selected_lines:
                continue
            data = TransactionInput.model_validate(row["data"])
            tx = Transaction(
                **data.model_dump(exclude={"amount"}),
                amount_minor=row["amount_minor"],
                fingerprint=row["fingerprint"],
            )
            db.add(tx)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail="duplicate_during_import") from exc
    return {
        "imported": len(selected_lines),
        "skipped": len(rows) - len(selected_lines) - sum(r["status"] == "rejected" for r in rows),
        "rejected": sum(r["status"] == "rejected" for r in rows),
        "reasons": [public_row(r) for r in rows if r["status"] != "valid"],
    }


def safe_csv_text(value: str | None) -> str:
    text = value or ""
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


@app.get("/api/export/{format}")
def export_data(
    format: str,
    start: date | None = None,
    end: date | None = None,
    currency: str | None = None,
    account_id: int | None = None,
    category_id: int | None = None,
    tag: str | None = None,
    merchant: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
) -> Response:
    if format not in ("csv", "json"):
        raise HTTPException(404, detail="format_not_found")
    accounts, categories = lookup_maps(db)
    rows = [
        tx_json(x, accounts, categories)
        for x in filtered_transactions(
            db, start, end, currency, account_id, category_id, tag, merchant, q
        )
    ]
    if format == "json":
        return Response(
            content=json.dumps(rows, ensure_ascii=False, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=ledgerlens.json"},
        )
    output = io.StringIO()
    writer = csv.writer(output)
    columns = (
        "date",
        "kind",
        "amount_minor",
        "currency",
        "account",
        "category",
        "merchant",
        "tags",
        "note",
        "refund_of_id",
        "direction",
        "demo",
    )
    writer.writerow(columns)
    for row in rows:
        writer.writerow(
            [
                safe_csv_text(str(row.get(c, "")))
                if c in ("account", "category", "merchant", "tags", "note")
                else row.get(c, "")
                for c in columns
            ]
        )
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=ledgerlens.csv"},
    )
