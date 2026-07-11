import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, Date, Float, ForeignKey, TIMESTAMP, UniqueConstraint, PrimaryKeyConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from app.database import Base


class Plant(Base):
    __tablename__ = "plants"
    id = Column(String, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    location = Column(String(200))
    head = Column(String(100))
    departments = relationship("Department", back_populates="plant")
    users = relationship("User", back_populates="plant")
    actions = relationship("Action", back_populates="plant")
    meetings = relationship("Meeting", back_populates="plant")
    projects = relationship("Project", back_populates="plant")


class Department(Base):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("name", "plant_id"),)
    id = Column(String, primary_key=True)
    name = Column(String(100), nullable=False)
    plant_id = Column(String, ForeignKey("plants.id", onupdate="CASCADE", ondelete="SET NULL"))
    head = Column(String(100))
    icon = Column(String(10))
    plant = relationship("Plant", back_populates="departments")
    users = relationship("User", back_populates="dept")
    machines = relationship("Machine", back_populates="dept")
    actions = relationship("Action", back_populates="dept")


class Role(Base):
    __tablename__ = "roles"
    id = Column(String, primary_key=True)
    name = Column(String(50), unique=True, nullable=False)
    level = Column(Integer, nullable=False)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("username"),)
    id = Column(String, primary_key=True)
    name = Column(String(100), nullable=False)
    username = Column(String(50), unique=True, nullable=False)
    password = Column(String(200))
    role = Column(String(50))
    plant_id = Column(String, ForeignKey("plants.id", onupdate="CASCADE", ondelete="SET NULL"))
    dept_id = Column(String, ForeignKey("departments.id", onupdate="CASCADE", ondelete="SET NULL"))
    superior = Column(String(100))
    phone = Column(String(20))
    email = Column(String(150))
    initials = Column(String(10))
    color = Column(String(20), default="#7C80B0")
    is_active = Column(Boolean, default=True)
    master_access = Column(Boolean, default=False)
    plant = relationship("Plant", back_populates="users")
    dept = relationship("Department", back_populates="users")


class Machine(Base):
    __tablename__ = "machines"
    id = Column(String, primary_key=True)
    name = Column(String(100))
    plant_id = Column(String, ForeignKey("plants.id", onupdate="CASCADE", ondelete="SET NULL"))
    dept_id = Column(String, ForeignKey("departments.id", onupdate="CASCADE", ondelete="SET NULL"))
    type = Column(String(50))
    asset_no = Column(String(50))
    is_active = Column(Boolean, default=True)
    plant = relationship("Plant")
    dept = relationship("Department", back_populates="machines")
    actions = relationship("Action", back_populates="machine")


class Reason(Base):
    __tablename__ = "reasons"
    id = Column(String, primary_key=True)
    text = Column(String(200), nullable=False)
    category = Column(String(50))


class Project(Base):
    __tablename__ = "projects"
    id = Column(String, primary_key=True)
    name = Column(String(200), nullable=False)
    plant_id = Column(String, ForeignKey("plants.id", onupdate="CASCADE", ondelete="SET NULL"))
    dept_id = Column(String, ForeignKey("departments.id", onupdate="CASCADE", ondelete="SET NULL"))
    status = Column(String(30), default="NOT STARTED")
    owner = Column(String(100))
    sponsor = Column(String(100))
    start_date = Column(Date)
    end_date = Column(Date)
    progress = Column(Integer, default=0)
    priority = Column(String(20), default="NORMAL")
    objective = Column(Text)
    scope = Column(Text)
    budget = Column(Float, default=0)
    description = Column(Text)
    risks = Column(JSONB, default=list)
    team = Column(JSONB, default=list)
    plant = relationship("Plant", back_populates="projects")
    dept = relationship("Department")
    milestones = relationship("ProjectMilestone", back_populates="project", cascade="all, delete-orphan")
    actions = relationship("Action", back_populates="project")
    meetings = relationship("Meeting", back_populates="project")


class ProjectMilestone(Base):
    __tablename__ = "project_milestones"
    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(200))
    due = Column(Date)
    done = Column(Boolean, default=False)
    ord = Column(Integer, default=0)
    project = relationship("Project", back_populates="milestones")


class MeetingPreset(Base):
    __tablename__ = "meeting_presets"
    type = Column(String(50), primary_key=True)
    attendees = Column(JSONB, default=list)
    instructions = Column(JSONB, default=list)


