#!/usr/bin/env python3
"""PTY harness: launch liora TUI, wait for screen, dump capture."""
import os, pty, select, subprocess, sys, time, tempfile

cols, rows = 160, 40
home = tempfile.mkdtemp(prefix="liora-bento-")
# Disable cinematic splash so the main bento chrome is captureable
with open(os.path.join(home, "tui.toml"), "w") as f:
    f.write('[appearance]\nprofile = "off"\nparticles = "off"\n')
root = "/Users/modumaru/Desktop/code/superliora-worktrees/tui-bento-grid"
out_path = "/tmp/liora-bento-pty.txt"
err_path = "/tmp/liora-bento-pty-err.txt"

env = os.environ.copy()
env.update({
    "SUPERLIORA_HOME": home,
    "SUPERLIORA_NO_AUTO_UPDATE": "1",
    "QWEN_TOKEN_PLAN_API_KEY": "sk-sp-test-bento-visual",
    "TERM": "xterm-256color",
    "COLORTERM": "truecolor",
    "COLUMNS": str(cols),
    "LINES": str(rows),
})
env.pop("CI", None)
env.pop("NO_COLOR", None)

cmd = [
    "pnpm", "-C", "apps/liora", "exec", "tsx",
    "--tsconfig", "tsconfig.dev.json",
    "--import", "../../build/register-raw-text-loader.mjs",
    "src/main.ts",
]

master, slave = pty.openpty()
os.set_winsize = getattr(os, "set_winsize", None)
try:
    import fcntl, struct, termios
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
except Exception:
    pass

err_f = open(err_path, "wb")
proc = subprocess.Popen(
    cmd,
    cwd=root,
    stdin=slave,
    stdout=slave,
    stderr=err_f,
    env=env,
    close_fds=True,
)
os.close(slave)

buf = b""
deadline = time.time() + 20
# Wait until splash settles into an interactive editor/prompt surface
settled_markers = (b"> ", b"/help", b"esc", b"interrupt", "\u256d".encode("utf-8"))

last_len = 0
stable_since = time.time()
while time.time() < deadline and proc.poll() is None:
    ready, _, _ = select.select([master], [], [], 0.3)
    if ready:
        try:
            chunk = os.read(master, 16384)
        except OSError:
            break
        if not chunk:
            break
        buf += chunk
        if len(buf) != last_len:
            last_len = len(buf)
            stable_since = time.time()
    # After ~2s of no growth and we have substantial output, treat as settled
    if len(buf) > 5000 and (time.time() - stable_since) > 2.0:
        break

# Try Escape / Enter to dismiss splash overlays if still stuck
for key in (b"\x1b", b"\r", b"\r"):
    try:
        os.write(master, key)
    except OSError:
        break
    time.sleep(0.4)
    while select.select([master], [], [], 0.2)[0]:
        try:
            buf += os.read(master, 16384)
        except OSError:
            break

# Strip most CSI for readability, keep box chars
text = buf.decode("utf-8", errors="replace")
# crude: drop ESC sequences
import re
plain = re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", text)
plain = re.sub(r"\x1b\][^\x07]*\x07", "", plain)
plain = plain.replace("\r", "")

with open(out_path, "w") as f:
    f.write(plain[-12000:])
with open(out_path + ".raw", "wb") as f:
    f.write(buf[-50000:])

print(f"bytes={len(buf)} exit={proc.poll()} home={home}")
print(f"wrote {out_path}")
print("--- tail ---")
print(plain[-3000:])

try:
    proc.terminate()
    proc.wait(timeout=2)
except Exception:
    proc.kill()
os.close(master)
err_f.close()
print("--- stderr head ---")
sys.stdout.write(open(err_path, errors="replace").read()[:2000])
