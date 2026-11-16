#!/usr/bin/python3 -I
"""Publish a static build sent over the dedicated ECS SSH connection."""

import fcntl
import io
import os
import re
import secrets
import shutil
import signal
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

SITE = "https://daybyday.omhelp.com"
ROOT = Path("/var/www/daybyday")
LOCK = Path("/run/lock/100day-deploy.lock")
MAX_ARCHIVE = 32 * 1024 * 1024
MAX_ENTRIES = 2048
PUBLIC_PATH = re.compile(r"[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)*")
ENTRY_ASSET = re.compile(rb'''(?:src|href)=["'](/assets/[a-zA-Z0-9_.-]+\.(?:js|css))["']''')


def unpack(data, directory):
    revision = ""
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as archive:
        for count, member in enumerate(archive, start=1):
            if count > MAX_ENTRIES:
                raise ValueError("Too many build files")
            name = member.name.removeprefix("./")
            if member.isdir() and name in (".", ""):
                continue
            if member.type in (tarfile.REGTYPE, tarfile.AREGTYPE):
                with archive.extractfile(member) as source:
                    if name == ".release-commit" and not revision and member.size == 41:
                        revision = source.read().decode("ascii").strip()
                        if re.fullmatch(r"[a-f0-9]{40}", revision):
                            continue
                        raise ValueError("Invalid Git commit in archive")
                    if not PUBLIC_PATH.fullmatch(name):
                        raise ValueError("Invalid build file path")
                    target = directory / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open("xb") as destination:
                        shutil.copyfileobj(source, destination)
            elif member.isdir() and PUBLIC_PATH.fullmatch(name):
                (directory / name).mkdir(parents=True, exist_ok=True)
            else:
                raise ValueError("Unsupported entry in build archive")
    if not revision:
        raise ValueError("Missing Git commit in archive")
    return revision


def entry_assets(index):
    return {match.decode("ascii") for match in ENTRY_ASSET.findall(index)}


def switch_current(target):
    link = ROOT / f".current-{secrets.token_hex(6)}"
    link.symlink_to(target)
    try:
        link.replace(ROOT / "current")
    finally:
        link.unlink(missing_ok=True)


def check_response(route, expected=None):
    with urlopen(f"{SITE}{route}", timeout=8) as response:
        if response.status != 200:
            raise RuntimeError(f"Unexpected status for {route}: {response.status}")
        if expected is not None and response.read(len(expected) + 1) != expected:
            raise RuntimeError(f"Published content differs for {route}")


def publish(data):
    current = (ROOT / "current").resolve(strict=True)
    releases = (ROOT / "releases").resolve(strict=True)
    if current.parent != releases or not (ROOT / "current").is_symlink():
        raise ValueError("Unexpected current release directory")
    with tempfile.TemporaryDirectory(prefix=".ci-stage-", dir=releases) as stage:
        staged = Path(stage) / "public"
        staged.mkdir(mode=0o755)
        revision = unpack(data, staged)
        index = (staged / "index.html").read_bytes()
        assets = entry_assets(index)
        if not any(asset.endswith(".js") for asset in assets):
            raise ValueError("Build does not reference an entry JavaScript file")
        expected_assets = {asset: (staged / asset[1:]).read_bytes() for asset in assets}
        previous_assets = entry_assets((current / "index.html").read_bytes())
        for asset in previous_assets - assets:
            previous = current / asset[1:]
            if previous.is_file() and not (staged / asset[1:]).exists():
                shutil.copyfile(previous, staged / asset[1:])
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        release = releases / f"{stamp}-{revision[:12]}-{secrets.token_hex(3)}"
        staged.rename(release)

    try:
        switch_current(release)
        check_response("/", index)
        check_response("/stats", index)
        for asset, content in sorted(expected_assets.items()):
            check_response(asset, content)
        check_response("/api/")
    except BaseException:
        switch_current(current)
        print("Restored previous frontend release", file=sys.stderr)
        raise
    print(f"Published Git commit {revision} to {SITE} ({release.name})")


def interrupted(number, _frame):
    raise InterruptedError(f"Interrupted by signal {number}")


def main():
    os.umask(0o022)
    for number in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
        signal.signal(number, interrupted)
    data = sys.stdin.buffer.read(MAX_ARCHIVE + 1)
    if not data or len(data) > MAX_ARCHIVE:
        raise ValueError("Build archive is empty or exceeds 32 MiB")
    with LOCK.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        publish(data)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, tarfile.TarError) as error:
        sys.exit(f"Frontend deployment failed: {error}")
