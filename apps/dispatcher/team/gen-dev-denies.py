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
levels=set((sys.argv[1] if len(sys.argv)>1 else 'home,dev,vy,apps,vdt,root,mcp').split(','))
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
if 'root' in levels:
    for r in ['Edit(//Applications/**)','Edit(//Library/**)','Edit(//usr/**)','Edit(//opt/**)','Edit(//etc/**)','Edit(//private/etc/**)']: add(r)
out=json.dumps(base,ensure_ascii=False,indent=2)+'\n'
open('team/settings/dev.json','w').write(out)
print(len(d),'rules', sorted(levels))
