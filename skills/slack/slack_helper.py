#!/usr/bin/env python3
"""Shared Slack config helper. Reads creds from ~/.niahere/config.yaml."""

import yaml
import requests
from pathlib import Path

CONFIG_PATH = Path.home() / ".niahere" / "config.yaml"

_identity_cache = None

def load_slack_config():
    """Load Slack config from ~/.niahere/config.yaml."""
    with open(CONFIG_PATH) as f:
        config = yaml.safe_load(f)
    slack = config["channels"]["slack"]
    return {
        "token": slack["bot_token"],
        "app_token": slack.get("app_token"),
        "dm_user_id": slack.get("dm_user_id"),
    }

def get_identity():
    """Call auth.test to get bot identity and workspace info. Cached per process."""
    global _identity_cache
    if _identity_cache:
        return _identity_cache
    resp = requests.get("https://slack.com/api/auth.test", headers=auth_headers())
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"Slack auth failed: {data.get('error')}")
    _identity_cache = {
        "bot_user_id": data["user_id"],
        "bot_id": data["bot_id"],
        "bot_name": data["user"],
        "workspace": data["team"],
        "workspace_id": data["team_id"],
        "workspace_url": data["url"],
    }
    return _identity_cache

def auth_headers(token=None):
    """Return Authorization headers for Slack API calls."""
    if not token:
        token = load_slack_config()["token"]
    return {"Authorization": f"Bearer {token}"}

def open_dm(user_id=None):
    """Open a DM channel with a user. Defaults to dm_user_id from config."""
    config = load_slack_config()
    user_id = user_id or config["dm_user_id"]
    resp = requests.post(
        "https://slack.com/api/conversations.open",
        headers={**auth_headers(), "Content-Type": "application/json"},
        json={"users": user_id},
    )
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"Failed to open DM: {data.get('error')}")
    return data["channel"]["id"]
