#!/usr/bin/env python3
"""Point the Luz plug-in at the domain that actually exists.

100lights.app was never registered — it has no nameservers — so every URL
baked into the shipped binary pointed at nothing. Activation, preset sync,
the Visit button and the support address in the licence file were all dead.

100Lights is the company; Luz is one of its products. So:
    company site   -> https://100lights.com
    company email  -> hello@100lights.com
    the product    -> https://100lights.com/store/plugins

Run from anywhere:  python3 scripts/retarget-luz-domain.py
"""
import os

ROOT = os.path.expanduser('~/Desktop/Plugins/Luz')
EXTS = ('cpp', 'h', 'mjs', 'js', 'json', 'md', 'sh', 'txt')
SKIP = {'build', 'node_modules', '.git', 'dist', 'JUCE'}

# Order matters: the longest, most specific URLs first, or the bare-domain
# rule below would rewrite their host and leave a path that never existed.
REPLACEMENTS = [
    ('https://100lights.app/luz/manual', 'https://100lights.com/store/plugins'),
    ('https://100lights.app/support',    'https://100lights.com/store/plugins'),
    ('https://100lights.app/luz',        'https://100lights.com/store/plugins'),
    ('100lights.app',                    '100lights.com'),
]


def main() -> None:
    changed = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP]
        for name in files:
            if name.rsplit('.', 1)[-1] not in EXTS:
                continue
            path = os.path.join(base, name)
            try:
                with open(path, encoding='utf-8') as fh:
                    original = fh.read()
            except (UnicodeDecodeError, OSError):
                continue
            if '100lights.app' not in original:
                continue
            updated = original
            for old, new in REPLACEMENTS:
                updated = updated.replace(old, new)
            if updated != original:
                with open(path, 'w', encoding='utf-8') as fh:
                    fh.write(updated)
                changed.append(os.path.relpath(path, ROOT))

    for rel in sorted(changed):
        print(f'  {rel}')
    print(f'\nfiles changed: {len(changed)}')


if __name__ == '__main__':
    main()
