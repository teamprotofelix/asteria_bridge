"""Build and verify the static ASTERIA II delivery archive."""
from hashlib import sha256
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
import argparse

ROOT = Path(__file__).resolve().parents[1]
NAME = "ASTERIA_II_Living_Starship_v4.zip"
EXPECTED_CNAME = "asteria-bridge.moip.ai.kr"
TOP_LEVEL = {"ASSET_LICENSES.md", "CHANGELOG.md", "CNAME", "DEVELOPMENT_PROGRESS.md",
             "README.md", "index.html", "manifest.webmanifest", "style.css"}
SOURCE_DIRS = {"assets", "qa", "scripts", "tests"}
SUFFIXES = {".cjs", ".cube", ".glb", ".js", ".json", ".md", ".png", ".py", ".svg", ".webp"}


def include(path):
    parts = path.parts
    if any(part.startswith(".") or part in {"__pycache__", "node_modules"} for part in parts):
        return False
    if len(parts) == 1:
        return path.name in TOP_LEVEL or path.suffix == ".js"
    return parts[0] in SOURCE_DIRS and path.suffix in SUFFIXES


def build(target):
    assert (ROOT / "CNAME").read_text().strip() == EXPECTED_CNAME
    files = sorted(path.relative_to(ROOT) for path in ROOT.rglob("*")
                   if path.is_file() and include(path.relative_to(ROOT)))
    assert set(TOP_LEVEL) <= {path.as_posix() for path in files}
    target.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(target, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            source = ROOT / path
            if source.is_symlink() or ROOT not in source.resolve().parents:
                raise ValueError(f"Unexpected source link: {path}")
            entry = ZipInfo(path.as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, source.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
    with ZipFile(target) as archive:
        assert archive.testzip() is None
        assert archive.namelist() == [path.as_posix() for path in files]
        listing = [f"{sha256(archive.read(path)).hexdigest()}  {path}" for path in archive.namelist()]
    target.with_suffix(".files.txt").write_text("\n".join(listing) + "\n")
    digest = sha256(target.read_bytes()).hexdigest()
    target.with_suffix(".sha256").write_text(f"{digest}  {target.name}\n")
    print(f"CRC OK: {len(files)} files, {target.stat().st_size} bytes, SHA-256 {digest}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("dist"))
    build(parser.parse_args().output / NAME)
