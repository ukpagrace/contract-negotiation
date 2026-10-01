"""Converts an uploaded .docx into TipTap JSON for the contract editor, and back.

Only emits node and mark types that exist in the web editor's schema.
Word tracked changes are accepted (insertions kept, deletions dropped) and
Word comments are dropped, per spec section 4.2.

/export turns a clean (no pending changes) TipTap document into .docx, or into
PDF through LibreOffice.
"""

import io
import json
import os
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.text.run import Run

MAX_BYTES = 25 * 1024 * 1024
ALIGN = {"center": "center", "right": "right", "end": "right", "both": "justify", "distribute": "justify"}


def run_marks(run: Run) -> list[dict]:
    marks = []
    if run.bold:
        marks.append({"type": "bold"})
    if run.italic:
        marks.append({"type": "italic"})
    if run.underline:
        marks.append({"type": "underline"})
    if run.font.strike:
        marks.append({"type": "strike"})
    if run.font.superscript:
        marks.append({"type": "superscript"})
    elif run.font.subscript:
        marks.append({"type": "subscript"})
    return marks


def runs_in(element, paragraph: Paragraph):
    # w:ins wraps accepted-on-import text; w:del is skipped so deletions vanish.
    for child in element.iterchildren():
        if child.tag == qn("w:r"):
            yield Run(child, paragraph)
        elif child.tag in (qn("w:ins"), qn("w:hyperlink"), qn("w:smartTag"), qn("w:fldSimple")):
            yield from runs_in(child, paragraph)


def inline_content(paragraph: Paragraph) -> list[dict]:
    nodes: list[dict] = []

    def add_text(text: str, marks: list[dict]):
        if not text:
            return
        last = nodes[-1] if nodes else None
        if last and last["type"] == "text" and last.get("marks", []) == marks:
            last["text"] += text
            return
        node = {"type": "text", "text": text}
        if marks:
            node["marks"] = marks
        nodes.append(node)

    for run in runs_in(paragraph._p, paragraph):
        marks = run_marks(run)
        for part in run._r.iterchildren():
            if part.tag == qn("w:t"):
                add_text(part.text or "", marks)
            elif part.tag == qn("w:tab"):
                add_text("\t", marks)
            elif part.tag in (qn("w:br"), qn("w:cr")):
                nodes.append({"type": "hardBreak"})
    return nodes


def paragraph_node(paragraph: Paragraph) -> dict:
    style = paragraph.style.name if paragraph.style is not None else ""
    node: dict = {"type": "paragraph"}
    if style == "Title":
        node = {"type": "heading", "attrs": {"level": 1}}
    elif style.startswith("Heading "):
        level = style.removeprefix("Heading ")
        if level.isdigit():
            node = {"type": "heading", "attrs": {"level": min(max(int(level), 1), 6)}}

    jc = paragraph._p.find(f"{qn('w:pPr')}/{qn('w:jc')}")
    align = ALIGN.get(jc.get(qn("w:val"))) if jc is not None else None
    if align:
        node.setdefault("attrs", {})["textAlign"] = align

    content = inline_content(paragraph)
    if content:
        node["content"] = content
    return node


def list_info(paragraph: Paragraph, numbering) -> tuple[str, int] | None:
    num_pr = paragraph._p.find(f"{qn('w:pPr')}/{qn('w:numPr')}")
    style = paragraph.style.name if paragraph.style is not None else ""
    if num_pr is None:
        # Built-in styles like "List Bullet 2" encode the nesting depth in the name.
        suffix = style.rsplit(" ", 1)[-1]
        level = int(suffix) - 1 if suffix.isdigit() else 0
        if style.startswith("List Bullet"):
            return "bulletList", level
        if style.startswith("List Number"):
            return "orderedList", level
        return None

    num_id = num_pr.find(qn("w:numId"))
    ilvl = num_pr.find(qn("w:ilvl"))
    level = int(ilvl.get(qn("w:val"))) if ilvl is not None else 0
    if num_id is None or num_id.get(qn("w:val")) == "0":
        return None

    kind = "orderedList"
    if numbering is not None:
        num = numbering.find(f"{qn('w:num')}[@{qn('w:numId')}='{num_id.get(qn('w:val'))}']")
        abstract_ref = num.find(qn("w:abstractNumId")) if num is not None else None
        if abstract_ref is not None:
            abstract = numbering.find(
                f"{qn('w:abstractNum')}[@{qn('w:abstractNumId')}='{abstract_ref.get(qn('w:val'))}']"
            )
            fmt = abstract.find(f"{qn('w:lvl')}[@{qn('w:ilvl')}='{level}']/{qn('w:numFmt')}") if abstract is not None else None
            if fmt is not None and fmt.get(qn("w:val")) == "bullet":
                kind = "bulletList"
    return kind, level


