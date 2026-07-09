"""
Migration script: Google Sheets CSV → PostgreSQL.
Usage: python scripts/migrate_from_sheets.py
"""
import asyncio
import csv
import os
import re
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.database import async_session
from app.models.models import (
    Plant, Department, Role, User, Machine, Reason,
    Project, ProjectMilestone, MeetingPreset, Meeting,
    EscalationMatrix, Action, ActionMessage, Audit,
)
from sqlalchemy import select


CSV_DIR = os.environ.get("CSV_DIR", "./csv_exports")
TABLES = [
    "Plants", "Departments", "Roles", "Users", "Machines",
    "Reasons", "Projects", "ProjectMilestones", "MeetingPresets",
    "Meetings", "EscalationMatrix", "Actions", "ActionMessages", "Audit",
]

MODEL_MAP = {
    "Plants": Plant,
    "Departments": Department,
    "Roles": Role,
    "Users": User,
    "Machines": Machine,
    "Reasons": Reason,
    "Projects": Project,
    "ProjectMilestones": ProjectMilestone,
    "MeetingPresets": MeetingPreset,
    "Meetings": Meeting,
    "EscalationMatrix": EscalationMatrix,
    "Actions": Action,
    "ActionMessages": ActionMessage,
    "Audit": Audit,
}


def camel_to_snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


async def migrate_table(name: str):
    model = MODEL_MAP.get(name)
    if not model:
        print(f"  SKIP: No model for {name}")
        return 0, 0

    path = os.path.join(CSV_DIR, f"{name}.csv")
    if not os.path.exists(path):
        print(f"  SKIP: {path} not found")
        return 0, 0

    async with async_session() as db:
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)

        if not rows:
            print(f"  SKIP: {name} CSV is empty")
            return 0, 0

        inserted = 0
        skipped = 0
        for row in rows:
            cleaned = {camel_to_snake(k): v for k, v in row.items() if k}
            if not cleaned:
                skipped += 1
                continue

            if "id" in cleaned:
                existing = await db.execute(select(model).where(model.id == cleaned["id"]))
                if existing.scalar_one_or_none():
                    skipped += 1
                    continue

            try:
                obj = model(**cleaned)
                db.add(obj)
                inserted += 1
            except Exception as e:
                print(f"  ERROR inserting row in {name}: {e}")
                skipped += 1

        await db.commit()
        print(f"  OK: {name} — {inserted} inserted, {skipped} skipped")
        return inserted, skipped


async def main():
    print(f"Migrating CSVs from: {CSV_DIR}")
    total_in = 0
    total_sk = 0
    for table in TABLES:
        ins, sk = await migrate_table(table)
        total_in += ins
        total_sk += sk
    print(f"\nDone. Total: {total_in} inserted, {total_sk} skipped.")


if __name__ == "__main__":
    asyncio.run(main())
