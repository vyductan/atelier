#!/usr/bin/env python3
"""Adds Edit denies to team/settings/bl3q-fix.json for bl3q-fix at OMB `full`.

`full` skips every card and the OS sandbox binds Bash only, so bl3q-fix's Edit
tool could write the MAIN bl3q checkout (~/Developer/g-bots/bl3q), whose
tools/*.sh bl3q-lead runs outside its sandbox (excludedCommands) and whose
tools/agent_merge.py is the merge gate (and ~/Developer/vyductan holds Dev's
unsandboxed fresh-worktree.sh). This fences every entry that exists NOW under
~, ~/Developer and ~/Developer/g-bots outside the two bl3q checkouts, every
entry in the main checkout, the parts of its .git that `git commit` in the
bl3q-agent worktree does not write, and the shell startup files under ~
(whether or not they exist yet). Edit denies also merge into the sandbox
write-deny, so the .git paths the worktree's git needs stay open.

Idempotent: only adds deny rules; rewrites the repro_web.sh excludedCommands from KICH_BAN. Rerun after adding top-level entries to the main
checkout, then install-settings.sh. Usage: python3 team/gen-bl3q-fix-denies.py
"""
import json, os, re

os.chdir(os.path.expanduser('~/Developer/vyductan/apps/atelier/apps/dispatcher'))
H = os.path.expanduser('~')
path = 'team/settings/bl3q-fix.json'
cfg = json.load(open(path))
d = cfg['permissions']['deny']
before = len(d)

def add(r):
    if r not in d: d.append(r)

def deny(rel):
    add(f'Edit({rel})'); add(f'Edit({rel}/**)')

special = re.compile(r'[\[\]*?\\{}!]')
def fence(b, keep, rel):
    for n in sorted(os.listdir(b)):
        if n in keep or special.search(n): continue
        deny(f'{rel}/{n}')

# ~ and ~/Developer down to the two bl3q checkouts. Kept open: ~/.cache (uv, in
# the sandbox allowWrite) and ~/.bl3q-team (fenced per folder in the base rules).
fence(H, {'Developer', '.cache', '.bl3q-team'}, '~')
fence(f'{H}/Developer', {'g-bots'}, '~/Developer')
fence(f'{H}/Developer/g-bots', {'bl3q', 'bl3q-agent'}, '~/Developer/g-bots')
for r in ['//Applications', '//Library', '//usr', '//opt', '//etc', '//private/etc']:
    add(f'Edit({r}/**)')
# Files a later session or shell in a folder above the checkouts would load.
for r in ['~', '~/Developer', '~/Developer/g-bots']:
    for n in ['.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude', '.claude-plugin', '.envrc']:
        deny(f'{r}/{n}')

main, mrel = f'{H}/Developer/g-bots/bl3q', '~/Developer/g-bots/bl3q'
fence(main, {'.git'}, mrel)
# Files that would load into a session or shell in the main checkout later.
for n in ['.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude', '.claude-plugin', '.envrc', 'tools', 'lich_chay.sh']:
    deny(f'{mrel}/{n}')
# Its .git: keep what `git commit` on agent/* in the bl3q-agent worktree writes.
g, gr = f'{main}/.git', f'{mrel}/.git'
fence(g, {'objects', 'refs', 'logs', 'worktrees'}, gr)
fence(f'{g}/refs', {'heads'}, f'{gr}/refs')
fence(f'{g}/refs/heads', {'agent'}, f'{gr}/refs/heads')
fence(f'{g}/logs', {'refs'}, f'{gr}/logs')
fence(f'{g}/logs/refs', {'heads'}, f'{gr}/logs/refs')
fence(f'{g}/logs/refs/heads', {'agent'}, f'{gr}/logs/refs/heads')
fence(f'{g}/worktrees', {'bl3q-agent'}, f'{gr}/worktrees')
for n in ['commondir', 'gitdir', 'config.worktree', 'info', 'hooks']:
    deny(f'{gr}/worktrees/bl3q-agent/{n}')
for n in ['hooks', 'config', 'config.worktree', 'info', 'commondir', 'objects/info', 'objects/pack', 'refs/heads/main', 'packed-refs',
          'refs/replace', 'refs/notes', 'refs/tags', 'refs/remotes', 'refs/stash', 'refs/bisect', 'refs/original', 'refs/rewritten',
          'modules', 'shallow']:
    deny(f'{gr}/{n}')
# Startup files and agents that would run code later, whether or not they exist yet.
for n in ['.zshrc', '.zshenv', '.zprofile', '.zlogin', '.zlogout', '.bashrc', '.bash_profile', '.bash_login', '.profile', '.inputrc',
          '.config', '.local', '.ssh', 'Library/LaunchAgents', 'Library/Application Support', '.gitconfig', '.git-credentials',
          '.npmrc', '.pypirc', '.atelier', '.claude', '.claude.json']:
    deny(f'~/{n}')

# The only commands bl3q-fix runs outside its sandbox: `tools/repro_web.sh <scenario>`, one per
# scenario in KICH_BAN of tools/verify_web.py (read from the file, not imported) plus `doctor`.
# Generated so a new scenario cannot be missed; a missed one makes repro_web.sh exit 2 and name
# this script. Other excludedCommands are kept.
import ast
src = ast.parse(open(f'{main}/tools/verify_web.py').read())
kb = next(n.value for n in src.body if isinstance(n, ast.Assign)
          and any(isinstance(t, ast.Name) and t.id == 'KICH_BAN' for t in n.targets))
names = ['doctor'] + [k.value for k in kb.keys if isinstance(k, ast.Constant) and re.fullmatch(r'[a-z_]+', str(k.value))]
repro = '/bin/zsh -f /Users/vyductan/Developer/g-bots/bl3q/tools/repro_web.sh'
ex = cfg['sandbox'].setdefault('excludedCommands', [])
ex[:] = [c for c in ex if not c.startswith(repro + ' ')] + [f'{repro} {n}' for n in names]

open(path, 'w').write(json.dumps(cfg, ensure_ascii=False, indent=2) + '\n')
print(f'{len(d)} deny rules ({len(d) - before} added); repro: {", ".join(names)}')