class Meeting(Base):
    __tablename__ = "meetings"
    id = Column(String, primary_key=True)
    name = Column(String(200))
    type = Column(String(50))
    plant_id = Column(String, ForeignKey("plants.id", onupdate="CASCADE", ondelete="SET NULL"))
    date = Column(Date)
    time = Column(String(10))
    status = Column(String(30))
    attendees = Column(JSONB, default=list)
    duration = Column(Integer)
    dur = Column(Integer)
    action_count = Column(Integer, default=0)
    notes = Column(Text)
    facilitator = Column(String(100))
    recurring = Column(Boolean, default=False)
    recurrence = Column(String(30))
    project_id = Column(String, ForeignKey("projects.id", onupdate="CASCADE", ondelete="SET NULL"))
    completed_sessions = Column(JSONB, default=list)
    plant = relationship("Plant", back_populates="meetings")
    project = relationship("Project", back_populates="meetings")


class EscalationMatrix(Base):
    __tablename__ = "escalation_matrix"
    id = Column(String, primary_key=True)
    level = Column(Integer, nullable=False)
    label = Column(String(200))
    from_role = Column(String(50))
    target_role = Column(String(50))
    overdue_days = Column(Integer, default=0)
    overdue_hrs = Column(Integer, default=0)
    target = Column(String(50))
    notify_method = Column(String(50))
    applicable_to = Column(String(50), default="All")
    priorities = Column(JSONB, default=list)
    superiors = Column(JSONB, default=list)
    color = Column(String(20))
    active = Column(Boolean, default=True)
    description = Column(Text)


class EscalationPriority(Base):
    __tablename__ = "escalation_priorities"
    __table_args__ = (PrimaryKeyConstraint("escalation_id", "priority"),)
    escalation_id = Column(String, ForeignKey("escalation_matrix.id", ondelete="CASCADE"), nullable=False)
    priority = Column(String(20), nullable=False)


class Action(Base):
    __tablename__ = "actions"
    id = Column(String, primary_key=True)
    sn = Column(String(30), unique=True, nullable=False)
    text = Column(Text, nullable=False)
    responsible_user_id = Column(String, ForeignKey("users.id", onupdate="CASCADE", ondelete="SET NULL"))
    responsible = Column(String(100))
    due = Column(Date)
    status = Column(String(30), default="NOT STARTED")
    priority = Column(String(20), default="NORMAL")
    section = Column(String(50))
    source = Column(String(100))
    plant_id = Column(String, ForeignKey("plants.id", onupdate="CASCADE", ondelete="SET NULL"))
    dept_id = Column(String, ForeignKey("departments.id", onupdate="CASCADE", ondelete="SET NULL"))
    machine_id = Column(String, ForeignKey("machines.id", onupdate="CASCADE", ondelete="SET NULL"))
    machine_name = Column(String(100))
    reason_id = Column(String, ForeignKey("reasons.id", onupdate="CASCADE", ondelete="SET NULL"))
    reason = Column(String(100))
    reason_of_action = Column(String(100))
    action_point_type = Column(String(50))
    remarks = Column(Text)
    date_of_action = Column(Date)
    created = Column(Date, default=datetime.date.today)
    closed_on = Column(Date)
    closed_by = Column(String(100))
    allocated_by = Column(String(100))
    project_id = Column(String, ForeignKey("projects.id", onupdate="CASCADE", ondelete="SET NULL"))
    project_name = Column(String(100))
    src = Column(String(50))
    revisions = Column(Integer, default=0)
    revision_history = Column(JSONB, default=list)
    pending_confirmation = Column(Boolean, default=False)
    plant = relationship("Plant", back_populates="actions")
    dept = relationship("Department", back_populates="actions")
    machine = relationship("Machine", back_populates="actions")
    messages = relationship("ActionMessage", back_populates="action", cascade="all, delete-orphan")
    project = relationship("Project", back_populates="actions")


class ActionMessage(Base):
    __tablename__ = "action_messages"
    id = Column(Integer, primary_key=True, autoincrement=True)
    action_id = Column(String, ForeignKey("actions.id", ondelete="CASCADE"), nullable=False)
    source_msg_id = Column(String)
    author = Column(String(100))
    author_initials = Column(String(10))
    author_color = Column(String(20))
    text = Column(Text)
    ts = Column(TIMESTAMP(timezone=True))
    action = relationship("Action", back_populates="messages")


class Audit(Base):
    __tablename__ = "audit"
    __table_args__ = (UniqueConstraint("action_sn", "level"),)
    id = Column(String, primary_key=True)
    ts = Column(TIMESTAMP(timezone=True))
    action_sn = Column(String(30))
    action_id = Column(String, ForeignKey("actions.id", onupdate="CASCADE", ondelete="SET NULL"))
    text = Column(Text)
    level = Column(Integer)
    target = Column(String(50))
    reason = Column(Text)
