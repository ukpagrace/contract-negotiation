"""Converts an uploaded .docx into TipTap JSON for the contract editor.

Only emits node and mark types that exist in the web editor's schema.
Word tracked changes are accepted (insertions kept, deletions dropped) and
Word comments are dropped, per spec section 4.2.
"""

import io
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from docx import Document
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


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/convert":
            return self.respond(404, {"message": "Not found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length == 0 or length > MAX_BYTES:
            return self.respond(413, {"message": "File must be between 1 byte and 25 MB."})
        data = self.rfile.read(length)
        try:
            result = convert(data)
        except Exception:
            return self.respond(422, {"message": "That file couldn't be read as a Word (.docx) document."})
        self.respond(200, result)

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
