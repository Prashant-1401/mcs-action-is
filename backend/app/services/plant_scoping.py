from typing import Optional
from sqlalchemy import select, ColumnElement
from sqlalchemy.sql import Select


def scope_by_plant(
    query: Select,
    current_user: Optional[dict],
    plant_column: ColumnElement,
) -> Select:
    """Scope a query by the current user's plant. Admin users see everything."""
    if current_user is None:
        return query
    if current_user.get("is_admin"):
        return query
    plant_id = current_user.get("plant_id")
    if plant_id:
        return query.where(plant_column == plant_id)
    return query