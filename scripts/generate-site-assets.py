#!/usr/bin/env python3
"""Generate SuperLiora apps/site PNG assets in a dark/cinematic/utility style."""

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "apps/site/public/assets"
OUT_DIR.mkdir(parents=True, exist_ok=True)

W, H = 1672, 941

# SuperLiora Neon Noir palette
BG = "#060A12"
BG1 = "#03060B"
BG2 = "#0D1422"
BG3 = "#162033"
LINE = "#334155"
LINE_S = "#475569"
TEXT = "#E6EDF3"
SOFT = "#9AA7B2"
MUTED = "#6F7A86"
CYAN = "#00D5FF"
TEAL = "#8BE9FD"
AMBER = "#F5C542"
VIOLET = "#B784FF"
EMERALD = "#36D399"
ROSE = "#FF5C7A"


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def rgb(h, alpha=1.0):
    r, g, b = hex_to_rgb(h)
    return (int(r * alpha), int(g * alpha), int(b * alpha), int(255 * alpha))


def rounded_rect(draw, xy, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def glow(draw, center, radius, color, steps=20, peak_alpha=9):
    base = rgb(color)
    for i in range(steps, 0, -1):
        alpha = int(peak_alpha * (i / steps) ** 2)
        fill = base[:3] + (alpha,)
        draw.ellipse(
            [
                center[0] - radius * i / steps,
                center[1] - radius * i / steps,
                center[0] + radius * i / steps,
                center[1] + radius * i / steps,
            ],
            fill=fill,
        )


def grid_bg(draw, w, h, step=48, color=LINE):
    fill = rgb(color, 0.10)
    for x in range(0, w, step):
        draw.line([(x, 0), (x, h)], fill=fill, width=1)
    for y in range(0, h, step):
        draw.line([(0, y), (w, y)], fill=fill, width=1)


def vignette(draw, w_max, h_max, strength=0.60):
    for i in range(220):
        t = i / 220
        a = int(255 * strength * (t * t))
        inset = t * min(w_max, h_max) * 0.52
        if inset > h_max / 2 - 2 or inset > w_max / 2 - 2:
            break
        draw.rectangle([inset, inset, w_max - inset, h_max - inset], outline=(0, 0, 0, a))


def load_fonts():
    # Try system monospaced fonts; fallbacks keep rendering reasonable.
    candidates_mono = [
        "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
        "/System/Library/Fonts/Monaco.dfont",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    ]
    candidates_sans = [
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/SFProDisplay-Regular.otf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    candidates_kr = [
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ]
    mono = None
    for c in candidates_mono:
        try:
            mono = ImageFont.truetype(c, 22)
            break
        except Exception:
            pass
    sans = None
    for c in candidates_sans:
        try:
            sans = ImageFont.truetype(c, 28)
            break
        except Exception:
            pass
    kr = None
    for c in candidates_kr:
        try:
            kr = ImageFont.truetype(c, 24)
            break
        except Exception:
            pass
    if mono is None:
        mono = ImageFont.load_default()
    if sans is None:
        sans = ImageFont.load_default()
    if kr is None:
        kr = sans
    return mono, sans, kr


def has_cjk(text):
    for ch in text:
        code = ord(ch)
        if 0xAC00 <= code <= 0xD7A3 or 0x3040 <= code <= 0x30FF or 0x4E00 <= code <= 0x9FFF:
            return True
    return False


def fit_font(text, base_font, size, max_width):
    font = base_font.font_variant(size=size)
    if not text:
        return font
    # Use a temporary image/draw just for measurement
    tmp = Image.new("RGBA", (1, 1))
    d = ImageDraw.Draw(tmp)
    while d.textlength(text, font=font) > max_width and size > 8:
        size -= 1
        font = base_font.font_variant(size=size)
    return font


MONO, SANS, KR = load_fonts()


def make_hero():
    img = Image.new("RGBA", (W, H), rgb(BG))
    draw = ImageDraw.Draw(img)
    grid_bg(draw, W, H)

    # Ambient glows
    glow(draw, (W * 0.2, H * 0.25), 380, CYAN, 26)
    glow(draw, (W * 0.8, H * 0.72), 340, VIOLET, 24)

    # Bento cells directly on the canvas
    pad = 56
    board_w = W - pad * 2
    board_h = H - pad * 2
    board_x = pad
    board_y = pad

    left_w = int(board_w * 0.55)
    right_w = board_w - left_w - 24
    top_h = int(board_h * 0.58)
    bottom_h = board_h - top_h - 24

    cells = [
        (board_x, board_y, board_x + left_w, board_y + top_h, "Harness"),
        (board_x + left_w + 24, board_y, board_x + board_w, board_y + top_h, "Terminal"),
        (board_x, board_y + top_h + 24, board_x + left_w, board_y + board_h, "Capabilities"),
        (board_x + left_w + 24, board_y + top_h + 24, board_x + board_w, board_y + board_h, "Status"),
    ]

    for i, (x1, y1, x2, y2, title) in enumerate(cells):
        rounded_rect(draw, (x1, y1, x2, y2), 28, rgb(BG2, 0.95), rgb(LINE_S, 0.9), 2)
        draw.text((x1 + 22, y1 + 18), title, font=MONO, fill=rgb(MUTED))

    # Left hero cell: harness diagram
    x1, y1, x2, y2 = cells[0][0], cells[0][1], cells[0][2], cells[0][3]
    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2 + 10
    r = min(x2 - x1, y2 - y1) // 3 - 10

    # Orbit rings
    for radius, alpha in [(r, 0.35), (r - 34, 0.20)]:
        draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], outline=rgb(CYAN, alpha), width=2)

    nodes = [
        (cx, cy - r + 10, CYAN, "UltraPlan"),
        (cx + int(r * 0.87), cy + int(r * 0.5), TEAL, "UltraWork"),
        (cx - int(r * 0.87), cy + int(r * 0.5), AMBER, "UltraSwarm"),
        (cx, cy + 26, VIOLET, "Context"),
    ]
    for nx, ny, col, label in nodes:
        draw.line([(cx, cy), (nx, ny)], fill=rgb(LINE, 0.7), width=2)
        glow(draw, (nx, ny), 38, col, 14)
        draw.ellipse([nx - 18, ny - 18, nx + 18, ny + 18], fill=rgb(BG3), outline=col, width=3)
        draw.text((nx, ny + 28), label, font=MONO, fill=rgb(SOFT), anchor="mm")

    # Core
    glow(draw, (cx, cy), 48, CYAN, 16)
    draw.ellipse([cx - 36, cy - 36, cx + 36, cy + 36], fill=rgb(BG3), outline=CYAN, width=4)
    draw.text((cx, cy), "SuperLiora", font=SANS, fill=rgb(TEXT), anchor="mm")

    # Right hero cell: terminal panel
    x1, y1, x2, y2 = cells[1][0], cells[1][1], cells[1][2], cells[1][3]
    # Title bar dots
    for idx, col in enumerate([ROSE, AMBER, EMERALD]):
        draw.ellipse([x1 + 22 + idx * 22, y1 + 48, x1 + 36 + idx * 22, y1 + 62], fill=col)
    tx, ty = x1 + 22, y1 + 92
    prefix = "$ "
    draw.text((tx, ty), prefix, font=MONO, fill=rgb(CYAN))
    tw = draw.textlength(prefix, font=MONO)
    cmd = 'liora -p "/ultrawork 분석 → 계획 → 구현 → 검증"'
    cmd_font = fit_font(cmd, KR, 22, x2 - x1 - 48 - tw)
    draw.text((tx + tw, ty), cmd, font=cmd_font, fill=rgb(TEXT))
    ty += 36
    # Progress blocks
    block_y = ty + 16
    block_w = (x2 - x1 - 60) // 5
    for i, col in enumerate([CYAN, TEAL, AMBER, VIOLET, EMERALD]):
        rounded_rect(
            draw,
            (x1 + 22 + i * (block_w + 8), block_y, x1 + 22 + i * (block_w + 8) + block_w, block_y + 10),
            5,
            rgb(col, 0.85),
        )

    # Bottom-left cell: feature chips
    x1, y1, x2, y2 = cells[2][0], cells[2][1], cells[2][2], cells[2][3]
    chip_labels = [
        ("Plan", CYAN),
        ("Research", VIOLET),
        ("Swarm", TEAL),
        ("Verify", EMERALD),
        ("Memory", AMBER),
        ("Browser", ROSE),
    ]
    cols = 2
    cw = (x2 - x1 - 60) // cols
    ch = 54
    for i, (label, col) in enumerate(chip_labels):
        cx = i % cols
        cy_ = i // cols
        rx = x1 + 18 + cx * (cw + 14)
        ry = y1 + 52 + cy_ * (ch + 14)
        rounded_rect(draw, (rx, ry, rx + cw, ry + ch), 14, rgb(BG1), rgb(col, 0.6), 2)
        draw.text((rx + cw // 2, ry + ch // 2), label, font=SANS, fill=rgb(col), anchor="mm")

    # Bottom-right cell: status metrics
    x1, y1, x2, y2 = cells[3][0], cells[3][1], cells[3][2], cells[3][3]
    metrics = [
        ("Providers", "6 routes", CYAN),
        ("Memory", "12 facts", AMBER),
        ("Agents", "128 max", TEAL),
    ]
    for i, (k, v, col) in enumerate(metrics):
        ty = y1 + 52 + i * 64
        draw.text((x1 + 22, ty), k, font=SANS, fill=rgb(SOFT))
        draw.text((x1 + 22, ty + 24), v, font=SANS, fill=rgb(col))
        # mini bar
        bw = x2 - x1 - 48
        rounded_rect(draw, (x1 + 22, ty + 54, x1 + 22 + bw, ty + 60), 3, rgb(LINE, 0.5))
        rounded_rect(draw, (x1 + 22, ty + 54, x1 + 22 + int(bw * (0.55 + i * 0.15)), ty + 60), 3, rgb(col, 0.85))

    vignette(draw, W, H)
    return img


def make_ultra_orchestration():
    img = Image.new("RGBA", (W, H), rgb(BG))
    draw = ImageDraw.Draw(img)
    grid_bg(draw, W, H, step=56)
    glow(draw, (W // 2, H // 2), 420, CYAN, 22)
    glow(draw, (W * 0.75, H * 0.3), 260, VIOLET, 18)

    # Title
    draw.text((W // 2, 72), "Ultra Workflow Orchestration", font=SANS, fill=rgb(TEXT), anchor="mm")
    draw.text((W // 2, 112), "Plan → Goal → Research → Swarm → Verify → Learn", font=MONO, fill=rgb(SOFT), anchor="mm")

    # Central flow pipeline
    nodes = [
        ("Plan", 0.18, CYAN),
        ("Goal", 0.34, VIOLET),
        ("Research", 0.50, TEAL),
        ("Swarm", 0.66, AMBER),
        ("Verify", 0.82, EMERALD),
    ]
    y = H // 2
    r = 44
    prev = None
    for label, x_ratio, col in nodes:
        x = int(W * x_ratio)
        if prev:
            draw.line([(prev[0] + r, prev[1]), (x - r, y)], fill=rgb(LINE, 0.6), width=3)
            # arrowhead
            ax, ay = x - r - 8, y
            draw.polygon([(ax, ay - 6), (ax + 10, ay), (ax, ay + 6)], fill=rgb(LINE, 0.8))
        glow(draw, (x, y), 60, col, 14)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=rgb(BG2), outline=col, width=4)
        draw.text((x, y), label, font=SANS, fill=rgb(TEXT), anchor="mm")
        prev = (x, y)

    # Learn node below
    lx, ly = int(W * 0.66), H // 2 + 160
    glow(draw, (lx, ly), 56, ROSE, 14)
    draw.ellipse([lx - 40, ly - 40, lx + 40, ly + 40], fill=rgb(BG2), outline=ROSE, width=4)
    draw.text((lx, ly), "Learn", font=SANS, fill=rgb(TEXT), anchor="mm")
    draw.line([(prev[0], prev[1] + r), (lx, ly - 40)], fill=rgb(LINE, 0.6), width=3)

    # Side specialist subagents (Swarm detail)
    swarm_x = int(W * 0.66)
    specialists = [
        ("Architect", -140, -110, CYAN),
        ("Security", -140, 0, ROSE),
        ("Testing", -140, 110, EMERALD),
        ("Docs", 140, -110, AMBER),
        ("UX", 140, 0, VIOLET),
        ("DevOps", 140, 110, TEAL),
    ]
    for name, dx, dy, col in specialists:
        sx, sy = swarm_x + dx, y + dy
        draw.line([(swarm_x, y), (sx, sy)], fill=rgb(LINE, 0.35), width=2)
        rounded_rect(draw, (sx - 58, sy - 22, sx + 58, sy + 22), 12, rgb(BG2), rgb(col, 0.5), 2)
        draw.text((sx, sy), name, font=MONO, fill=rgb(col), anchor="mm")

    vignette(draw, W, H)
    return img


def make_memory_wiki():
    img = Image.new("RGBA", (W, H), rgb(BG))
    draw = ImageDraw.Draw(img)
    grid_bg(draw, W, H, step=56)
    glow(draw, (W * 0.35, H * 0.4), 360, VIOLET, 20)
    glow(draw, (W * 0.7, H * 0.65), 320, CYAN, 18)

    draw.text((W // 2, 72), "Liora Recall + LLM Wiki", font=SANS, fill=rgb(TEXT), anchor="mm")

    # Vault shape: LLM Wiki top, three memory columns below
    vault_x = W // 2 - 280
    vault_y = H // 2 - 160
    vault_w = 560
    vault_h = 360
    rounded_rect(draw, (vault_x, vault_y, vault_x + vault_w, vault_y + vault_h), 32, rgb(BG2, 0.85), rgb(LINE, 0.6), 2)

    # Wiki header
    wiki_h = 72
    rounded_rect(draw, (vault_x + 24, vault_y + 24, vault_x + vault_w - 24, vault_y + 24 + wiki_h), 18, rgb(BG3), rgb(VIOLET, 0.5), 2)
    draw.text((vault_x + 56, vault_y + 24 + wiki_h // 2), "LLM Wiki", font=SANS, fill=rgb(VIOLET), anchor="lm")
    draw.text((vault_x + vault_w - 56, vault_y + 24 + wiki_h // 2), "reviewable docs", font=MONO, fill=rgb(MUTED), anchor="rm")

    cols = [
        ("Semantic", CYAN, "facts"),
        ("Procedural", EMERALD, "how-to"),
        ("Governance", AMBER, "rules"),
    ]
    col_w = (vault_w - 72) // 3
    for i, (title, col, sub) in enumerate(cols):
        cx = vault_x + 24 + i * (col_w + 12)
        cy = vault_y + 24 + wiki_h + 24
        rounded_rect(draw, (cx, cy, cx + col_w, vault_y + vault_h - 24), 18, rgb(BG1), rgb(col, 0.35), 2)
        draw.text((cx + col_w // 2, cy + 34), title, font=SANS, fill=rgb(col), anchor="mm")
        draw.text((cx + col_w // 2, cy + 66), sub, font=MONO, fill=rgb(MUTED), anchor="mm")
        # memory items
        for j in range(4):
            item_y = cy + 110 + j * 42
            rounded_rect(draw, (cx + 14, item_y, cx + col_w - 14, item_y + 28), 8, rgb(BG2), rgb(LINE, 0.25), 1)

    # Floating Recall badges
    badges = [
        ("Episodic", W * 0.82, H * 0.28, TEAL),
        ("Prospective", W * 0.18, H * 0.72, ROSE),
        ("Decisions", W * 0.84, H * 0.74, AMBER),
    ]
    for label, bx, by, col in badges:
        bx, by = int(bx), int(by)
        glow(draw, (bx, by), 50, col, 12)
        rounded_rect(draw, (bx - 70, by - 24, bx + 70, by + 24), 14, rgb(BG2), rgb(col, 0.55), 2)
        draw.text((bx, by), label, font=SANS, fill=rgb(col), anchor="mm")

    vignette(draw, W, H)
    return img


def make_agent_cockpit():
    img = Image.new("RGBA", (W, H), rgb(BG))
    draw = ImageDraw.Draw(img)
    grid_bg(draw, W, H, step=48)
    glow(draw, (W * 0.25, H * 0.8), 300, CYAN, 18)
    glow(draw, (W * 0.8, H * 0.25), 280, VIOLET, 16)

    # Terminal window frame
    margin = 70
    rounded_rect(draw, (margin, margin, W - margin, H - margin), 32, rgb(BG2, 0.92), rgb(LINE, 0.6), 2)

    # Title bar
    bar_h = 56
    rounded_rect(draw, (margin, margin, W - margin, margin + bar_h), 32, rgb(BG3), rgb(LINE, 0.5), 2)
    # clip bottom rounding
    rounded_rect(draw, (margin + 2, margin + bar_h - 16, W - margin - 2, margin + bar_h), 0, rgb(BG3))
    for idx, col in enumerate([ROSE, AMBER, EMERALD]):
        draw.ellipse([margin + 24 + idx * 22, margin + 18, margin + 38 + idx * 22, margin + 32], fill=col)
    draw.text((W // 2, margin + bar_h // 2), "SuperLiora TUI — Neon Noir", font=MONO, fill=rgb(SOFT), anchor="mm")

    # Sidebar
    sidebar_w = 220
    sidebar_x = margin + 24
    content_x = sidebar_x + sidebar_w + 24
    content_y = margin + bar_h + 24
    content_h = H - margin * 2 - bar_h - 24

    # Sidebar items
    sidebar_items = [
        ("Session", CYAN),
        ("Plan", SOFT),
        ("Memory", SOFT),
        ("Providers", SOFT),
        ("Themes", SOFT),
    ]
    for i, (item, col) in enumerate(sidebar_items):
        sy = content_y + i * 48
        if col == CYAN:
            rounded_rect(draw, (sidebar_x, sy, sidebar_x + sidebar_w, sy + 36), 10, rgb(CYAN, 0.12), rgb(CYAN, 0.4), 1)
        draw.text((sidebar_x + 16, sy + 18), item, font=SANS, fill=rgb(col), anchor="lm")

    # Main chat / command area
    rounded_rect(draw, (content_x, content_y, W - margin - 24, content_y + content_h), 24, rgb(BG1), rgb(LINE, 0.4), 1)

    # Chat lines
    messages = [
        ("user", "/ultrawork refactor auth module to use OAuth", TEXT),
        ("agent", "✓ UltraPlan interview started", CYAN),
        ("agent", "✓ Goal pinned: replace custom auth with OAuth2", TEAL),
        ("agent", "✓ Research: 3 providers compared", VIOLET),
        ("agent", "✓ Swarm engaged: Security + Testing", AMBER),
    ]
    ty = content_y + 28
    for who, text, col in messages:
        if who == "user":
            rounded_rect(draw, (content_x + 16, ty, content_x + 26, ty + 20), 4, rgb(SOFT))
        draw.text((content_x + 36, ty + 10), text, font=MONO, fill=rgb(col), anchor="lm")
        ty += 46

    # Status footer inside window
    footer_y = H - margin - 52
    rounded_rect(draw, (content_x, footer_y, W - margin - 24, H - margin - 24), 14, rgb(BG3), rgb(LINE, 0.3), 1)
    draw.text((content_x + 18, footer_y + 14), "mode: UltraWork  |  provider: fallback route  |  memory: synced", font=MONO, fill=rgb(SOFT), anchor="lm")

    # Input prompt
    prompt_y = footer_y - 44
    draw.text((content_x + 18, prompt_y + 12), "> ", font=MONO, fill=rgb(CYAN), anchor="lm")
    draw.text((content_x + 44, prompt_y + 12), "_", font=MONO, fill=rgb(CYAN), anchor="lm")

    vignette(draw, W, H)
    return img


def main():
    random.seed(42)
    assets = [
        ("hero-command-center.png", make_hero),
        ("ultra-orchestration.png", make_ultra_orchestration),
        ("memory-wiki-themes.png", make_memory_wiki),
        ("agent-cockpit.png", make_agent_cockpit),
    ]
    for filename, builder in assets:
        img = builder()
        img.convert("RGB").save(OUT_DIR / filename, "PNG", optimize=True)
        print(f"generated {OUT_DIR / filename} ({img.size[0]}x{img.size[1]})")


if __name__ == "__main__":
    main()
