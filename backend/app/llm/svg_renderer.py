from __future__ import annotations

import re
import unicodedata
from xml.sax.saxutils import escape

from app.llm.schemas import ArtifactLayoutSpec, ArtifactTextBlock


_HEX_COLOR = re.compile(r"#[0-9A-Fa-f]{6}")


def _xml_text(value: object) -> str:
    safe = "".join(
        character
        for character in str(value)
        if character in "\t\n\r"
        or 0x20 <= ord(character) <= 0xD7FF
        or 0xE000 <= ord(character) <= 0xFFFD
        or 0x10000 <= ord(character) <= 0x10FFFF
    )
    return escape(safe, {'"': "&quot;", "'": "&apos;"}).replace("=", "&#61;")


def _color(value: object) -> str:
    color = str(value)
    if _HEX_COLOR.fullmatch(color) is None:
        raise ValueError(f"Unsupported palette color: {color!r}")
    return color


def _relative_luminance(color: str) -> float:
    channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    linear = [
        value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
        for value in channels
    ]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def _contrast_text(background: str) -> str:
    luminance = _relative_luminance(background)
    black_ratio = (luminance + 0.05) / 0.05
    white_ratio = 1.05 / (luminance + 0.05)
    return "#000000" if black_ratio >= white_ratio else "#FFFFFF"


def _character_width(character: str, font_size: int) -> float:
    if unicodedata.combining(character):
        return 0
    if character.isspace():
        return font_size * 0.33
    if unicodedata.east_asian_width(character) in {"F", "W"}:
        return font_size
    if character in "MW@#%&":
        return font_size * 0.9
    if character.isupper():
        return font_size * 0.68
    if character in "ilI.,:;!'|`":
        return font_size * 0.3
    return font_size * 0.56


def _wrap_text(value: str, max_width: int, font_size: int) -> tuple[str, ...]:
    """Wrap text without dropping whitespace or truncating long tokens."""
    remaining = value
    lines = []
    while remaining:
        width = 0.0
        boundary = 0
        end = 0
        for index, character in enumerate(remaining):
            character_width = _character_width(character, font_size)
            if end and width + character_width > max_width:
                break
            width += character_width
            end = index + 1
            if character.isspace():
                boundary = end
        if end == len(remaining):
            lines.append(remaining)
            break
        if boundary:
            end = boundary
        lines.append(remaining[:end])
        remaining = remaining[end:]
    return tuple(lines)


def _text_rows(
    blocks: tuple[ArtifactTextBlock, ...], *, x: int, start_y: int,
    step: int, fill: str, max_width: int,
) -> str:
    rows = []
    current_y = start_y
    for block in blocks:
        font_size = 64 if block.role == "headline" else 34
        weight = 700 if block.role == "headline" else 400
        line_height = round(font_size * 1.25)
        lines = _wrap_text(block.text, max_width, font_size)
        tspans = "".join(
            f"<tspan x='{x}' y='{current_y + line_index * line_height}'>"
            f"{_xml_text(line)}</tspan>"
            for line_index, line in enumerate(lines)
        )
        rows.append(
            f"  <text fill='{fill}' xml:space='preserve' "
            f"font-family='system-ui, sans-serif' font-size='{font_size}' font-weight='{weight}'>"
            f"{tspans}</text>"
        )
        current_y += max(step, len(lines) * line_height)
    return "\n".join(rows)


class SvgRenderer:
    """Renders validated content through one of three fixed, inert SVG templates."""

    def render(self, brand_name: str, spec: ArtifactLayoutSpec) -> str:
        palette = tuple(_color(value) for value in spec.palette)
        primary, background = palette[:2]
        accent = palette[2] if len(palette) > 2 else primary
        blocks = tuple(spec.text_blocks)
        if spec.layout == "poster":
            return self._poster(brand_name, blocks, spec.cta, primary, background, accent)
        if spec.layout == "split":
            return self._split(brand_name, blocks, spec.cta, primary, background, accent)
        if spec.layout == "stacked":
            return self._stacked(brand_name, blocks, spec.cta, primary, background, accent)
        raise ValueError("Unsupported layout")

    @staticmethod
    def _poster(
        brand: str, blocks: tuple[ArtifactTextBlock, ...], cta: str,
        primary: str, background: str, accent: str,
    ) -> str:
        body_fill = _contrast_text(background)
        cta_fill = _contrast_text(accent)
        return f"""<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='1080' viewBox='0 0 1080 1080'>
  <rect x='0' y='0' width='1080' height='1080' rx='48' fill='{background}'/>
  <rect x='80' y='80' width='920' height='920' rx='40' fill='{background}' stroke='{accent}' stroke-width='6'/>
  <text x='120' y='190' fill='{body_fill}' font-family='system-ui, sans-serif' font-size='26' font-weight='600'>{_xml_text(brand)}</text>
{_text_rows(blocks, x=120, start_y=300, step=90, fill=body_fill, max_width=840)}
  <rect x='120' y='850' width='520' height='88' rx='22' fill='{accent}'/>
  <text x='160' y='905' fill='{cta_fill}' font-family='system-ui, sans-serif' font-size='26' font-weight='600'>{_xml_text(cta)}</text>
</svg>"""

    @staticmethod
    def _split(
        brand: str, blocks: tuple[ArtifactTextBlock, ...], cta: str,
        primary: str, background: str, accent: str,
    ) -> str:
        background_fill = _contrast_text(background)
        panel_fill = _contrast_text(primary)
        cta_fill = _contrast_text(accent)
        return f"""<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='1080' viewBox='0 0 1080 1080'>
  <rect x='0' y='0' width='1080' height='1080' fill='{background}'/>
  <rect x='540' y='0' width='540' height='1080' fill='{primary}'/>
  <text x='80' y='150' fill='{background_fill}' font-family='system-ui, sans-serif' font-size='26' font-weight='600'>{_xml_text(brand)}</text>
{_text_rows(blocks, x=590, start_y=300, step=100, fill=panel_fill, max_width=410)}
  <rect x='590' y='850' width='390' height='88' rx='22' fill='{accent}'/>
  <text x='630' y='905' fill='{cta_fill}' font-family='system-ui, sans-serif' font-size='26' font-weight='600'>{_xml_text(cta)}</text>
</svg>"""

    @staticmethod
    def _stacked(
        brand: str, blocks: tuple[ArtifactTextBlock, ...], cta: str,
        primary: str, background: str, accent: str,
    ) -> str:
        header_fill = _contrast_text(primary)
        body_fill = _contrast_text(background)
        cta_fill = _contrast_text(accent)
        return f"""<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='1080' viewBox='0 0 1080 1080'>
  <rect x='0' y='0' width='1080' height='1080' fill='{background}'/>
  <rect x='0' y='0' width='1080' height='240' fill='{primary}'/>
  <text x='80' y='145' fill='{header_fill}' font-family='system-ui, sans-serif' font-size='32' font-weight='700'>{_xml_text(brand)}</text>
{_text_rows(blocks, x=80, start_y=360, step=90, fill=body_fill, max_width=920)}
  <rect x='80' y='875' width='920' height='105' rx='18' fill='{accent}'/>
  <text x='130' y='940' fill='{cta_fill}' font-family='system-ui, sans-serif' font-size='28' font-weight='600'>{_xml_text(cta)}</text>
</svg>"""
