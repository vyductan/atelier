"""review-verdict.sh run for real on a temp worktree."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent


@pytest.fixture
def wt(tmp_path: Path) -> Path:
    w = tmp_path / "wt"
    subprocess.run(["git", "init", "-q", "-b", "agent/49724d86", str(w)], check=True)
    for k, v in (("user.email", "t@t"), ("user.name", "t")):
        subprocess.run(["git", "-C", str(w), "config", k, v], check=True)
    (w / "a").write_text("1")
    subprocess.run(["git", "-C", str(w), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(w), "commit", "-qm", "x"], check=True)
    return w


def run(wt: Path, tmp: Path, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    # The script has no env overrides (it runs unsandboxed); test a copy with its paths swapped.
    src = (HERE / "review-verdict.sh").read_text()
    src = src.replace("W=/Users/vyductan/Developer/vyductan-agent", f"W={wt}")
    src = src.replace("D=/Users/vyductan/.vyductan-team/verdicts", f"D={tmp / 'v'}")
    copy = tmp / "review-verdict.sh"
    copy.write_text(src)
    return subprocess.run(["/bin/zsh", "-f", str(copy), *args], env={**os.environ, **(env or {})},
                          capture_output=True, text=True, check=False)


def test_writes_the_worktrees_own_branch_and_sha(wt: Path, tmp_path: Path) -> None:
    sha = subprocess.run(["git", "-C", str(wt), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    r = run(wt, tmp_path, "pass", "49724d86-aaaa-bbbb-cccc-000000000000", sha[:9])
    assert r.returncode == 0, r.stderr
    d = json.loads((tmp_path / "v" / "agent__49724d86.json").read_text())
    sha = subprocess.run(["git", "-C", str(wt), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    assert (d["branch"], d["sha"], d["verdict"]) == ("agent/49724d86", sha, "pass")


@pytest.mark.parametrize("args", [("ok", "49724d86", "abcdef1"), ("pass",), ("pass", "49724d86"), ("pass", "1bd684dc", "abcdef1"),
                                  ("pass", "49724d86;x", "abcdef1"), ("fail", "49724d86", "x"), ("pass", "49724d86", "abc")])
def test_bad_input_or_another_tasks_branch_is_refused(wt: Path, tmp_path: Path, args: tuple[str, ...]) -> None:
    r = run(wt, tmp_path, *args)
    assert r.returncode == 2 and not (tmp_path / "v").exists()


def test_a_commit_dev_added_after_the_review_is_refused(wt: Path, tmp_path: Path) -> None:
    # Review pins the sha it read; a later commit by Dev must not ride on that pass.
    reviewed = subprocess.run(["git", "-C", str(wt), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    (wt / "a").write_text("2")
    subprocess.run(["git", "-C", str(wt), "commit", "-qam", "after review"], check=True)
    r = run(wt, tmp_path, "pass", "49724d86", reviewed)
    assert r.returncode == 2 and not (tmp_path / "v").exists()


def test_the_environment_cannot_redirect_it(wt: Path, tmp_path: Path) -> None:
    sha = subprocess.run(["git", "-C", str(wt), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    elsewhere = tmp_path / "elsewhere"
    r = run(wt, tmp_path, "pass", "49724d86", sha, env={"REVIEW_VERDICTS": str(elsewhere), "REVIEW_WORKTREE": "/tmp"})
    assert r.returncode == 0 and not elsewhere.exists() and (tmp_path / "v" / "agent__49724d86.json").exists()
