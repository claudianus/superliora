#!/usr/bin/env python3
"""Multi-size PTY visual check for the SuperLiora bento TUI.

Launches liora in a PTY at several geometries, rebuilds a final screen via a
minimal ANSI cursor emulator, and prints regression metrics (double corners,
nested frames, dock titles, clock).
"""
from __future__ import annotations

import argparse
import fcntl
import os
import pty
import re
import select
import struct
import subprocess
import sys
import tempfile
import termios
import time
import unicodedata
from pathlib import Path


def _display_width(ch: str) -> int:
    """Terminal cell width for one Python character (emoji / CJK = 2)."""
    if not ch or ord(ch) < 32:
        return 0
    return 2 if unicodedata.east_asian_width(ch) in ("F", "W") else 1

ROOT = Path(__file__).resolve().parents[1]  # apps/liora
MONOREPO = Path(__file__).resolve().parents[3]  # repo root


SIZES = ((80, 24), (100, 30), (120, 40), (140, 40), (160, 48), (220, 50))


def capture(cols: int, rows: int, wait: float = 12.0) -> bytes:
    home = tempfile.mkdtemp(prefix="liora-bento-")
    (Path(home) / "tui.toml").write_text('[appearance]\nprofile = "off"\nparticles = "off"\n')
    env = os.environ.copy()
    env.update(
        {
            "SUPERLIORA_HOME": home,
            "SUPERLIORA_NO_AUTO_UPDATE": "1",
            "SUPERLIORA_BENTO_VISUAL_SEED": "1",
            "QWEN_TOKEN_PLAN_API_KEY": "sk-sp-test-bento-visual",
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
            "COLUMNS": str(cols),
            "LINES": str(rows),
        }
    )
    env.pop("CI", None)
    env.pop("NO_COLOR", None)
    cmd = [
        "pnpm",
        "-C",
        "apps/liora",
        "exec",
        "tsx",
        "--tsconfig",
        "tsconfig.dev.json",
        "--import",
        "../../build/register-raw-text-loader.mjs",
        "src/main.ts",
    ]
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    err = open(f"/tmp/liora-bento-{cols}x{rows}-err.txt", "wb")
    proc = subprocess.Popen(
        cmd,
        cwd=str(MONOREPO),
        stdin=slave,
        stdout=slave,
        stderr=err,
        env=env,
        close_fds=True,
    )
    os.close(slave)
    buf = b""
    last = 0
    stable = time.time()
    deadline = time.time() + wait
    while time.time() < deadline and proc.poll() is None:
        ready, _, _ = select.select([master], [], [], 0.25)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            buf += chunk
            if len(buf) != last:
                last = len(buf)
                stable = time.time()
        if len(buf) > 6000 and time.time() - stable > 1.6:
            break
    try:
        proc.terminate()
        proc.wait(2)
    except Exception:
        proc.kill()
    os.close(master)
    err.close()
    return buf


