from datetime import UTC, date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    currency: Mapped[str] = mapped_column(String(3))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="positive_amount"),
        Index("ix_transactions_date", "date"),
        Index("ix_transactions_fingerprint", "fingerprint", unique=True),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(16))
    amount_minor: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    merchant: Mapped[str] = mapped_column(String(160), default="")
    tags: Mapped[str] = mapped_column(String(300), default="")
    note: Mapped[str] = mapped_column(String(1000), default="")
    refund_of_id: Mapped[int | None] = mapped_column(ForeignKey("transactions.id"), nullable=True)
    transfer_group: Mapped[str | None] = mapped_column(String(36), nullable=True)
    direction: Mapped[str | None] = mapped_column(String(3), nullable=True)
    fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    demo: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class Budget(Base):
    __tablename__ = "budgets"
    __table_args__ = (
        UniqueConstraint("category_id", "month", "currency", name="uq_budget_month"),
        CheckConstraint("amount_minor > 0", name="positive_budget"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    month: Mapped[date] = mapped_column(Date)
    currency: Mapped[str] = mapped_column(String(3))
    amount_minor: Mapped[int] = mapped_column(Integer)
