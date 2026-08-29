#!/usr/bin/env python3
"""Teach the Luz packaging scripts to read product.conf instead of hardcoding.

Everything that differs between plug-ins — name, version, bundle prefix, which
CMake targets exist — was written into scripts/package.sh by hand. That is fine
for one product and a copy-paste trap for the second, where the failure mode is
an installer that quietly carries the wrong bundle identifiers and so reads to
macOS as an unrelated piece of software rather than an upgrade.

Run once:  python3 scripts/parameterise-luz-packaging.py
"""
import io
import os

ROOT = os.path.expanduser('~/Desktop/Plugins/Luz')
PACKAGE = os.path.join(ROOT, 'scripts', 'package.sh')

SOURCE_CONF = '''
# Everything product-specific lives in product.conf, so plug-in number two is a
# copy of this project with one file edited.
CONF="$(dirname "$0")/../product.conf"
if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
else
  echo "product.conf not found next to the project root."
  exit 1
fi

VERSION="$PRODUCT_VERSION"
'''

EDITS = [
    # Replace the hardcoded VERSION with one sourced from product.conf.
    ('VERSION="1.0.0"', SOURCE_CONF.strip()),

    ('PROFILE="${LUZ_NOTARY_PROFILE:-luz-notary}"',
     'PROFILE="${LUZ_NOTARY_PROFILE:-$NOTARY_PROFILE}"'),

    ('STAGE="$(mktemp -d /tmp/luz-pkg.XXXXXX)"',
     'STAGE="$(mktemp -d "/tmp/${PRODUCT_NAME}-pkg.XXXXXX")"'),

    ('for t in Luz LuzFX LuzMIDI; do',
     'for t in $PLUGIN_TARGETS; do'),

    ('for f in "$BUILD_DIR"/Luz_artefacts/Release/Standalone/*.app; do stage_one "$f" app; done',
     'if [ -n "${STANDALONE_TARGET:-}" ]; then\n'
     '  for f in "$BUILD_DIR/${STANDALONE_TARGET}_artefacts/Release/Standalone"/*.app; do\n'
     '    stage_one "$f" app\n'
     '  done\n'
     'fi'),

    ('build_component au   "/Library/Audio/Plug-Ins/Components" com.hundredlights.luz.pkg.au    Luz-AU.pkg',
     'build_component au   "/Library/Audio/Plug-Ins/Components" "$BUNDLE_PREFIX.pkg.au"   "$PRODUCT_NAME-AU.pkg"'),
    ('build_component vst3 "/Library/Audio/Plug-Ins/VST3"       com.hundredlights.luz.pkg.vst3  Luz-VST3.pkg',
     'build_component vst3 "/Library/Audio/Plug-Ins/VST3"       "$BUNDLE_PREFIX.pkg.vst3" "$PRODUCT_NAME-VST3.pkg"'),
    ('build_component clap "/Library/Audio/Plug-Ins/CLAP"       com.hundredlights.luz.pkg.clap  Luz-CLAP.pkg',
     'build_component clap "/Library/Audio/Plug-Ins/CLAP"       "$BUNDLE_PREFIX.pkg.clap" "$PRODUCT_NAME-CLAP.pkg"'),
    ('build_component app  "/Applications"                      com.hundredlights.luz.pkg.app   Luz-App.pkg',
     'build_component app  "/Applications"                      "$BUNDLE_PREFIX.pkg.app"  "$PRODUCT_NAME-App.pkg"'),

    ('<title>Luz by 100Lights</title>', '<title>$PRODUCT_TITLE</title>'),

    ('<pkg-ref id="com.hundredlights.luz.pkg.au"/>',   '<pkg-ref id="$BUNDLE_PREFIX.pkg.au"/>'),
    ('<pkg-ref id="com.hundredlights.luz.pkg.vst3"/>', '<pkg-ref id="$BUNDLE_PREFIX.pkg.vst3"/>'),
    ('<pkg-ref id="com.hundredlights.luz.pkg.clap"/>', '<pkg-ref id="$BUNDLE_PREFIX.pkg.clap"/>'),
    ('<pkg-ref id="com.hundredlights.luz.pkg.app"/>',  '<pkg-ref id="$BUNDLE_PREFIX.pkg.app"/>'),

    ('<pkg-ref id="com.hundredlights.luz.pkg.au"   version="$VERSION">Luz-AU.pkg</pkg-ref>',
     '<pkg-ref id="$BUNDLE_PREFIX.pkg.au"   version="$VERSION">$PRODUCT_NAME-AU.pkg</pkg-ref>'),
    ('<pkg-ref id="com.hundredlights.luz.pkg.vst3" version="$VERSION">Luz-VST3.pkg</pkg-ref>',
     '<pkg-ref id="$BUNDLE_PREFIX.pkg.vst3" version="$VERSION">$PRODUCT_NAME-VST3.pkg</pkg-ref>'),
    ('<pkg-ref id="com.hundredlights.luz.pkg.clap" version="$VERSION">Luz-CLAP.pkg</pkg-ref>',
     '<pkg-ref id="$BUNDLE_PREFIX.pkg.clap" version="$VERSION">$PRODUCT_NAME-CLAP.pkg</pkg-ref>'),
    ('<pkg-ref id="com.hundredlights.luz.pkg.app"  version="$VERSION">Luz-App.pkg</pkg-ref>',
     '<pkg-ref id="$BUNDLE_PREFIX.pkg.app"  version="$VERSION">$PRODUCT_NAME-App.pkg</pkg-ref>'),

    ('<title>Luz on its own, without a DAW. Installs to /Applications.',
     '<title>$PRODUCT_NAME on its own, without a DAW. Installs to /Applications.'),
    ('description="Luz on its own, without a DAW. Installs to /Applications.">',
     'description="$PRODUCT_NAME on its own, without a DAW. Installs to /Applications.">'),

    ('PKG="$OUT/Luz-$VERSION.pkg"', 'PKG="$OUT/$PRODUCT_NAME-$VERSION.pkg"'),

    ('hdiutil create -quiet -volname "Luz $VERSION" -srcfolder "$DMG_DIR" \\',
     'hdiutil create -quiet -volname "$PRODUCT_NAME $VERSION" -srcfolder "$DMG_DIR" \\'),
    ('-ov -format UDZO "$OUT/Luz-$VERSION.dmg"',
     '-ov -format UDZO "$OUT/$PRODUCT_NAME-$VERSION.dmg"'),
    ('"$OUT/Luz-$VERSION.dmg"', '"$OUT/$PRODUCT_NAME-$VERSION.dmg"'),
    ('echo "==> $OUT/Luz-$VERSION.dmg"', 'echo "==> $OUT/$PRODUCT_NAME-$VERSION.dmg"'),
]


def main() -> None:
    text = io.open(PACKAGE, encoding='utf-8').read()
    applied, missed = 0, []
    for old, new in EDITS:
        if old in text:
            text = text.replace(old, new)
            applied += 1
        elif new not in text:
            missed.append(old[:70])
    io.open(PACKAGE, 'w', encoding='utf-8').write(text)

    print(f'applied {applied} of {len(EDITS)} edits')
    if missed:
        print('\nNOT FOUND (check these by hand):')
        for m in missed:
            print(f'  {m}')
    remaining = [
        f'  line {i}: {ln.strip()[:78]}'
        for i, ln in enumerate(text.splitlines(), 1)
        if 'Luz' in ln and 'PRODUCT_' not in ln and not ln.strip().startswith('#')
    ]
    print('\nremaining literal "Luz" outside comments:')
    print('\n'.join(remaining) if remaining else '  none')


if __name__ == '__main__':
    main()
