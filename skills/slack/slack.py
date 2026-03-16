#!/usr/bin/env python3
"""Atomic Slack primitives. One subcommand = one API call.

Usage: python3 slack.py <action> [args]

Actions:
  send       --channel C... --text "msg"           Post to a channel
  reply      --channel C... --thread-ts 1... --text "msg"  Reply in thread
  dm         --text "msg" [--user U...]            DM a user (default: dm_user_id)
  history    --channel C... [--limit N]            Read channel messages
  thread     --channel C... --thread-ts 1... [--limit N]  Read thread replies
  channels   [--limit N]                           List channels
  users      [--limit N]                           List workspace users
  user-info  --user U...                           Get user profile
  react      --channel C... --ts 1... --emoji name  Add reaction
  search     --query "text" [--limit N]            Search messages
  identity                                         Get bot/workspace info
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from slack_helper import load_slack_config, auth_headers, get_identity, open_dm

import requests


def _api(method, endpoint, **kwargs):
    url = f"https://slack.com/api/{endpoint}"
    if method == "get":
        resp = requests.get(url, headers=auth_headers(), params=kwargs)
    else:
        resp = requests.post(url, headers={**auth_headers(), "Content-Type": "application/json"}, json=kwargs)
    data = resp.json()
    if not data.get("ok"):
        print(json.dumps({"ok": False, "error": data.get("error")}))
        sys.exit(1)
    return data


def _ts_to_time(ts):
    try:
        return datetime.fromtimestamp(float(ts)).strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, OSError):
        return ts


def cmd_send(args):
    data = _api("post", "chat.postMessage", channel=args.channel, text=args.text)
    print(json.dumps({"ok": True, "channel": args.channel, "ts": data.get("ts")}))


def cmd_reply(args):
    data = _api("post", "chat.postMessage", channel=args.channel, text=args.text, thread_ts=args.thread_ts)
    print(json.dumps({"ok": True, "channel": args.channel, "thread_ts": args.thread_ts, "ts": data.get("ts")}))


def cmd_dm(args):
    config = load_slack_config()
    user_id = args.user or config["dm_user_id"]
    channel_id = open_dm(user_id)
    data = _api("post", "chat.postMessage", channel=channel_id, text=args.text)
    print(json.dumps({"ok": True, "dm_channel": channel_id, "user": user_id, "ts": data.get("ts")}))


def cmd_history(args):
    data = _api("get", "conversations.history", channel=args.channel, limit=args.limit)
    for msg in data.get("messages", []):
        print(f"[{_ts_to_time(msg.get('ts', ''))}] {msg.get('user', 'unknown')}: {msg.get('text', '')}")


def cmd_thread(args):
    data = _api("get", "conversations.replies", channel=args.channel, ts=args.thread_ts, limit=args.limit)
    for msg in data.get("messages", []):
        print(f"[{_ts_to_time(msg.get('ts', ''))}] {msg.get('user', 'unknown')}: {msg.get('text', '')}")


def cmd_channels(args):
    data = _api("get", "conversations.list", types="public_channel,private_channel", limit=args.limit)
    channels = sorted(data.get("channels", []), key=lambda c: c.get("name", ""))
    for ch in channels:
        purpose = ch.get("purpose", {}).get("value", "")[:60]
        print(f"#{ch.get('name', ''):<30} {ch.get('id', '')}  ({ch.get('num_members', 0)} members)  {purpose}")


def cmd_users(args):
    data = _api("get", "users.list", limit=args.limit)
    for u in data.get("members", []):
        if u.get("deleted") or u.get("is_bot"):
            continue
        name = u.get("real_name") or u.get("name", "unknown")
        print(f"{u.get('id', ''):<12} @{u.get('name', ''):<20} {name}")


def cmd_user_info(args):
    data = _api("get", "users.info", user=args.user)
    u = data.get("user", {})
    profile = u.get("profile", {})
    print(json.dumps({
        "id": u.get("id"),
        "name": u.get("name"),
        "real_name": u.get("real_name"),
        "title": profile.get("title"),
        "email": profile.get("email"),
        "status": profile.get("status_text"),
        "tz": u.get("tz"),
    }, indent=2))


def cmd_react(args):
    _api("post", "reactions.add", channel=args.channel, timestamp=args.ts, name=args.emoji)
    print(json.dumps({"ok": True, "emoji": args.emoji, "channel": args.channel, "ts": args.ts}))


def cmd_search(args):
    data = _api("get", "search.messages", query=args.query, count=args.limit)
    matches = data.get("messages", {}).get("matches", [])
    for m in matches:
        ch = m.get("channel", {}).get("name", "?")
        print(f"[{_ts_to_time(m.get('ts', ''))}] #{ch} {m.get('username', 'unknown')}: {m.get('text', '')}")


def cmd_identity(args):
    info = get_identity()
    print(json.dumps(info, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Atomic Slack primitives")
    sub = parser.add_subparsers(dest="action", required=True)

    p = sub.add_parser("send")
    p.add_argument("--channel", required=True)
    p.add_argument("--text", required=True)

    p = sub.add_parser("reply")
    p.add_argument("--channel", required=True)
    p.add_argument("--thread-ts", required=True)
    p.add_argument("--text", required=True)

    p = sub.add_parser("dm")
    p.add_argument("--text", required=True)
    p.add_argument("--user", default=None)

    p = sub.add_parser("history")
    p.add_argument("--channel", required=True)
    p.add_argument("--limit", type=int, default=20)

    p = sub.add_parser("thread")
    p.add_argument("--channel", required=True)
    p.add_argument("--thread-ts", required=True)
    p.add_argument("--limit", type=int, default=50)

    p = sub.add_parser("channels")
    p.add_argument("--limit", type=int, default=200)

    p = sub.add_parser("users")
    p.add_argument("--limit", type=int, default=200)

    p = sub.add_parser("user-info")
    p.add_argument("--user", required=True)

    p = sub.add_parser("react")
    p.add_argument("--channel", required=True)
    p.add_argument("--ts", required=True)
    p.add_argument("--emoji", required=True)

    p = sub.add_parser("search")
    p.add_argument("--query", required=True)
    p.add_argument("--limit", type=int, default=10)

    p = sub.add_parser("identity")

    args = parser.parse_args()
    {
        "send": cmd_send,
        "reply": cmd_reply,
        "dm": cmd_dm,
        "history": cmd_history,
        "thread": cmd_thread,
        "channels": cmd_channels,
        "users": cmd_users,
        "user-info": cmd_user_info,
        "react": cmd_react,
        "search": cmd_search,
        "identity": cmd_identity,
    }[args.action](args)


if __name__ == "__main__":
    main()
