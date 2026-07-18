import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from sqlalchemy import select
from app.database import async_session
from app.models.models import Action, Plant, Department, User
from app.services.google_sheets_service import sync_all_actions


async def main():
    async with async_session() as db:
        result = await db.execute(select(Action).order_by(Action.created.desc()))
        actions = result.scalars().all()
        print(f"Found {len(actions)} actions in database")

        if not actions:
            print("No actions to sync")
            return

        action_dicts = []
        for a in actions:
            plant_name = ""
            if a.plant_id:
                pq = await db.execute(select(Plant).where(Plant.id == a.plant_id))
                p = pq.scalar_one_or_none()
                if p:
                    plant_name = p.name

            dept_name = ""
            if a.dept_id:
                dq = await db.execute(select(Department).where(Department.id == a.dept_id))
                d = dq.scalar_one_or_none()
                if d:
                    dept_name = d.name

            resp_email = ""
            resp_phone = ""
            resp_names = [n.strip() for n in (a.responsible or "").split(",") if n.strip()]
            if resp_names:
                uq = await db.execute(select(User).where(User.name == resp_names[0]))
                u = uq.scalar_one_or_none()
                if u:
                    resp_email = u.email or ""
                    resp_phone = u.phone or ""

            action_dicts.append({
                "sn": a.sn,
                "text": a.text,
                "responsible": a.responsible or "",
                "responsible_email": resp_email,
                "responsible_phone": resp_phone,
                "due": str(a.due) if a.due else "",
                "status": a.status or "",
                "priority": a.priority or "",
                "plant": plant_name,
                "dept": dept_name,
                "created": str(a.created) if a.created else "",
            })

        print(f"Syncing {len(action_dicts)} actions to Google Sheets...")
        success = sync_all_actions(action_dicts)
        if success:
            print("Sync completed successfully!")
        else:
            print("Sync failed!")


if __name__ == "__main__":
    asyncio.run(main())
