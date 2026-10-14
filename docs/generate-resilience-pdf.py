#!/usr/bin/env python3
"""Generate the Data Resilience Plan PDF from markdown."""

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, HRFlowable
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER
import re
import sys

INPUT_MD = "/home/hatch/workspace/cockpit/docs/data-resilience-plan.md"
OUTPUT_PDF = "/home/hatch/workspace/cockpit/docs/data-resilience-plan.pdf"

# Colors - dark cockpit theme
DARK_BG = HexColor("#0a0a0f")
ACCENT = HexColor("#00d4ff")
TEXT = HexColor("#1a1a1a")
HEADING = HexColor("#003366")
GRAY = HexColor("#666666")

def parse_markdown(md_text):
    """Simple markdown to reportlab elements."""
    styles = getSampleStyleSheet()
    
    # Custom styles
    styles.add(ParagraphStyle(
        'CustomH1', parent=styles['Heading1'],
        fontSize=20, textColor=HEADING, spaceAfter=12,
        spaceBefore=24, fontName='Helvetica-Bold'
    ))
    styles.add(ParagraphStyle(
        'CustomH2', parent=styles['Heading2'],
        fontSize=16, textColor=HEADING, spaceAfter=10,
        spaceBefore=18, fontName='Helvetica-Bold'
    ))
    styles.add(ParagraphStyle(
        'CustomH3', parent=styles['Heading3'],
        fontSize=13, textColor=HEADING, spaceAfter=8,
        spaceBefore=14, fontName='Helvetica-Bold'
    ))
    styles.add(ParagraphStyle(
        'CustomBody', parent=styles['Normal'],
        fontSize=10, textColor=TEXT, spaceAfter=6,
        leading=14, fontName='Helvetica'
    ))
    styles.add(ParagraphStyle(
        'CustomBullet', parent=styles['Normal'],
        fontSize=10, textColor=TEXT, spaceAfter=4,
        leading=14, leftIndent=20, bulletIndent=10,
        fontName='Helvetica'
    ))
    styles.add(ParagraphStyle(
        'CustomCode', parent=styles['Code'],
        fontSize=9, textColor=HexColor("#333333"),
        backColor=HexColor("#f5f5f5"), spaceAfter=6,
        leftIndent=10, fontName='Courier'
    ))
    
    elements = []
    lines = md_text.split('\n')
    in_code_block = False
    code_lines = []
    in_table = False
    table_rows = []
    
    i = 0
    while i < len(lines):
        line = lines[i]
        
        # Code blocks
        if line.strip().startswith('```'):
            if in_code_block:
                # End code block
                code_text = '\n'.join(code_lines)
                # Escape for paragraph
                code_text = code_text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                elements.append(Paragraph(f'<font face="Courier" size="9">{code_text}</font>', styles['CustomCode']))
                elements.append(Spacer(1, 6))
                code_lines = []
                in_code_block = False
            else:
                in_code_block = True
            i += 1
            continue
        
        if in_code_block:
            code_lines.append(line)
            i += 1
            continue
        
        # Tables
        if '|' in line and line.strip().startswith('|'):
            if not in_table:
                in_table = True
                table_rows = []
            # Parse row
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            # Skip separator rows
            if all(set(c) <= set('-: ') for c in cells):
                i += 1
                continue
            table_rows.append(cells)
            i += 1
            continue
        elif in_table:
            # End of table
            if table_rows:
                # Create table
                col_widths = [2.5*inch] * len(table_rows[0]) if table_rows else []
                # Adjust for content
                t = Table(table_rows, colWidths=col_widths[:len(table_rows[0])] if table_rows else None)
                t.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), HexColor("#003366")),
                    ('TEXTCOLOR', (0, 0), (-1, 0), HexColor("#ffffff")),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, 0), (-1, -1), 9),
                    ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('GRID', (0, 0), (-1, -1), 0.5, HexColor("#cccccc")),
                    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f9f9f9")]),
                    ('TOPPADDING', (0, 0), (-1, -1), 4),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                    ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ]))
                elements.append(t)
                elements.append(Spacer(1, 12))
            in_table = False
            table_rows = []
            # Don't increment i, reprocess this line
            continue
        
        # Headings
        if line.startswith('# '):
            text = line[2:].strip()
            elements.append(Paragraph(text, styles['CustomH1']))
            elements.append(HRFlowable(width="100%", thickness=1, color=ACCENT, spaceAfter=12))
        elif line.startswith('## '):
            text = line[3:].strip()
            elements.append(Paragraph(text, styles['CustomH2']))
        elif line.startswith('### '):
            text = line[4:].strip()
            elements.append(Paragraph(text, styles['CustomH3']))
        elif line.startswith('- ') or line.startswith('* '):
            text = line[2:].strip()
            # Handle bold
            text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
            text = re.sub(r'`(.+?)`', r'<font face="Courier">\1</font>', text)
            elements.append(Paragraph(f'• {text}', styles['CustomBullet']))
        elif re.match(r'^\d+\.\s', line):
            text = re.sub(r'^\d+\.\s', '', line).strip()
            text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
            text = re.sub(r'`(.+?)`', r'<font face="Courier">\1</font>', text)
            elements.append(Paragraph(f'{text}', styles['CustomBullet']))
        elif line.strip() == '---':
            elements.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc"), spaceAfter=12, spaceBefore=12))
        elif line.strip() == '':
            elements.append(Spacer(1, 6))
        else:
            text = line.strip()
            if text:
                # Handle inline formatting
                text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
                text = re.sub(r'`(.+?)`', r'<font face="Courier">\1</font>', text)
                text = text.replace('&', '&amp;').replace('<b>', '||B||').replace('</b>', '||/B||')
                text = text.replace('<', '&lt;').replace('>', '&gt;')
                text = text.replace('||B||', '<b>').replace('||/B||', '</b>')
                # Restore code font tags
                text = re.sub(r'&lt;font face=&quot;Courier&quot;&gt;', '<font face="Courier">', text)
                text = re.sub(r'&lt;/font&gt;', '</font>', text)
                try:
                    elements.append(Paragraph(text, styles['CustomBody']))
                except:
                    elements.append(Paragraph("...", styles['CustomBody']))
        
        i += 1
    
    return elements

def main():
    with open(INPUT_MD, 'r') as f:
        md_text = f.read()
    
    doc = SimpleDocTemplate(
        OUTPUT_PDF,
        pagesize=LETTER,
        rightMargin=0.75*inch,
        leftMargin=0.75*inch,
        topMargin=0.75*inch,
        bottomMargin=0.75*inch,
        title="Cockpit Data Resilience Plan",
        author="Fireball",
    )
    
    elements = parse_markdown(md_text)
    doc.build(elements)
    print(f"PDF generated: {OUTPUT_PDF}")

if __name__ == "__main__":
    main()
