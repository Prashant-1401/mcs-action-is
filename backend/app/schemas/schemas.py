from pydantic import BaseModel
from typing import List, Dict, Any, Optional



class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: Dict[str, Any]


class PlantCreate(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    location: Optional[str] = None
    head: Optional[str] = None


class PlantUpdate(BaseModel):
    model_config = {"extra": "ignore"}

    name: Optional[str] = None
    location: Optional[str] = None
    head: Optional[str] = None


class DepartmentCreate(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    plant_id: Optional[str] = None
    head: Optional[str] = None
    icon: Optional[str] = None


class DepartmentUpdate(BaseModel):
    model_config = {"extra": "ignore"}

    name: Optional[str] = None
    plant_id: Optional[str] = None
    head: Optional[str] = None
    icon: Optional[str] = None


class RoleCreate(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    level: int


class RoleUpdate(BaseModel):
    model_config = {"extra": "ignore"}

    name: Optional[str] = None
    level: Optional[int] = None


class UserCreate(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    username: str
    password: Optional[str] = None
    role: Optional[str] = None
    plant_id: Optional[str] = None
    dept_id: Optional[str] = None
    superior: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    initials: Optional[str] = None
    color: Optional[str] = "#7C80B0"
    master_access: Optional[bool] = False


class UserUpdate(BaseModel):
    model_config = {"extra": "ignore"}

    name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    plant_id: Optional[str] = None
    dept_id: Optional[str] = None
    superior: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    initials: Optional[str] = None
    color: Optional[str] = None
    master_access: Optional[bool] = None


class MachineCreate(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: Optional[str] = None
    plant_id: Optional[str] = None
    dept_id: Optional[str] = None
    type: Optional[str] = None
    asset_no: Optional[str] = None


class MachineUpdate(BaseModel):
    model_config = {"extra": "ignore"}

    name: Optional[str] = None
    plant_id: Optional[str] = None
    dept_id: Optional[str] = None
    type: Optional[str] = None
    asset_no: Optional[str] = None


class ReasonCreate(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    text: str
    category: Optional[str] = None


class ReasonUpdate(BaseModel):
    model_config = {"extra": "ignore"}

    text: Optional[str] = None
    category: Optional[str] = None


class ProjectCreate(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    plant_id: Optional[str] = None
    dept_id: Optional[str] = None
    status: Optional[str] = "NOT STARTED"
    owner: Optional[str] = None
    sponsor: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    progress: Optional[int] = 0
    priority: Optional[str] = "NORMAL"
    objective: Optional[str] = None
    scope: Optional[str] = None
    budget: Optional[float] = 0
    description: Optional[str] = None
    risks: Optional[List[Any]] = None
    team: Optional[List[Any]] = None


class ProjectUpdate(BaseModel):
    model_config = {"extra": "ignore"}

    name: Optional[str] = None
    plant_id: Optional[str] = None
    dept_id: Optional[str] = None
    status: Optional[str] = None
    owner: Optional[str] = None
    sponsor: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    progress: Optional[int] = None
    priority: Optional[str] = None
    objective: Optional[str] = None
    scope: Optional[str] = None
    budget: Optional[float] = None
    description: Optional[str] = None
    risks: Optional[List[Any]] = None
    team: Optional[List[Any]] = None


class MeetingCreate(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: Optional[str] = None
    type: Optional[str] = None
    plant_id: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None
    status: Optional[str] = None
    attendees: Optional[List[str]] = None
    duration: Optional[int] = None
    dur: Optional[int] = None
    action_count: Optional[int] = 0
    notes: Optional[str] = None
    facilitator: Optional[str] = None
    recurring: Optional[bool] = False
    recurrence: Optional[str] = None
    project_id: Optional[str] = None
    completed_sessions: Optional[List[Any]] = None
    guidelines: Optional[List[Any]] = None
    scheduled_days: Optional[List[str]] = None


class MeetingUpdate(BaseModel):
    model_config = {"extra": "ignore"}

    name: Optional[str] = None
    type: Optional[str] = None
    plant_id: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None
    status: Optional[str] = None
    attendees: Optional[List[str]] = None
    duration: Optional[int] = None
    dur: Optional[int] = None
    action_count: Optional[int] = None
    notes: Optional[str] = None
    facilitator: Optional[str] = None
    recurring: Optional[bool] = None
    recurrence: Optional[str] = None
    project_id: Optional[str] = None
    completed_sessions: Optional[List[Any]] = None
    guidelines: Optional[List[Any]] = None
    scheduled_days: Optional[List[str]] = None
    live_draft: Optional[dict] = None


class MeetingPresetCreate(BaseModel):
    model_config = {"extra": "ignore"}

    type: str
    attendees: Optional[List[str]] = None
    instructions: Optional[List[str]] = None


class MeetingPresetUpdate(BaseModel):
    model_config = {"extra": "ignore"}

    attendees: Optional[List[str]] = None
    instructions: Optional[List[str]] = None


class EscalationMatrixCreate(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    level: int
    label: Optional[str] = None
    from_user: Optional[str] = None
    target_user: Optional[str] = None
    from_role: Optional[str] = None
    target_role: Optional[str] = None
    overdue_days: Optional[int] = 0
    overdue_hrs: Optional[int] = 0
    notify_method: Optional[str] = None
    applicable_to: Optional[str] = "All"
    priorities: Optional[List[str]] = None
    color: Optional[str] = None
    active: Optional[bool] = True
    description: Optional[str] = None


class EscalationMatrixUpdate(BaseModel):
    model_config = {"extra": "ignore"}

    level: Optional[int] = None
    label: Optional[str] = None
    from_user: Optional[str] = None
    target_user: Optional[str] = None
    from_role: Optional[str] = None
    target_role: Optional[str] = None
    overdue_days: Optional[int] = None
    overdue_hrs: Optional[int] = None
    notify_method: Optional[str] = None
    applicable_to: Optional[str] = None
    priorities: Optional[List[str]] = None
    color: Optional[str] = None
    active: Optional[bool] = None
    description: Optional[str] = None


class ActionCreate(BaseModel):
    model_config = {"extra": "ignore"}

    id: Optional[str] = None
    sn: Optional[str] = None
    text: str
    responsible_user_id: Optional[str] = None
    responsible: Optional[str] = None
    due: Optional[str] = None
    status: Optional[str] = "NOT STARTED"
    priority: Optional[str] = "NORMAL"
    section: Optional[str] = None
    source: Optional[str] = None
    plant_id: Optional[str] = None
    dept_id: Optional[str] = None
    machine_id: Optional[str] = None
    machine_name: Optional[str] = None
    reason_id: Optional[str] = None
    reason: Optional[str] = None
    reason_of_action: Optional[str] = None
    action_point_type: Optional[str] = None
    remarks: Optional[str] = None
    date_of_action: Optional[str] = None
    closed_on: Optional[str] = None
    closed_by: Optional[str] = None
    allocated_by: Optional[str] = None
    project_id: Optional[str] = None
    project: Optional[str] = None
    src: Optional[str] = None
    pending_confirmation: Optional[bool] = False


class ActionUpdate(BaseModel):
    model_config = {"extra": "ignore"}

    text: Optional[str] = None
    responsible_user_id: Optional[str] = None
    responsible: Optional[str] = None
    due: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    section: Optional[str] = None
    source: Optional[str] = None
    plant_id: Optional[str] = None
    dept_id: Optional[str] = None
    machine_id: Optional[str] = None
    machine_name: Optional[str] = None
    reason_id: Optional[str] = None
    reason: Optional[str] = None
    reason_of_action: Optional[str] = None
    action_point_type: Optional[str] = None
    remarks: Optional[str] = None
    date_of_action: Optional[str] = None
    closed_on: Optional[str] = None
    closed_by: Optional[str] = None
    allocated_by: Optional[str] = None
    project_id: Optional[str] = None
    project: Optional[str] = None
    src: Optional[str] = None
    pending_confirmation: Optional[bool] = None
    revisions: Optional[int] = None
    revision_history: Optional[List[Any]] = None


class ActionMessageCreate(BaseModel):
    model_config = {"extra": "ignore"}

    id: Optional[int] = None
    action_id: str
    source_msg_id: Optional[str] = None
    author: Optional[str] = None
    author_initials: Optional[str] = None
    author_color: Optional[str] = None
    text: Optional[str] = None
    ts: Optional[str] = None


class AuditCreate(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    ts: Optional[str] = None
    action_sn: Optional[str] = None
    action_id: Optional[str] = None
    text: Optional[str] = None
    level: Optional[int] = None
    target: Optional[str] = None
    reason: Optional[str] = None


class MeetingReviewReq(BaseModel):
    transcript: str
    meeting_type: str
    plant: str = "Adroit"
    previous_actions: List[Dict[str, Any]] = []


class ParagraphAnalysisReq(BaseModel):
    paragraph: str
    meeting_type: str
    source_lang: str = "en"


class TranslateReq(BaseModel):
    text: str
    source: str = "hi"
    target: str = "en"


class InsightsShareReq(BaseModel):
    insights: List[Dict[str, Any]]
    meeting_type: str
    plant: str
    recipients: List[str]
    phones: List[str] = []


class EmailEscalateReq(BaseModel):
    """Deprecated — escalation now queries DB directly. Kept for backward compat."""
    actions: List[Dict[str, Any]] = []


class ActionsEmailReq(BaseModel):
    model_config = {"extra": "ignore"}

    responsible: str
    email: str
    status: Optional[str] = None
