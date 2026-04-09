---
name: documents
description: "Create, read, edit, or manipulate Word (.docx) and PowerPoint (.pptx) documents. Use when the user mentions 'Word doc,' '.docx,' 'presentation,' 'slides,' 'deck,' '.pptx,' 'report,' 'memo,' 'letter,' 'pitch deck,' or any task involving office documents. Covers creation from scratch, editing existing files, XML manipulation, tracked changes, images, formatting, and design. Do NOT use for PDFs, spreadsheets, or Google Docs."
license: "Proprietary"
metadata:
  version: 2.0.0
---

# Office Documents

Router for Word and PowerPoint document skills.

## Mode Selection

| Task | File |
|------|------|
| Create a new Word document | [docx-creating.md](docx-creating.md) |
| Edit/read existing Word documents, XML manipulation | [docx-editing.md](docx-editing.md) |
| Quick reference, reading content, converting formats | [docx-reading.md](docx-reading.md) |
| PowerPoint — create, edit, read, design | [pptx.md](pptx.md) |

## Shared Patterns

- Both formats are ZIP archives of XML files
- Unpack/edit/repack workflow: `scripts/office/unpack.py` and `scripts/office/pack.py`
- PDF conversion via LibreOffice: `scripts/office/soffice.py`
- Image conversion: `pdftoppm` (Poppler)
- Word creation uses `docx` (npm, JS); PowerPoint creation uses `pptxgenjs` (npm, JS)
- Always validate output after creation or editing