class Screen:
    """Minimal CSI screen: CUP/CHA/HVP, ED/EL, CUD/CUU/CUF/CUB, SGR ignored."""

    def __init__(self, cols: int, rows: int) -> None:
        self.cols = cols
        self.rows = rows
        self.grid = [[" " for _ in range(cols)] for _ in range(rows)]
        self.r = 0
        self.c = 0

    def put(self, ch: str) -> None:
        if ch == "\n":
            self.r = min(self.rows - 1, self.r + 1)
            self.c = 0
            return
        if ch == "\r":
            self.c = 0
            return
        if ch == "\b":
            self.c = max(0, self.c - 1)
            return
        if ord(ch) < 32:
            return
        width = _display_width(ch)
        if width <= 0:
            return
        # Wide glyphs occupy two cells; the trailing cell is a blank placeholder
        # (matches how the renderer skips continuation cells on output). Keep a
        # visible space so text dumps stay column-aligned with the terminal.
        if 0 <= self.r < self.rows and 0 <= self.c < self.cols:
            self.grid[self.r][self.c] = ch
            if width == 2 and self.c + 1 < self.cols:
                self.grid[self.r][self.c + 1] = " "
        self.c += width
        if self.c >= self.cols:
            self.c = 0
            self.r = min(self.rows - 1, self.r + 1)

    def clear(self, mode: int) -> None:
        if mode == 2 or mode == 3:
            self.grid = [[" " for _ in range(self.cols)] for _ in range(self.rows)]
            self.r = self.c = 0
        elif mode == 0:
            for x in range(self.c, self.cols):
                self.grid[self.r][x] = " "
            for y in range(self.r + 1, self.rows):
                self.grid[y] = [" "] * self.cols
        elif mode == 1:
            for y in range(0, self.r):
                self.grid[y] = [" "] * self.cols
            for x in range(0, self.c + 1):
                self.grid[self.r][x] = " "

    def erase_line(self, mode: int) -> None:
        if mode == 2:
            self.grid[self.r] = [" "] * self.cols
        elif mode == 0:
            for x in range(self.c, self.cols):
                self.grid[self.r][x] = " "
        elif mode == 1:
            for x in range(0, self.c + 1):
                self.grid[self.r][x] = " "

    def render(self) -> str:
        return "\n".join("".join(row).rstrip() for row in self.grid)


_CSI_RE = re.compile(r"\x1b\[([0-9;?:>]*)([ -/]*)([@-~])")
_OSC_RE = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")
_APC_RE = re.compile(r"\x1b_G[^\x1b]*\x1b\\")
_OTHER_ESC = re.compile(r"\x1b.")


def screen_plain(raw: bytes, cols: int, rows: int) -> str:
    text = raw.decode("utf-8", "replace")
    text = _OSC_RE.sub("", text)
    text = _APC_RE.sub("", text)
    scr = Screen(cols, rows)
    i = 0
    while i < len(text):
        if text[i] == "\x1b" and i + 1 < len(text) and text[i + 1] == "[":
            m = _CSI_RE.match(text, i)
            if not m:
                i += 1
                continue
            params, _inter, final = m.group(1), m.group(2), m.group(3)
            nums = [int(p) for p in re.split(r"[;:]", params) if p.isdigit()] if params else []
            if final == "H" or final == "f":
                rr = (nums[0] - 1) if len(nums) >= 1 else 0
                cc = (nums[1] - 1) if len(nums) >= 2 else 0
                scr.r = max(0, min(rows - 1, rr))
                scr.c = max(0, min(cols - 1, cc))
            elif final == "G":
                cc = (nums[0] - 1) if nums else 0
                scr.c = max(0, min(cols - 1, cc))
            elif final == "A":
                scr.r = max(0, scr.r - (nums[0] if nums else 1))
            elif final == "B":
                scr.r = min(rows - 1, scr.r + (nums[0] if nums else 1))
            elif final == "C":
                scr.c = min(cols - 1, scr.c + (nums[0] if nums else 1))
            elif final == "D":
                scr.c = max(0, scr.c - (nums[0] if nums else 1))
            elif final == "J":
                scr.clear(nums[0] if nums else 0)
            elif final == "K":
                scr.erase_line(nums[0] if nums else 0)
            # SGR, DECSCUSR (q), and other CSI: ignore
            i = m.end()
            continue
        if text[i] == "\x1b":
            m = _OTHER_ESC.match(text, i)
            i = m.end() if m else i + 1
            continue
        scr.put(text[i])
        i += 1
    return scr.render()


def stream_plain(raw: bytes) -> str:
    text = raw.decode("utf-8", "replace")
    text = re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", text)
    text = re.sub(r"\x1b\][^\x07\x1b]*(\x07|\x1b\\)", "", text)
    text = re.sub(r"\x1b_G[^\x1b]*\x1b\\", "", text)
    return text


