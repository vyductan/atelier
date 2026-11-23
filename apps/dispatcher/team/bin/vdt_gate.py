#!/usr/bin/env python3
"""Merge-and-deploy gate for vyductan.dev (owner's choice 2026-11-23: "Gate merges and pushes").

    python3 team/bin/vdt_gate.py          # one pass: push every passed branch, watch deploys
    python3 team/bin/vdt_gate.py --check  # say what it would do, push nothing

launchd runs it every 5 minutes (com.vyductan.vdt-gate). Pushing `main` deploys production
(Vercel), so this is the only thing that does it on the bots' behalf.

Input: `~/.vyductan-team/verdicts/<branch>.json`, written ONLY by `team/bin/review-verdict.sh`
(Review's excludedCommands entry; HEAD must equal the sha Review pinned). No bot's sandbox can
write that folder, and every other bot is denied it. Only `verdict: pass` is acted on. Then, cheapest first:

1. the branch is `agent/<8 hex>` and its head is the reviewed sha, or Dev's rebase of it that
   leaves exactly the same bytes (mode + blob per changed file);
2. it only changes regular files under `ALLOWED_PREFIX` (the app's own code), and none of
   `FORBIDDEN_IN_ALLOWED` there (shadcn, env, middleware, configs): the rest needs the person;
3. `origin/main` is an ancestor (push as is), or main moved in OTHER files only and the
   reviewed commits are replayed on it in a temp worktree with exactly the same bytes;
4. `git push origin <sha>:main` without force: if someone pushed in between, git refuses and
   the next pass tries again.

The person's checkout (`~/Developer/vyductan/apps/vyductan.dev`, always dirty with other
sessions' work) is only fetched, never switched, merged or reset. Their local main falls
behind origin; their next push needs a `pull --rebase`.

After a push the deploy is watched through the commit status Vercel posts on GitHub, and the
person is pinged once: READY, or failed (a failed build is never promoted, prod stays as it
was). Rolling back: Vercel's instant rollback, or a revert commit.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime
from pathlib import Path

HOME = Path.home()
REPO = HOME / "Developer" / "vyductan" / "apps" / "vyductan.dev"
VERDICTS = HOME / ".vyductan-team" / "verdicts"
STATE = HOME / ".vyductan-team" / "gate"
GH_REPO = "vyductan/vyductan.dev"
NTFY_TOPIC = HOME / ".atelier" / "openmausbot" / "secrets" / "ntfy-topic"
NO_HOOKS = ("-c", "core.hooksPath=/dev/null")
BRANCH = re.compile(r"^agent/[0-9a-f]{8}$")
SHA = re.compile(r"^[0-9a-f]{40}$")
WATCH_LIMIT_S = 45 * 60

#: What a bot change MAY ship by itself (lower case): the app's own code. An allowlist, not a
#: denylist: a denylist always misses something (tsconfig, .pnpmfile.cjs, vercel.ts…).
ALLOWED_PREFIX = ("apps/web/src/", "apps/web/tests/", "@acme/ui/src/", "docs/")
#: Inside the allowlist still for the person: vendored shadcn, env files, runtime entry points
#: and any build/tool config.
FORBIDDEN_IN_ALLOWED = re.compile(
    r"(^@acme/ui/src/shadcn/|(^|/)\.env|(^|/)(middleware|instrumentation(-client)?)\.[a-z]+$|(^|/)[^/]*\.config\.[a-z]+$|"
    r"(^|/)tsconfig[^/]*\.json$|(^|/)\.claude(/|$)|(^|/)\.git(/|$)|(^|/)migrations(/|$))")


class Refuse(Exception):
    pass


class Busy(Exception):
    pass


def forbidden(path: str) -> bool:
    p = path.lower()
    if ".." in p.split("/") or not p.startswith(ALLOWED_PREFIX):
        return True
    return bool(FORBIDDEN_IN_ALLOWED.search(p))


def git(*args: str, cwd: Path | None = None, check: bool = True) -> str:
    done = subprocess.run(["git", *NO_HOOKS, "-C", str(cwd or REPO), *args], capture_output=True, text=True)
    if check and done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:3])}: {done.stderr.strip()[:200]}")
    return done.stdout.strip()


def log(line: str) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / "gate.log").open("a") as fh:
        fh.write(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {line}\n")
    print(line, flush=True)


def ping(title: str, message: str) -> None:
    """ntfy, best effort (topic is a secret file, never in the repo)."""
    try:
        topic = NTFY_TOPIC.read_text().strip()
        body = json.dumps({"topic": topic, "title": title, "message": message[:500], "tags": ["rocket"]}).encode()
        req = urllib.request.Request("https://ntfy.sh", data=body, headers={"content-type": "application/json"})
        urllib.request.urlopen(req, timeout=10).read()
    except Exception:  # noqa: BLE001 - a ping never blocks the gate
        pass


def deploy_state(sha: str) -> str:
    """Combined GitHub commit status (Vercel posts it): success, failure, error or pending."""
    done = subprocess.run(["gh", "api", f"repos/{GH_REPO}/commits/{sha}/status", "--jq", ".state"],
                          capture_output=True, text=True, timeout=30)
    return done.stdout.strip() if done.returncode == 0 and done.stdout.strip() else "pending"


def change(base: str, tip: str) -> dict[str, str | None]:
    """What base..tip leaves behind, exactly: {path: "<mode> <blob>"} (None = deleted)."""
    paths = [p for p in git("diff", "--name-only", "-z", "--no-renames", base, tip).split("\0") if p]
    out: dict[str, str | None] = dict.fromkeys(paths)
    if paths:
        for row in git("ls-tree", "-z", tip, "--", *paths).split("\0"):
            if row:
                meta, path = row.split("\t", 1)
                mode, _kind, blob = meta.split()
                out[path] = f"{mode} {blob}"
    return out


def same_change(main: str, a: str, b: str) -> bool:
    """b is a rebase of reviewed a onto main that leaves the same bytes and keeps main's work."""
    base_a = git("merge-base", main, a)
    approved = change(base_a, a)
    if set(approved) & set(change(base_a, main)):
        return False
    return approved == change(git("merge-base", main, b), b)


