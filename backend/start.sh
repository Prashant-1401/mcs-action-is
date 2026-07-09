#!/bin/bash
cd /home/prashant/MCS\ ACTION\ IS/backend
exec venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 >> /tmp/backend.log 2>&1