def metrics(p: str) -> dict:
    # Open-top chrome: a long dash run ending in ╮ with no ╭ on the same line
    # (titled frames like ╭── Files ──╮ have an interior ──╮ after the title —
    # those must not count as regressions).
    open_tops = 0
    for line in p.splitlines():
        if "╮" not in line or "╭" in line:
            continue
        if "Files" in line or "Git" in line or "Chat" in line or "Status" in line or "Context" in line:
            continue
        if re.search(r"─{8,}╮", line):
            open_tops += 1
    # Stacked dock tiles must share a seam (omitBottom) — Files ╰ then Git ╭
    # is the regression. Editor under Context is a different, intentional abut.
    abut_double = 0
    prev = ""
    for line in p.splitlines():
        if re.search(r"╰─+╯", prev) and re.search(r"╭[^╮]*(?:Git|Files)", line):
            abut_double += 1
        prev = line
    return {
        "double": p.count("╭╭") + p.count("╮╮"),
        "nested": p.count("│╭"),
        "pipe_adj": p.count("││"),
        "soft": bool(re.search(r"SuperLiora\s+(?:·\s*)+", p)),
        "files": "Files" in p,
        "git": "Git Diff" in p or "Δ Git" in p,
        "chat": "Quick Chat" in p or "💬Quick" in p or "💬 Qui" in p or "💬  Chat" in p or "💬 Chat" in p,
        "clock": bool(re.search(r"\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M", p)),
        "welcome_box": bool(re.search(r"╭.{0,8}Directory:", p)),
        "status_tile": "Status" in p,
        "context_rail": bool(re.search(r"╭[^╮]{0,24}Context", p)),
        "postage": sum(1 for t in ("Browser", "Terminal", "Artifact", "Activity") if t in p),
        "status_boxed": bool(re.search(r"╭[^╮]{0,40}Status", p)),
        "corner_tl": p.count("╭"),
        "open_tops": open_tops,
        "abut_double": abut_double,
        # Compact/medium heroes should stay on the wordmark, not Small figlet.
        "figlet_noise": bool(re.search(r"/ __\| \| \| \| _", p)),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", action="append", help="WxH, e.g. 220x50")
    args = parser.parse_args()
    sizes = SIZES
    if args.size:
        sizes = tuple(tuple(map(int, s.lower().split("x"))) for s in args.size)

    failed = 0
    for cols, rows in sizes:
        raw = capture(cols, rows)
        # Prefer reconstructed screen (real rows); fall back to stream strip.
        screen = screen_plain(raw, cols, rows)
        stream = stream_plain(raw)
        p = screen if ("SuperLiora" in screen or "Status" in screen) else stream
        out = Path(f"/tmp/liora-bento-visual-{cols}x{rows}.txt")
        out.write_text(p)
        Path(f"/tmp/liora-bento-visual-{cols}x{rows}.stream.txt").write_text(stream)
        m = metrics(p)
        # Screen emu can nibble truecolor/subparam SGR; trust stream for clock.
        ms = metrics(stream)
        if not m["clock"] and ms["clock"]:
            m["clock"] = True
        if not m["soft"] and ms["soft"]:
            m["soft"] = True
        ok = m["double"] == 0 and m["nested"] == 0 and not m["welcome_box"]
        if cols < 140:
            ok = ok and not m["figlet_noise"]
        if cols >= 120:
            ok = ok and m["soft"] and m["clock"]
        if cols >= 100 and rows >= 28:
            ok = ok and m["status_tile"] and not m["status_boxed"]
        if cols >= 140:
            ok = ok and m["files"] and m["git"] and m["chat"]
            if m["postage"] >= 3:
                ok = False
            # Files + Git + Chat (+ editor) should each contribute a ╭.
            if m["corner_tl"] < 4:
                ok = False
            if m["open_tops"] > 0:
                ok = False
            if m["abut_double"] > 0:
                ok = False
        # Ultrawide + seeded todos should open the Context rail tile.
        # Docked wide (≥140) uses a compact rail when the center is tight.
        if cols >= 140:
            ok = ok and m["context_rail"]
        # On a real screen grid, adjacent ││ should be rare (tree uses ┊).
        if cols >= 140 and "\n" in p and m["pipe_adj"] > 12:
            ok = False
        if not ok:
            failed += 1
        print(f"{cols}x{rows}: {m} -> {'OK' if ok else 'FAIL'} ({out})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