def table_node(table: Table) -> dict:
    rows = []
    for tr in table._tbl.tr_lst:
        cells = []
        for tc in tr.tc_lst:
            paragraphs = [paragraph_node(Paragraph(p, table)) for p in tc.iterchildren(qn("w:p"))]
            cell = {"type": "tableCell", "content": paragraphs or [{"type": "paragraph"}]}
            span = tc.grid_span
            if span > 1:
                cell["attrs"] = {"colspan": span}
            cells.append(cell)
        if cells:
            rows.append({"type": "tableRow", "content": cells})
    return {"type": "table", "content": rows}


def body_blocks(document) -> list[tuple[str, object]]:
    blocks = []

    def walk(element):
        for child in element.iterchildren():
            if child.tag == qn("w:p"):
                blocks.append(("p", Paragraph(child, document)))
            elif child.tag == qn("w:tbl"):
                blocks.append(("t", Table(child, document)))
            elif child.tag == qn("w:sdt"):
                content = child.find(qn("w:sdtContent"))
                if content is not None:
                    walk(content)

    walk(document.element.body)
    return blocks


def convert(data: bytes) -> dict:
    document = Document(io.BytesIO(data))
    numbering_part = next(
        (rel.target_part for rel in document.part.rels.values() if rel.reltype.endswith("/numbering")), None
    )
    numbering = numbering_part.element if numbering_part is not None else None

    content: list[dict] = []
    # Stack of (list node, level) so indented Word list items nest inside the previous item.
    stack: list[tuple[dict, int]] = []
    for kind, block in body_blocks(document):
        if kind == "t":
            stack = []
            content.append(table_node(block))
            continue

        info = list_info(block, numbering)
        if info is None:
            stack = []
            content.append(paragraph_node(block))
            continue

        list_type, level = info
        while stack and (stack[-1][1] > level or (stack[-1][1] == level and stack[-1][0]["type"] != list_type)):
            stack.pop()
        item = {"type": "listItem", "content": [paragraph_node(block)]}
        if stack and stack[-1][1] == level:
            stack[-1][0]["content"].append(item)
            continue
        new_list = {"type": list_type, "content": [item]}
        if stack:
            stack[-1][0]["content"][-1]["content"].append(new_list)
        else:
            content.append(new_list)
        stack.append((new_list, level))

    first_text = next(
        ("".join(n.get("text", "") for n in block.get("content", [])).strip() for block in content
         if block["type"] in ("heading", "paragraph") and block.get("content")),
        "",
    )
    title = (document.core_properties.title or "").strip() or first_text[:200]
    comments_dropped = any(rel.reltype.endswith("/comments") for rel in document.part.rels.values())

    return {
        "title": title,
        "content": {"type": "doc", "content": content or [{"type": "paragraph"}]},
        "commentsDropped": comments_dropped,
    }