def rebase_exact(main: str, sha: str) -> str:
    """The reviewed commits replayed on main in a temp worktree, byte for byte, or Refuse."""
    base = git("merge-base", main, sha)
    approved = change(base, sha)
    if touched := sorted(set(approved) & set(change(base, main))):
        raise Refuse(f"main cũng sửa {', '.join(touched[:3])} — cần Dev rebase và Review lại")
    tmp = Path(tempfile.mkdtemp(prefix="vdt-gate-")).resolve()
    work = tmp / "wt"
    try:
        git("worktree", "add", "-q", "--detach", str(work), sha)
        done = subprocess.run(["git", *NO_HOOKS, "-c", "user.name=vdt-gate", "-c", "user.email=gate@vyductan.local",
                               "-C", str(work), "rebase", "-q", "--committer-date-is-author-date", main],
                              capture_output=True, text=True, env={**os.environ, "GIT_EDITOR": "true"})
        if done.returncode != 0:
            subprocess.run(["git", *NO_HOOKS, "-C", str(work), "rebase", "--abort"], capture_output=True)
            raise Refuse("rebase lên main bị xung đột — cần Dev rebase và Review lại")
        new = git("rev-parse", "HEAD", cwd=work)
    finally:
        git("worktree", "remove", "--force", str(work), check=False)
        shutil.rmtree(tmp, ignore_errors=True)
    if change(main, new) != approved:
        raise Refuse("rebase không ra đúng các file đã duyệt — cần Review lại")
    return new


def checks(verdict: dict) -> tuple[str, list[str]]:
    """(sha to push, changed paths), or Refuse. Runs no code of the branch."""
    branch, sha = str(verdict.get("branch", "")), str(verdict.get("sha", ""))
    if not BRANCH.match(branch) or not SHA.match(sha):
        raise Refuse("phán quyết thiếu nhánh agent/<8 hex> hoặc sha 40 ký tự")
    main = git("rev-parse", "origin/main")
    head = git("rev-parse", "--verify", "-q", f"refs/heads/{branch}^{{commit}}", check=False)
    if head != sha:
        if not (head and git("cat-file", "-t", sha, check=False) == "commit" and same_change(main, sha, head)):
            raise Refuse(f"đầu nhánh là {head[:9] or 'không có'}, Review duyệt {sha[:9]}")
        sha = head
    changed = list(change(git("merge-base", main, sha), sha))
    if not changed:
        raise Refuse("nhánh không đổi file nào")
    if bad := [p for p in changed if forbidden(p)]:
        raise Refuse(f"chạm chỗ cần người duyệt: {', '.join(bad[:4])}")
    # Only regular files: a symlink (120000) or submodule (160000) can point outside the app.
    if odd := [p for p, v in change(git("merge-base", main, sha), sha).items() if v and v.split()[0] not in ("100644", "100755")]:
        raise Refuse(f"symlink/submodule cần người duyệt: {', '.join(odd[:4])}")
    if subprocess.run(["git", "-C", str(REPO), "merge-base", "--is-ancestor", main, sha]).returncode != 0:
        new = rebase_exact(main, sha)
        log(f"  rebase {sha[:9]} lên origin/main {main[:9]} -> {new[:9]} (đúng từng byte)")
        sha = new
    return sha, changed


