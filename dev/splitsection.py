# /// script
# requires-python = ">=3.10"
# ///
"""One section of js/app.js moved into a module of its own.

    uv run dev/splitsection.py "<heading>" js/<module>.js "<header comment>" [--dry]

The heading is the text of a section's marker line, with its kind:
"-- the picks" for /* ---- the picks */, "== sidebar" for /* ==== sidebar */.
A section runs to the next marker of either kind.

What moves: the section's top-level definitions. What the module uses from
app.js is imported from './state.js', where app.js hands it over through
provide(): a name state.js does not have yet is printed, to be added to its
`export let` lines, its provide() and the provide() call in app.js. What it
uses from other modules is imported from them as app.js imports it (named,
namespace or default); what app.js uses from the section is imported back;
other modules that imported a moved name from './state.js' are pointed at
the new module; app.js's imports it no longer uses are dropped.

It refuses when a variable would be assigned across the boundary (an
imported binding cannot be assigned: give it a function, as newPlayRun()
does for playRun) or a top-level name exists on both sides. It cannot see
code that uses an app.js binding while the modules load (a cycle leaves it
uninitialised then): build such things from js/dom.js only. After a move,
run node dev/namecheck.mjs, load the player, and the scenarios of the area;
js/AGENTS.md has the checklist.
"""
import glob
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
args = [a for a in sys.argv[1:] if a != '--dry']
dry = '--dry' in sys.argv
if len(args) < 3:
    sys.exit(__doc__)
heading, target, header = args[0], args[1], args[2]
kind, _, title = heading.partition(' ')
if kind not in ('--', '=='):
    sys.exit('the heading starts with -- or ==, as "-- the picks"')
marker_char = '-' if kind == '--' else '='

src = open(os.path.join(ROOT, 'js/app.js')).read()
lines = src.split('\n')
MARK = re.compile(r'^/\* (?:-{3,}|={3,}) ')
marks = [i for i, l in enumerate(lines) if MARK.match(l)]
matches = [i for i in marks if re.match(r'^/\* ' + re.escape(marker_char) + r'{3,} ' + re.escape(title) + r' \*/\s*$', lines[i])]
if len(matches) != 1:
    sys.exit(f'{len(matches)} sections are headed {heading!r}')
start = matches[0]
end = next((i for i in marks if i > start), len(lines))
section = lines[start:end]
sec, rest = '\n'.join(section), '\n'.join(lines[:start] + lines[end:])

NAME = r'[A-Za-z_$][\w$]*'
DEF = re.compile(r'^(?:export )?(?:async )?(?:function\*? (' + NAME + r')|class (' + NAME + r')|(?:const|let|var) (' + NAME + r'))', re.M)
DESTR = re.compile(r'^(?:export )?(?:const|let|var) \{([^}]*)\}\s*=', re.M)


def defs(text):
    out = {m.group(1) or m.group(2) or m.group(3) for m in DEF.finditer(text)}
    for m in DESTR.finditer(text):
        out |= {x.strip().split(':')[-1].strip() for x in m.group(1).split(',') if x.strip()}
    out.discard(None)
    return out


def strip(text):
    """Comments and string contents out, template expressions kept."""
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
    text = re.sub(r'(?<![:\'"`\\])//[^\n]*', ' ', text)
    text = re.sub(r"'(?:\\.|[^'\\\n])*'", "''", text)
    text = re.sub(r'"(?:\\.|[^"\\\n])*"', '""', text)
    text = re.sub(r'`(?:\\.|[^`\\])*`', lambda m: ' '.join(re.findall(r'\$\{([^}]*)\}', m.group(0))), text, flags=re.S)
    return text


def idents(text):
    t = strip(text)
    t = re.sub(r'(?<!\.)\.(?!\.)\s*' + NAME, ' ', t)   # property access, not a spread
    return set(re.findall(r'(?<![\w$])(' + NAME + r')', t))


named = {}   # local name -> (import part, module)
whole = {}   # namespace or default import: local name -> statement
for m in re.finditer(r"^import \{([^}]*)\} from ('[^']+');", rest, re.M):
    for part in m.group(1).split(','):
        part = part.strip()
        if part:
            orig, _, local = part.partition(' as ')
            named[(local or orig).strip()] = (part, m.group(2))
for m in re.finditer(r"^(import (?:\* as )?(" + NAME + r") from '[^']+';)", rest, re.M):
    whole[m.group(2)] = m.group(1)

sec_defs, rest_defs = defs(sec), defs(rest)
clash = sec_defs & rest_defs
if clash:
    sys.exit(f'top-level names on both sides: {sorted(clash)}')
