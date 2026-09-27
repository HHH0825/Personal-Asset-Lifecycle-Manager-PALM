"""PyInstaller onedir bundle for the installed Windows edition."""

from pathlib import Path

package_dir = Path(SPEC).resolve().parent
project_root = package_dir.parent.parent
icon_file = package_dir / "out" / "palm.ico"

a = Analysis(
    [str(package_dir / "launcher.py")],
    pathex=[str(project_root), str(package_dir)],
    binaries=[],
    datas=[
        (str(project_root / "templates"), "templates"),
        (str(project_root / "static"), "static"),
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="PALM",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    icon=str(icon_file),
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="PALM",
)
