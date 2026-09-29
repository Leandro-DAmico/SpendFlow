from hypothesis import given
from hypothesis import strategies as st
from test_api import setup

from ledgerlens.api import TransactionInput
from ledgerlens.csv_io import fingerprint, safe_csv_text
from ledgerlens.domain import to_minor


def upload(client, path, content, mapping, **extra):  # type: ignore[no-untyped-def]
    return client.post(
        path,
        data={"mapping": mapping, **extra},
        files={"file": ("sample.csv", content, "text/csv")},
    )


def test_preview_partial_duplicate_malformed_and_export(client):  # type: ignore[no-untyped-def]
    a, b, c = setup(client)
    mapping = (
        '{"date":"date","kind":"kind","amount":"amount","currency":"currency",'
        '"account":"account","category":"category","merchant":"merchant","note":"note"}'
    )
    content = (
        b"date,kind,amount,currency,account,category,merchant,note\n"
        b"2026-01-01,expense,1.00,EUR,Wallet,Food,=SUM(1),@test\n"
        b'2026-01-02,expense,1.00,EUR,Wallet,Food,"broken,field,hi\n'
        b"2026-01-03,expense,2.00,EUR,Wallet,Food,Shop,ok\n"
    )
    preview = upload(client, "/api/import/preview", content, mapping)
    assert preview.status_code == 200
    body = preview.json()
    assert (body["valid"], body["rejected"]) == (2, 1)
    assert client.get("/api/transactions").json() == []
    changed = upload(
        client,
        "/api/import/confirm",
        content + b"x",
        mapping,
        sha256=body["sha256"],
        selected="[2]",
    )
    assert changed.status_code == 409
    imported = upload(
        client, "/api/import/confirm", content, mapping, sha256=body["sha256"], selected="[2]"
    )
    assert imported.status_code == 200 and imported.json()["imported"] == 1
    assert imported.json()["rejected"] == 1
    repeated = upload(client, "/api/import/preview", content, mapping).json()
    assert repeated["duplicate"] == 1
    csv_body = client.get("/api/export/csv").text
    assert "'=SUM(1)" in csv_body and "'@test" in csv_body
    json_body = client.get("/api/export/json").json()
    assert json_body[0]["merchant"] == "=SUM(1)"
    assert json_body[0]["note"] == "@test"


def test_csv_limits_and_origin(client):  # type: ignore[no-untyped-def]
    setup(client)
    mapping = (
        '{"date":"date","kind":"kind","amount":"amount","currency":"currency","account":"account"}'
    )
    assert (
        client.post(
            "/api/import/preview",
            data={"mapping": mapping},
            files={"file": ("x.csv", b"a,b", "text/plain")},
        ).status_code
        == 415
    )
    assert upload(client, "/api/import/preview", b"\xff", mapping).status_code == 422
    assert (
        upload(client, "/api/import/preview", b"x" * (2 * 1024 * 1024 + 1), mapping).status_code
        == 413
    )
    assert (
        client.post(
            "/api/accounts",
            json={"name": "Evil", "currency": "EUR"},
            headers={"Origin": "https://evil.example"},
        ).status_code
        == 403
    )


def test_normalized_fingerprint_and_safe_labels(client):  # type: ignore[no-untyped-def]
    client.post("/api/accounts", json={"name": "- Wallet", "currency": "EUR"})
    client.post("/api/categories", json={"name": "+ Food"})
    mapping = (
        '{"date":"date","kind":"kind","amount":"amount","currency":"currency",'
        '"account":"account","category":"category","merchant":"merchant","tags":"tags"}'
    )
    content = (
        b"date,kind,amount,currency,account,category,merchant,tags\n"
        b"2026-01-01,expense,1.0,EUR,- Wallet,+ Food, @SUM(1),-tag\n"
        b"2026-01-01,expense,1.00,EUR,- Wallet,+ Food, @SUM(1),-tag\n"
    )
    preview = upload(client, "/api/import/preview", content, mapping).json()
    assert preview["valid"] == 1 and preview["duplicate"] == 1
    result = upload(
        client,
        "/api/import/confirm",
        content,
        mapping,
        sha256=preview["sha256"],
        selected="[2]",
    )
    assert result.status_code == 200
    exported = client.get("/api/export/csv").text
    assert "'- Wallet" in exported
    assert "'+ Food" in exported
    assert "'@SUM(1)" in exported
    assert "'-tag" in exported


def test_edit_imported_row_recomputes_deduplication(client):  # type: ignore[no-untyped-def]
    account, _, category = setup(client)
    mapping = (
        '{"date":"date","kind":"kind","amount":"amount","currency":"currency",'
        '"account":"account","category":"category","merchant":"merchant"}'
    )
    original = (
        b"date,kind,amount,currency,account,category,merchant\n"
        b"2026-01-01,expense,1.00,EUR,Wallet,Food,Shop\n"
    )
    preview = upload(client, "/api/import/preview", original, mapping).json()
    assert (
        upload(
            client,
            "/api/import/confirm",
            original,
            mapping,
            sha256=preview["sha256"],
            selected="[2]",
        ).status_code
        == 200
    )
    tx_id = client.get("/api/transactions").json()[0]["id"]
    edited = client.put(
        f"/api/transactions/{tx_id}",
        json={
            "date": "2026-01-01",
            "kind": "expense",
            "amount": "2.00",
            "currency": "EUR",
            "account_id": account,
            "category_id": category,
            "merchant": "Shop",
        },
    )
    assert edited.status_code == 200
    assert upload(client, "/api/import/preview", original, mapping).json()["valid"] == 1
    changed = original.replace(b"1.00", b"2.00")
    assert upload(client, "/api/import/preview", changed, mapping).json()["duplicate"] == 1


@given(st.sampled_from(["=", "+", "-", "@"]), st.text(max_size=30))
def test_formula_prefix(trigger: str, suffix: str) -> None:
    assert safe_csv_text(" \t" + trigger + suffix).startswith("' \t" + trigger)


@given(st.integers(min_value=1, max_value=999_999))
def test_import_fingerprint_normalizes_decimal_spellings(cents: int) -> None:
    fixed = f"{cents // 100}.{cents % 100:02d}"
    plain = fixed.rstrip("0").rstrip(".")
    one = TransactionInput(
        date="2026-01-01",
        kind="expense",
        amount=plain,
        currency="EUR",
        account_id=1,
        category_id=2,
    )
    two = one.model_copy(update={"amount": fixed})
    assert fingerprint(one, to_minor(one.amount, "EUR")) == fingerprint(
        two, to_minor(two.amount, "EUR")
    )