EXPORT_ALIGN = {
    "center": WD_ALIGN_PARAGRAPH.CENTER,
    "right": WD_ALIGN_PARAGRAPH.RIGHT,
    "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}
TEXTBLOCKS = ("paragraph", "heading", "codeBlock")


# Signature spots only mark a position for e-signing, so they add nothing to an export.
def add_inline(paragraph, nodes: list[dict]):
    for node in nodes:
        if node["type"] == "hardBreak":
            paragraph.add_run().add_break()
        elif node["type"] == "text":
            run = paragraph.add_run(node.get("text", ""))
            marks = {mark["type"] for mark in node.get("marks", [])}
            run.bold = "bold" in marks or None
            run.italic = "italic" in marks or None
            run.underline = "underline" in marks or None
            run.font.strike = "strike" in marks or None
            run.font.superscript = "superscript" in marks or None
            run.font.subscript = "subscript" in marks or None


def add_textblock(container, node: dict, style: str | None = None):
    if node["type"] == "heading":
        style = style or f"Heading {min(node.get('attrs', {}).get('level', 1), 9)}"
    paragraph = container.add_paragraph(style=style)
    align = EXPORT_ALIGN.get((node.get("attrs") or {}).get("textAlign"))
    if align is not None:
        paragraph.alignment = align
    add_inline(paragraph, node.get("content", []))


def add_blocks(container, nodes: list[dict], depth: int = 0):
    for node in nodes:
        kind = node["type"]
        if kind in TEXTBLOCKS:
            add_textblock(container, node)
        elif kind in ("bulletList", "orderedList", "taskList"):
            # Word's built-in list styles go three levels deep.
            base = "List Number" if kind == "orderedList" else "List Bullet"
            style = base if depth == 0 else f"{base} {min(depth + 1, 3)}"
            for item in node.get("content", []):
                first, *rest = item.get("content", []) or [{"type": "paragraph"}]
                if first["type"] in TEXTBLOCKS:
                    add_textblock(container, first, style)
                else:
                    rest = [first, *rest]
                add_blocks(container, rest, depth + 1)
        elif kind == "table":
            add_table(container, node)
        elif kind == "blockquote":
            add_blocks(container, node.get("content", []), depth)
        elif kind == "horizontalRule":
            container.add_paragraph()


def add_table(container, node: dict):
    rows = node.get("content", [])
    width = max((sum((cell.get("attrs") or {}).get("colspan", 1) for cell in row.get("content", [])) for row in rows), default=0)
    if not rows or width == 0:
        return
    table = container.add_table(rows=len(rows), cols=width)
    table.style = "Table Grid"
    for r, row in enumerate(rows):
        c = 0
        for cell_node in row.get("content", []):
            span = (cell_node.get("attrs") or {}).get("colspan", 1)
            cell = table.cell(r, c)
            if span > 1:
                cell = cell.merge(table.cell(r, c + span - 1))
            placeholder = cell.paragraphs[0]._p
            add_blocks(cell, cell_node.get("content", []))
            # A cell must keep one paragraph; drop the empty starter one if content was added.
            if len(cell.paragraphs) > 1:
                cell._tc.remove(placeholder)
            c += span


def soffice_path() -> str | None:
    configured = os.environ.get("SOFFICE")
    if configured:
        return configured
    mac = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
    return shutil.which("soffice") or (mac if os.path.exists(mac) else None)


def export(content: dict, title: str, fmt: str) -> bytes:
    document = Document()
    document.core_properties.title = title
    add_blocks(document, content.get("content", []))
    buffer = io.BytesIO()
    document.save(buffer)
    if fmt == "docx":
        return buffer.getvalue()

    soffice = soffice_path()
    if soffice is None:
        raise FileNotFoundError("LibreOffice not found")
    with tempfile.TemporaryDirectory() as tmp:
        source = os.path.join(tmp, "contract.docx")
        with open(source, "wb") as f:
            f.write(buffer.getvalue())
        subprocess.run(
            [soffice, "--headless", "--convert-to", "pdf", "--outdir", tmp, source],
            check=True, capture_output=True, timeout=120,
        )
        with open(os.path.join(tmp, "contract.pdf"), "rb") as f:
            return f.read()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        url = urlparse(self.path)
        if url.path not in ("/convert", "/export"):
            return self.respond(404, {"message": "Not found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length == 0 or length > MAX_BYTES:
            return self.respond(413, {"message": "File must be between 1 byte and 25 MB."})
        data = self.rfile.read(length)
        if url.path == "/export":
            return self.export(data, parse_qs(url.query).get("format", ["docx"])[0])
        try:
            result = convert(data)
        except Exception:
            return self.respond(422, {"message": "That file couldn't be read as a Word (.docx) document."})
        self.respond(200, result)

    def export(self, data: bytes, fmt: str):
        if fmt not in ("docx", "pdf"):
            return self.respond(400, {"message": "Format must be docx or pdf."})
        body = json.loads(data)
        try:
            result = export(body["content"], body.get("title", ""), fmt)
        except FileNotFoundError:
            return self.respond(503, {"message": "PDF export needs LibreOffice installed on the server."})
        except subprocess.SubprocessError:
            return self.respond(502, {"message": "The PDF couldn't be made. Try again, or export as Word."})
        kind = "application/pdf" if fmt == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(result)))
        self.end_headers()
        self.wfile.write(result)

    def respond(self, status: int, body: dict):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8001"))
    print(f"converter listening on :{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