used_in_sec, used_in_rest = idents(sec), idents(rest)
from_app = sorted((used_in_sec & rest_defs) - sec_defs)
from_named = sorted((used_in_sec & set(named)) - sec_defs)
from_whole = sorted((used_in_sec & set(whole)) - sec_defs)
to_app = sorted(sec_defs & used_in_rest)


def assigned(name, text):
    t = strip(text)
    n = re.escape(name)
    return re.search(r'(?<![\w$.])' + n + r'\s*(?:[-+*/%|&^]|\*\*|<<|>>>?|\?\?|\|\||&&)?=(?!=)', t) or \
        re.search(r'(?:\+\+|--)\s*' + n + r'(?![\w$])|(?<![\w$.])' + n + r'\s*(?:\+\+|--)', t)


kinds = lambda text: {m.group(2): m.group(1) for m in re.finditer(r'^(?:export )?(let|var) (' + NAME + ')', text, re.M)}
rk, sk = kinds(rest), kinds(sec)
bad = [n for n in from_app if n in rk and assigned(n, sec)] + [n for n in to_app if n in sk and assigned(n, rest)]
if bad:
    sys.exit(f'assigned across the boundary (give them a function): {bad}')

print(f'section {heading!r}: lines {start + 1}-{end}, {len(section)} lines')
print('from app.js:', from_app)
print('from modules:', from_named + from_whole)
print('back to app.js:', to_app)
if dry:
    sys.exit(0)

# The new module.
by_module = {}
for n in from_named:
    part, module = named[n]
    by_module.setdefault(module, []).append(part)
imports = [f"import {{ {', '.join(sorted(parts))} }} from {module};" for module, parts in by_module.items()]
imports += [whole[n] for n in from_whole]
if from_app:
    imports.append(f"import {{ {', '.join(from_app)} }} from './state.js';")
body = '\n'.join(section[1:]).strip('\n')
B = r'(?![\w$])'
for n in to_app:
    body = re.sub(r'^((?:async )?function\*? ' + re.escape(n) + B + ')', r'export \1', body, flags=re.M)
    body = re.sub(r'^((?:const|let|var|class) ' + re.escape(n) + B + ')', r'export \1', body, flags=re.M)
mod = os.path.basename(target)
open(os.path.join(ROOT, target), 'w').write(header.rstrip() + '\n\n' + '\n'.join(imports) + '\n\n' + body + '\n')

# app.js: the section out, exports for what the module takes, the import back.
out = rest
state_js = open(os.path.join(ROOT, 'js/state.js')).read()
unprovided = [n for n in from_app if not re.search(r'^export (?:let|const|function|async function)\b[^\n]*(?<![\w$])' + re.escape(n) + B, state_js, re.M)]
if unprovided:
    print('add to state.js (export let, provide) and to provide() in app.js:', unprovided)
if to_app:
    out_lines = out.split('\n')
    last_import = max(i for i, l in enumerate(out_lines) if l.startswith('import '))
    out_lines.insert(last_import + 1, f"import {{ {', '.join(to_app)} }} from './{mod}';")
    out = '\n'.join(out_lines)
body_ids = idents(re.sub(r'^import [^\n]*$', '', out, flags=re.M))


def prune(m):
    parts = [p.strip() for p in m.group(1).split(',') if p.strip()]
    keep = [p for p in parts if (p.partition(' as ')[2] or p).strip() in body_ids]
    return f"import {{ {', '.join(keep)} }} from {m.group(2)};" if keep else ''


out = re.sub(r"^import \{([^}]*)\} from ('[^']+');", prune, out, flags=re.M)
out = re.sub(r'\n{3,}', '\n\n', out)
open(os.path.join(ROOT, 'js/app.js'), 'w').write(out)

# Other modules that took a moved name from './state.js' take it from the new one.
for other in glob.glob(os.path.join(ROOT, 'js', '*.js')):
    if other.endswith(('/app.js', '/' + mod)):
        continue
    text = open(other).read()
    m = re.search(r"^import \{([^}]*)\} from './state.js';", text, re.M)
    if not m:
        continue
    names = [n.strip() for n in m.group(1).split(',') if n.strip()]
    moved = [n for n in names if n in sec_defs]
    if not moved:
        continue
    keep = [n for n in names if n not in moved]
    repl = (f"import {{ {', '.join(keep)} }} from './state.js';\n" if keep else '') + f"import {{ {', '.join(moved)} }} from './{mod}';"
    open(other, 'w').write(text.replace(m.group(0), repl))
    print('imports pointed at', mod, 'in', os.path.basename(other), moved)
print('written', target)
