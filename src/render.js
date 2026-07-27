import {
  Document, Packer, Paragraph, TextRun, AlignmentType, TabStopType,
  BorderStyle, Footer, LevelFormat, PageOrientation,
} from 'docx';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// House style. These are fixed and deliberately not model-controlled.
const NAVY = '1F4E79';
const BLUE = '2E75B6';
const FONT = 'Calibri';
const TAB = 9360;

const strip = (s) => (s || '').replace(/[\u2014\u2013]/g, ', ');

const nameHeader = () =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [new TextRun({ text: 'MICHAEL T. JARVIS', font: FONT, size: 56, bold: true, color: NAVY })],
  });

const tagline = (t, opts = {}) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: opts.after ?? 120 },
    border: opts.rule
      ? { bottom: { style: BorderStyle.SINGLE, size: 8, color: BLUE, space: 6 } }
      : undefined,
    children: [new TextRun({ text: strip(t), font: FONT, size: 20, color: '404040' })],
  });

const section = (t) =>
  new Paragraph({
    spacing: { before: 180, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BLUE, space: 2 } },
    children: [new TextRun({ text: t, font: FONT, size: 24, bold: true, color: BLUE })],
  });

const body = (t, opts = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 60 },
    children: [new TextRun({ text: strip(t), font: FONT, size: opts.size ?? 20 })],
  });

const competency = (label, text) =>
  new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: strip(label) + ': ', font: FONT, size: 20, bold: true }),
      new TextRun({ text: strip(text), font: FONT, size: 20 }),
    ],
  });

const roleLine = (title, company, dates) =>
  new Paragraph({
    spacing: { before: 140, after: 20 },
    tabStops: [{ type: TabStopType.RIGHT, position: TAB }],
    children: [
      new TextRun({ text: strip(title) + ' | ', font: FONT, size: 21, bold: true }),
      new TextRun({ text: strip(company), font: FONT, size: 21, bold: true, italics: true }),
      new TextRun({ text: '\t' + strip(dates), font: FONT, size: 21, bold: true }),
    ],
  });

const contextLine = (t) =>
  new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: strip(t), font: FONT, size: 19, italics: true, color: '404040' })],
  });

const bullet = (t) =>
  new Paragraph({
    numbering: { reference: 'dot', level: 0 },
    spacing: { after: 50 },
    children: [new TextRun({ text: strip(t), font: FONT, size: 20 })],
  });

const footer = (extra) =>
  new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { top: { style: BorderStyle.SINGLE, size: 8, color: BLUE, space: 4 } },
        children: [
          new TextRun({
            text: `mtjarvis@att.net  \u00B7  (817) 366-6069  \u00B7  www.linkedin.com/in/mtjarvis${extra ? '  \u00B7  ' + extra : ''}`,
            font: FONT, size: 18, color: NAVY,
          }),
        ],
      }),
    ],
  });

const NUMBERING = {
  config: [{
    reference: 'dot',
    levels: [{
      level: 0,
      format: LevelFormat.BULLET,
      text: '\u2022',
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 288, hanging: 216 } } },
    }],
  }],
};

const PAGE = {
  size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
  margin: { top: 720, right: 1440, bottom: 720, left: 1440 },
};

// ---------------------------------------------------------------------------

export async function renderResume(plan, outPath, footerExtra) {
  const children = [nameHeader()];
  if (plan.tagline) children.push(tagline(plan.tagline));

  children.push(section('SUMMARY'), body(plan.summary, { after: 40 }));

  if (plan.competencies?.length) {
    children.push(section('CORE COMPETENCIES'));
    for (const c of plan.competencies) children.push(competency(c.label, c.text));
  }

  children.push(section('EXPERIENCE'));
  for (const r of plan.roles || []) {
    children.push(roleLine(r.title, r.company, r.dates));
    if (r.context) children.push(contextLine(r.context));
    for (const b of r.bullets || []) children.push(bullet(b));
  }

  if (plan.earlier?.length) {
    children.push(section('EARLIER EXPERIENCE'));
    for (const e of plan.earlier) children.push(bullet(e));
  }

  if (plan.certifications?.length) {
    children.push(section('CERTIFICATIONS AND EDUCATION'));
    for (const c of plan.certifications) children.push(body(c));
  }

  const doc = new Document({
    numbering: NUMBERING,
    sections: [{ properties: { page: PAGE }, footers: { default: footer(footerExtra) }, children }],
  });

  fs.writeFileSync(outPath, await Packer.toBuffer(doc));
  return outPath;
}

export async function renderCoverLetter(letter, outPath) {
  const children = [
    nameHeader(),
    tagline('mtjarvis@att.net  \u00B7  (817) 366-6069  \u00B7  www.linkedin.com/in/mtjarvis', { rule: true, after: 240 }),
    body(letter.salutation || 'Dear Hiring Team,', { size: 21, after: 160 }),
  ];
  for (const p of letter.paragraphs || []) children.push(body(p, { size: 21, after: 160 }));
  children.push(body('Michael T. Jarvis', { size: 21, after: 0 }));

  const doc = new Document({
    sections: [{ properties: { page: PAGE }, footers: { default: footer() }, children }],
  });

  fs.writeFileSync(outPath, await Packer.toBuffer(doc));
  return outPath;
}

// ---------------------------------------------------------------------------
// PDF conversion and the deterministic dash check on the rendered file.
// ---------------------------------------------------------------------------

export function toPDF(docxPath) {
  const dir = path.dirname(docxPath);
  execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', dir, docxPath], {
    stdio: 'ignore', timeout: 120000,
  });
  return docxPath.replace(/\.docx$/, '.pdf');
}

export function dashCheck(docxPath) {
  const out = execFileSync('python', ['-c',
    `import zipfile;d=zipfile.ZipFile(${JSON.stringify(docxPath)}).read('word/document.xml').decode();print(d.count(chr(8212))+d.count(chr(8211)))`,
  ]).toString().trim();
  return { clean: parseInt(out, 10) === 0, count: parseInt(out, 10) };
}

export function pageCount(pdfPath) {
  try {
    const out = execFileSync('pdfinfo', [pdfPath]).toString();
    return parseInt(out.match(/Pages:\s+(\d+)/)?.[1] ?? '0', 10);
  } catch { return null; }
}