def settle(path: Path, verdict: dict, outcome: str, note: str) -> None:
    done = STATE / "done"
    done.mkdir(parents=True, exist_ok=True)
    verdict["gate"] = {"outcome": outcome, "note": note, "at": f"{datetime.now():%Y-%m-%d %H:%M}"}
    (done / f"{path.stem}.{datetime.now():%Y%m%d-%H%M%S}.{outcome}.json").write_text(
        json.dumps(verdict, ensure_ascii=False, indent=1))
    path.unlink(missing_ok=True)


def watch_file() -> Path:
    return STATE / "watch.json"


def process(path: Path, check_only: bool) -> None:
    try:
        verdict = json.loads(path.read_text())
    except (OSError, ValueError):
        if not check_only:
            settle(path, {"file": path.name}, "invalid", "không đọc được JSON")
        return
    if verdict.get("verdict") != "pass":
        return  # fail: CoS sends it back to Dev
    branch = str(verdict.get("branch", "?"))
    try:
        sha, changed = checks(verdict)
        if check_only:
            log(f"{branch}: sẽ đẩy {sha[:9]} ({len(changed)} file)")
            return
        pushed = subprocess.run(["git", *NO_HOOKS, "-C", str(REPO), "push", "-q", "origin", f"{sha}:refs/heads/main"],
                                capture_output=True, text=True)
        if pushed.returncode != 0:
            if "non-fast-forward" in pushed.stderr or "fetch first" in pushed.stderr or "rejected" in pushed.stderr:
                raise Busy("origin/main vừa đổi — lượt sau thử lại")
            raise Refuse(f"git push hỏng: {pushed.stderr.strip()[:160]}")
    except Busy as why:
        log(f"{branch}: chờ ({why})")
        return
    except Exception as e:  # noqa: BLE001 - one bad verdict must not stop the pass
        why = e if isinstance(e, Refuse) else Refuse(f"lỗi khi xét: {type(e).__name__}: {str(e)[:160]}")
        log(f"{branch}: TỪ CHỐI: {why}")
        if not check_only:
            settle(path, verdict, "refused", str(why))
            ping("vyductan gate: không đẩy", f"{branch}: {why}")
        return
    log(f"{branch}: ĐÃ ĐẨY {sha[:9]} lên origin/main ({len(changed)} file)")
    settle(path, verdict, "deployed", f"origin/main = {sha}")
    watch = _json(watch_file(), {})
    watch[sha] = {"branch": branch, "task": verdict.get("task"), "at": time.time()}
    watch_file().write_text(json.dumps(watch, indent=1))
    ping("vyductan gate: đã đẩy lên main", f"{branch} ({len(changed)} file) — Vercel đang deploy {sha[:9]}")


def _json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def watch_deploys() -> None:
    watch = _json(watch_file(), {})
    for sha, info in list(watch.items()):
        state = deploy_state(sha)
        branch = info.get("branch", "?")
        if state == "success":
            ping("vyductan: deploy READY", f"{branch} ({sha[:9]}) đã lên production")
        elif state in ("failure", "error"):
            ping("vyductan: deploy LỖI", f"{branch} ({sha[:9]}): build/deploy hỏng, production giữ bản cũ — xem Vercel")
        elif time.time() - info.get("at", 0) > WATCH_LIMIT_S:
            ping("vyductan: deploy chưa xong", f"{branch} ({sha[:9]}) quá 45 phút chưa có trạng thái — xem Vercel")
        else:
            continue
        log(f"deploy {sha[:9]}: {state}")
        del watch[sha]
    if watch_file().exists() or watch:
        watch_file().write_text(json.dumps(watch, indent=1))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="vyductan.dev merge-and-deploy gate")
    p.add_argument("--check", action="store_true", help="say what would be pushed, push nothing")
    args = p.parse_args(argv)
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / "gate.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        git("fetch", "-q", "origin", "main")
        for path in sorted(VERDICTS.glob("*.json")) if VERDICTS.is_dir() else []:
            process(path, args.check)
        if not args.check:
            watch_deploys()
    return 0


if __name__ == "__main__":
    sys.exit(main())
