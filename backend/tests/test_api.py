def setup(client):  # type: ignore[no-untyped-def]
    a = client.post("/api/accounts", json={"name": "Wallet", "currency": "EUR"}).json()["id"]
    b = client.post("/api/accounts", json={"name": "Savings", "currency": "EUR"}).json()["id"]
    c = client.post("/api/categories", json={"name": "Food"}).json()["id"]
    return a, b, c


def tx(client, account, category, kind, amount, day="2026-01-15", **extra):  # type: ignore[no-untyped-def]
    return client.post(
        "/api/transactions",
        json={
            "date": day,
            "kind": kind,
            "amount": amount,
            "currency": "EUR",
            "account_id": account,
            "category_id": category,
            **extra,
        },
    )


def test_refund_transfer_budget_and_year_boundary(client):  # type: ignore[no-untyped-def]
    a, b, c = setup(client)
    assert tx(client, a, None, "income", "100.00", "2025-12-31").status_code == 201
    expense = tx(client, a, c, "expense", "40.00").json()
    assert tx(client, a, c, "refund", "15.00", refund_of_id=expense["id"]).status_code == 201
    assert tx(client, a, c, "refund", "26.00", refund_of_id=expense["id"]).status_code == 422
    transfer = client.post(
        "/api/transfers",
        json={
            "date": "2026-01-20",
            "amount": "20.00",
            "currency": "EUR",
            "from_account_id": a,
            "to_account_id": b,
        },
    )
    assert transfer.status_code == 201 and len(transfer.json()) == 2
    budget = client.post(
        "/api/budgets",
        json={"category_id": c, "month": "2026-01-01", "currency": "EUR", "amount": "100.00"},
    )
    assert budget.status_code == 201
    actual = client.get("/api/budgets", params={"month": "2026-01-01", "currency": "EUR"}).json()[0]
    assert actual["actual_minor"] == 2500
    dash = client.get(
        "/api/dashboard", params={"start": "2026-01-01", "end": "2026-01-31", "currency": "EUR"}
    ).json()
    assert dash["current"]["income_minor"] == 0
    assert dash["current"]["net_expense_minor"] == 2500
    assert dash["current"]["cash_flow_minor"] == -2500
    assert dash["balance_minor"] == 7500
    assert dash["previous"]["income_minor"] == 10000
    assert dash["previous_start"] == "2025-12-01"
    assert client.post(f"/api/categories/{c}/archive").status_code == 200
    assert tx(client, a, c, "expense", "1.00").status_code == 422
    assert client.get("/api/transactions").json()[0]["category"] in ("Food", None)


def test_delete_restore_and_validation(client):  # type: ignore[no-untyped-def]
    a, b, c = setup(client)
    assert client.post("/api/categories", json={"name": "   "}).status_code == 422
    assert tx(client, a, c, "expense", "-1").status_code == 422
    assert tx(client, a, c, "expense", "1.001").status_code == 422
    assert tx(client, a, c, "expense", "1", currency="CHF").status_code == 422
    item = tx(client, a, c, "expense", "12.00").json()
    assert client.delete(f"/api/transactions/{item['id']}").json()["deleted_ids"] == [item["id"]]
    assert client.get("/api/transactions").json() == []
    client.post(f"/api/transactions/{item['id']}/restore")
    assert len(client.get("/api/transactions").json()) == 1
    assert (
        client.post(
            "/api/transfers",
            json={
                "date": "2026-01-01",
                "amount": "1",
                "currency": "EUR",
                "from_account_id": a,
                "to_account_id": b,
            },
        ).status_code
        == 201
    )
    assert (
        client.get(
            "/api/dashboard", params={"start": "2027-01-01", "end": "2027-01-31", "currency": "EUR"}
        ).json()["current"]["net_expense_minor"]
        == 0
    )
    jpy = client.post("/api/accounts", json={"name": "Yen", "currency": "JPY"}).json()["id"]
    assert (
        client.post(
            "/api/transfers",
            json={
                "date": "2026-01-01",
                "amount": "1",
                "currency": "EUR",
                "from_account_id": a,
                "to_account_id": jpy,
            },
        ).status_code
        == 422
    )


def test_jpy_insight_uses_ten_yen_threshold(client):  # type: ignore[no-untyped-def]
    account = client.post("/api/accounts", json={"name": "Yen", "currency": "JPY"}).json()["id"]
    category = client.post("/api/categories", json={"name": "Food"}).json()["id"]
    for day, amount in (("2026-01-20", "1000"), ("2026-02-20", "1300")):
        response = client.post(
            "/api/transactions",
            json={
                "date": day,
                "kind": "expense",
                "amount": amount,
                "currency": "JPY",
                "account_id": account,
                "category_id": category,
            },
        )
        assert response.status_code == 201
    dashboard = client.get(
        "/api/dashboard", params={"start": "2026-02-01", "end": "2026-02-28", "currency": "JPY"}
    ).json()
    assert dashboard["insights"][0]["current_minor"] == 1300
    assert dashboard["insights"][0]["previous_minor"] == 1000
