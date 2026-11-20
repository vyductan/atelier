#!/usr/bin/env python3
"""Builds team/settings/dev.json from dev.base.json for Dev at OMB `full`.

`full` skips every card and the OS sandbox binds Bash only, so Edit/Write
outside the worktree is fenced with deny rules naming every entry that exists
NOW under ~, ~/Developer and the path down to the main repo's .git (which
git commits need, so it stays open). Edit denies also merge into the sandbox
write-deny. Glob-wide rules (`~/*`, `~/.*`) are NOT used: Claude Code turns
them into sandbox denies that cover the worktree's .git too and break git.
Rerun after adding things to ~ (new entries are not fenced), then
install-settings.sh. Usage: python3 team/gen-dev-denies.py
"""
import json,os,re,sys
levels=set((sys.argv[1] if len(sys.argv)>1 else 'home,dev,vy,apps,vdt,git,static,secrets,root,mcp').split(','))
os.chdir(os.path.expanduser('~/Developer/vyductan/apps/atelier/apps/dispatcher'))
H=os.path.expanduser('~')
base=json.load(open('team/settings/dev.base.json'))
d=base['permissions']['deny']
def add(r):
    if r not in d: d.append(r)
if 'mcp' in levels:
    for r in json.load(open('team/settings/review.json'))['permissions']['deny']:
        if r.startswith('mcp__'): add(r)
special=re.compile(r'[\[\]*?\\{}!]')
def fence(b, keep, rel):
    for n in sorted(os.listdir(b)):
        if n in keep or special.search(n): continue
        add(f'Edit({rel}/{n})'); add(f'Edit({rel}/{n}/**)')
if 'home' in levels: fence(H,{'Developer'},'~')
if 'dev' in levels: fence(f'{H}/Developer',{'vyductan-agent','vyductan'},'~/Developer')
if 'vy' in levels: fence(f'{H}/Developer/vyductan',{'apps'},'~/Developer/vyductan')
if 'apps' in levels: fence(f'{H}/Developer/vyductan/apps',{'vyductan.dev'},'~/Developer/vyductan/apps')
if 'vdt' in levels: fence(f'{H}/Developer/vyductan/apps/vyductan.dev',{'.git'},'~/Developer/vyductan/apps/vyductan.dev')
if 'git' in levels:
    # The main repo's .git: open only the paths `git switch -c agent/…` and
    # `git commit` write; everything else (other refs, replace/notes, hooks,
    # config, modules, other worktrees, object info) is denied.
    g=f'{H}/Developer/vyductan/apps/vyductan.dev/.git'; gr='~/Developer/vyductan/apps/vyductan.dev/.git'
    fence(g,{'objects','refs','logs','worktrees'},gr)
    fence(f'{g}/refs',{'heads'},f'{gr}/refs')
    fence(f'{g}/refs/heads',{'agent'},f'{gr}/refs/heads')
    fence(f'{g}/logs',{'refs'},f'{gr}/logs')
    fence(f'{g}/logs/refs',{'heads'},f'{gr}/logs/refs')
    fence(f'{g}/logs/refs/heads',{'agent'},f'{gr}/logs/refs/heads')
    fence(f'{g}/worktrees',{'vyductan-agent'},f'{gr}/worktrees')
    for n in ['refs/replace','refs/notes','refs/tags','refs/remotes','refs/stash','objects/info','objects/pack','modules','shallow','info','hooks','config','commondir']:
        add(f'Edit({gr}/{n})'); add(f'Edit({gr}/{n}/**)')
if 'static' in levels:
    # Startup files and agents that would run code later, whether or not they exist yet.
    for n in ['.zshrc','.zshenv','.zprofile','.zlogin','.zlogout','.bashrc','.bash_profile','.bash_login','.profile','.inputrc',
              '.config','.local','.ssh','Library/LaunchAgents','Library/Application Support','.gitconfig','.git-credentials','.npmrc','.pypirc']:
        add(f'Edit(~/{n})'); add(f'Edit(~/{n}/**)')
if 'secrets' in levels:
    # Secret and token stores: Read (the tool is not sandboxed) and the sandbox's own denyRead (Bash).
    stores=['.claude.json','.claude.json.backup','.claude.json.antigravity.bak','.gitlab-mcp-token.json','.npmrc','.pypirc','.git-credentials',
            '.emulator_console_auth_token','.docker','.kube','.codex','.gemini','.cli-proxy-api','.9router','.cc-switch',
            '.antigravity','.antigravity-ide','.antigravity_tools','.vyductan-team','.bl3q-team','.claude']
    fs=base['sandbox']['filesystem']
    for n in stores:
        add(f'Read(~/{n})'); add(f'Read(~/{n}/**)')
        if f'~/{n}' not in fs['denyRead']: fs['denyRead'].append(f'~/{n}')
    # Other repos and the main checkout: Bash reads only the worktree, the main .git and git's own config.
    if '~/Developer' not in fs['denyRead']: fs['denyRead'].append('~/Developer')
    for r in ['~/Developer/vyductan-agent','~/Developer/vyductan/apps/vyductan.dev/.git']:
        if r not in fs['allowRead']: fs['allowRead'].append(r)
    base['sandbox']['network']['allowedDomains']=[x for x in base['sandbox']['network']['allowedDomains'] if x!='registry.npmjs.org']
    add('Bash(security:*)'); add('Bash(*security find*)'); add('Bash(*security dump*)')
if 'root' in levels:
    for r in ['Edit(//Applications/**)','Edit(//Library/**)','Edit(//usr/**)','Edit(//opt/**)','Edit(//etc/**)','Edit(//private/etc/**)']: add(r)
out=json.dumps(base,ensure_ascii=False,indent=2)+'\n'
open('team/settings/dev.json','w').write(out)
print(len(d),'rules', sorted(levels))
