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


def run(wt: Path, tmp: Path, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "REVIEW_WORKTREE": str(wt), "REVIEW_VERDICTS": str(tmp / "v")}
    return subprocess.run(["/bin/zsh", "-f", str(HERE / "review-verdict.sh"), *args], env=env,
                          capture_output=True, text=True, check=False)


def test_writes_the_worktrees_own_branch_and_sha(wt: Path, tmp_path: Path) -> None:
    r = run(wt, tmp_path, "pass", "49724d86-aaaa-bbbb-cccc-000000000000")
    assert r.returncode == 0, r.stderr
    d = json.loads((tmp_path / "v" / "agent__49724d86.json").read_text())
    sha = subprocess.run(["git", "-C", str(wt), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    assert (d["branch"], d["sha"], d["verdict"]) == ("agent/49724d86", sha, "pass")


@pytest.mark.parametrize("args", [("ok", "49724d86"), ("pass",), ("pass", "1bd684dc"), ("pass", "49724d86;x"), ("fail", "49724d86", "x")])
def test_bad_input_or_another_tasks_branch_is_refused(wt: Path, tmp_path: Path, args: tuple[str, ...]) -> None:
    r = run(wt, tmp_path, *args)
    assert r.returncode == 2 and not (tmp_path / "v").exists()
