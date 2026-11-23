"""vdt_gate.py on a real temp repo with a bare "origin": push, refusals, exact-bytes rebase, deploy watch.

    uv run --with pytest pytest -q team/bin/test_vdt_gate.py
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

import vdt_gate as G


def sh(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=True).stdout.strip()


@pytest.fixture
def world(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
    repo = tmp_path / "repo"
    subprocess.run(["git", "clone", "-q", str(origin), str(repo)], check=True, capture_output=True)
    sh(repo, "config", "user.email", "t@t")
    sh(repo, "config", "user.name", "t")
    (repo / "apps" / "web").mkdir(parents=True)
    (repo / "apps" / "web" / "a.ts").write_text("a\nb\nc\nd\ne\nf\ng\nh\n")
    (repo / "apps" / "web" / "b.ts").write_text("1\n")
    sh(repo, "add", "-A")
    sh(repo, "commit", "-qm", "base")
    sh(repo, "push", "-q", "origin", "main")
    state = tmp_path / "gate"
    verdicts = tmp_path / "verdicts"
    verdicts.mkdir()
    for name, value in {"REPO": repo, "VERDICTS": verdicts, "STATE": state}.items():
        monkeypatch.setattr(G, name, value)
    pings: list[str] = []
    monkeypatch.setattr(G, "ping", lambda title, msg: pings.append(f"{title}: {msg}"))
    statuses: dict[str, str] = {}
    monkeypatch.setattr(G, "deploy_state", lambda sha: statuses.get(sha, "pending"))

    def branch(name: str, files: dict[str, str], base: str = "origin/main") -> str:
        sh(repo, "switch", "-q", "-c", name, base)
        for rel, text in files.items():
            (repo / rel).parent.mkdir(parents=True, exist_ok=True)
            (repo / rel).write_text(text)
        sh(repo, "add", "-A")
        sh(repo, "commit", "-qm", name)
        sha = sh(repo, "rev-parse", "HEAD")
        sh(repo, "switch", "-q", "main")
        return sha

    def verdict(name: str, sha: str, kind: str = "pass") -> Path:
        p = verdicts / (name.replace("/", "__") + ".json")
        p.write_text(json.dumps({"branch": name, "sha": sha, "verdict": kind, "task": "t"}))
        return p

    def remote_main() -> str:
        return subprocess.run(["git", f"--git-dir={origin}", "rev-parse", "main"], capture_output=True, text=True, check=True).stdout.strip()

    def move_origin(files: dict[str, str]) -> str:
        other = tmp_path / f"other{len(list(tmp_path.glob('other*')))}"
        subprocess.run(["git", "clone", "-q", str(origin), str(other)], check=True, capture_output=True)
        sh(other, "config", "user.email", "o@o")
        sh(other, "config", "user.name", "o")
        for rel, text in files.items():
            (other / rel).write_text(text)
        sh(other, "commit", "-qam", "someone pushed")
        sh(other, "push", "-q", "origin", "main")
        return sh(other, "rev-parse", "HEAD")

    return repo, verdicts, state, pings, statuses, branch, verdict, remote_main, move_origin


def outcome(state: Path) -> list[str]:
    return sorted(p.name.rsplit(".", 2)[-2] for p in (state / "done").glob("*.json"))


def test_a_passed_branch_on_top_of_main_is_pushed(world) -> None:
    repo, verdicts, state, pings, statuses, branch, verdict, remote_main, move_origin = world
    sha = branch("agent/0123abcd", {"apps/web/b.ts": "2\n"})
    verdict("agent/0123abcd", sha)
    G.main([])
    assert remote_main() == sha and outcome(state) == ["deployed"]
    assert any("đã đẩy" in p for p in pings)
    assert sh(repo, "rev-parse", "main") != sha  # the person's local main is never touched


def test_fail_verdicts_and_odd_branches_are_not_pushed(world) -> None:
    repo, verdicts, state, pings, statuses, branch, verdict, remote_main, move_origin = world
    before = remote_main()
    verdict("agent/0123abcd", branch("agent/0123abcd", {"apps/web/b.ts": "2\n"}), "fail")
    verdict("feature/x", branch("feature/x", {"apps/web/b.ts": "3\n"}))
    G.main([])
    assert remote_main() == before and outcome(state) == ["refused"]


@pytest.mark.parametrize("path", ["@acme/ui/src/shadcn/button.tsx", ".claude/settings.json", "apps/web/.env.local",
                                  "supabase/migrations/1.sql", "apps/web/package.json", "pnpm-lock.yaml",
                                  "apps/web/next.config.ts", ".github/workflows/ci.yml", "AGENTS.md", "Apps/Web/.ENV"])
def test_dangerous_paths_are_refused(world, path: str) -> None:
    repo, verdicts, state, pings, statuses, branch, verdict, remote_main, move_origin = world
    before = remote_main()
    verdict("agent/0123abcd", branch("agent/0123abcd", {path: "x\n"}))
    G.main([])
    assert remote_main() == before and outcome(state) == ["refused"]


def test_a_commit_added_after_review_is_refused(world) -> None:
    repo, verdicts, state, pings, statuses, branch, verdict, remote_main, move_origin = world
    before = remote_main()
    sha = branch("agent/0123abcd", {"apps/web/b.ts": "2\n"})
    sh(repo, "switch", "-q", "agent/0123abcd")
    (repo / "apps" / "web" / "b.ts").write_text("2 \n")  # whitespace only still counts
    sh(repo, "commit", "-qam", "after review")
    sh(repo, "switch", "-q", "main")
    verdict("agent/0123abcd", sha)
    G.main([])
    assert remote_main() == before and outcome(state) == ["refused"]


def test_origin_moved_elsewhere_the_reviewed_bytes_are_rebased_and_pushed(world) -> None:
    repo, verdicts, state, pings, statuses, branch, verdict, remote_main, move_origin = world
    sha = branch("agent/0123abcd", {"apps/web/b.ts": "2\n"})
    moved = move_origin({"apps/web/a.ts": "A\nb\nc\nd\ne\nf\ng\nh\n"})
    verdict("agent/0123abcd", sha)
    G.main([])
    head = remote_main()
    assert outcome(state) == ["deployed"] and head != sha
    sh(repo, "fetch", "-q", "origin")
    assert sh(repo, "rev-parse", "origin/main~1") == moved
    assert sh(repo, "show", "origin/main:apps/web/b.ts") == "2"


def test_origin_moved_in_the_same_file_is_refused(world) -> None:
    repo, verdicts, state, pings, statuses, branch, verdict, remote_main, move_origin = world
    sha = branch("agent/0123abcd", {"apps/web/a.ts": "a\nb\nc\nd\ne\nf\ng\nH\n"})
    moved = move_origin({"apps/web/a.ts": "A\nb\nc\nd\ne\nf\ng\nh\n"})
    verdict("agent/0123abcd", sha)
    G.main([])
    assert remote_main() == moved and outcome(state) == ["refused"]


def test_the_deploy_is_watched_until_vercel_answers(world) -> None:
    repo, verdicts, state, pings, statuses, branch, verdict, remote_main, move_origin = world
    sha = branch("agent/0123abcd", {"apps/web/b.ts": "2\n"})
    verdict("agent/0123abcd", sha)
    G.main([])
    pings.clear()
    G.main([])
    assert pings == []  # still pending: no news
    statuses[sha] = "failure"
    G.main([])
    assert len(pings) == 1 and "LỖI" in pings[0]
    G.main([])
    assert len(pings) == 1  # told once
