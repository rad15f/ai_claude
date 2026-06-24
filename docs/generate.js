const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  LevelFormat, PageNumber, Header, Footer,
} = require('docx')
const fs = require('fs')

const BLUE_DARK  = '1A3A5C'
const BLUE_MID   = '2E6DA4'
const BLUE_LIGHT = 'D5E8F0'
const GREY_LIGHT = 'F5F5F5'
const GREY_MID   = 'E0E0E0'
const GREEN_BG   = 'D4EDDA'
const YELLOW_BG  = 'FFF3CD'
const RED_BG     = 'F8D7DA'
const ORANGE_BG  = 'FFE5CC'
const WHITE      = 'FFFFFF'

const b1 = (c = 'CCCCCC') => ({ style: BorderStyle.SINGLE, size: 1, color: c })
const cb  = (c = 'CCCCCC') => ({ top: b1(c), bottom: b1(c), left: b1(c), right: b1(c) })
const nb  = () => { const n = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }; return { top: n, bottom: n, left: n, right: n } }

const gap = (before = 0, after = 120) =>
  new Paragraph({ children: [new TextRun('')], spacing: { before, after } })

const rule = () => new Paragraph({
  children: [new TextRun('')],
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BLUE_MID, space: 1 } },
  spacing: { before: 0, after: 240 },
})

const h1 = t => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  children: [new TextRun({ text: t, font: 'Arial', size: 36, bold: true, color: BLUE_DARK })],
  spacing: { before: 400, after: 160 },
})
const h2 = t => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  children: [new TextRun({ text: t, font: 'Arial', size: 28, bold: true, color: BLUE_MID })],
  spacing: { before: 280, after: 120 },
})
const h3 = t => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  children: [new TextRun({ text: t, font: 'Arial', size: 24, bold: true, color: BLUE_DARK })],
  spacing: { before: 240, after: 80 },
})

const p = (text, opts = {}) => new Paragraph({
  children: [new TextRun({ text, font: 'Arial', size: 22, ...opts })],
  spacing: { before: 60, after: 100 },
})

const pMix = (...runs) => new Paragraph({
  children: runs.map(r => typeof r === 'string'
    ? new TextRun({ text: r, font: 'Arial', size: 22 })
    : new TextRun({ font: 'Arial', size: 22, ...r })),
  spacing: { before: 60, after: 100 },
})

const bull = (text, opts = {}) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  children: [new TextRun({ text, font: 'Arial', size: 22, ...opts })],
  spacing: { before: 40, after: 60 },
})

const bullMix = (...runs) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  children: runs.map(r => typeof r === 'string'
    ? new TextRun({ text: r, font: 'Arial', size: 22 })
    : new TextRun({ font: 'Arial', size: 22, ...r })),
  spacing: { before: 40, after: 60 },
})

const code = text => new Paragraph({
  children: [new TextRun({ text, font: 'Courier New', size: 20, color: BLUE_DARK })],
  alignment: AlignmentType.CENTER,
  spacing: { before: 120, after: 140 },
  shading: { fill: GREY_LIGHT, type: ShadingType.CLEAR },
})

const callout = (text, fill = BLUE_LIGHT, border = BLUE_MID) =>
  new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: cb(border), width: { size: 9360, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 120, bottom: 120, left: 200, right: 200 },
      children: [new Paragraph({ children: [new TextRun({ text, font: 'Arial', size: 22, italics: true, color: BLUE_DARK })] })]
    })]})],
  })

const issueBox = (num, title, status, text) => {
  const statusFill = status === 'FIXED IN CODE' ? GREEN_BG : status === 'DOC FIX' ? YELLOW_BG : ORANGE_BG
  const statusColor = status === 'FIXED IN CODE' ? '155724' : status === 'DOC FIX' ? '856404' : '721C24'
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [1800, 7560],
    rows: [
      new TableRow({ children: [
        new TableCell({
          borders: cb(BLUE_DARK), shading: { fill: BLUE_DARK, type: ShadingType.CLEAR },
          width: { size: 1800, type: WidthType.DXA },
          margins: { top: 120, bottom: 120, left: 160, right: 160 },
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Issue ${num}`, font: 'Arial', size: 22, bold: true, color: WHITE })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: status, font: 'Arial', size: 18, color: statusFill, bold: true })] }),
          ]
        }),
        new TableCell({
          borders: cb('CCCCCC'), shading: { fill: WHITE, type: ShadingType.CLEAR },
          width: { size: 7560, type: WidthType.DXA },
          margins: { top: 120, bottom: 120, left: 200, right: 200 },
          children: [
            new Paragraph({ children: [new TextRun({ text: title, font: 'Arial', size: 22, bold: true, color: BLUE_DARK })] }),
            new Paragraph({ children: [new TextRun({ text, font: 'Arial', size: 20, color: '444444' })], spacing: { before: 60 } }),
          ]
        }),
      ]})
    ]
  })
}

// Weight bar
const weightBar = () => new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2808, 5148, 936, 468],
  rows: [new TableRow({ children: [
    new TableCell({ borders: cb(BLUE_DARK), shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, width: { size: 2808, type: WidthType.DXA }, margins: { top: 120, bottom: 120, left: 120, right: 120 },
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'ACCOUNT  30%', font: 'Arial', size: 22, bold: true, color: WHITE })] })] }),
    new TableCell({ borders: cb(BLUE_MID), shading: { fill: BLUE_MID, type: ShadingType.CLEAR }, width: { size: 5148, type: WidthType.DXA }, margins: { top: 120, bottom: 120, left: 120, right: 120 },
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'TEXT  55%', font: 'Arial', size: 22, bold: true, color: WHITE })] })] }),
    new TableCell({ borders: cb('4A90D9'), shading: { fill: '4A90D9', type: ShadingType.CLEAR }, width: { size: 936, type: WidthType.DXA }, margins: { top: 120, bottom: 120, left: 60, right: 60 },
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'CROSS 10%', font: 'Arial', size: 18, bold: true, color: WHITE })] })] }),
    new TableCell({ borders: cb('7FB3D9'), shading: { fill: '7FB3D9', type: ShadingType.CLEAR }, width: { size: 468, type: WidthType.DXA }, margins: { top: 120, bottom: 120, left: 40, right: 40 },
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'AI 5%', font: 'Arial', size: 18, bold: true, color: WHITE })] })] }),
  ]})]
})

// Two-row comparison table (Phase 2 vs Phase 3)
const phaseTable = () => new Table({
  width: { size: 9360, type: WidthType.DXA }, columnWidths: [1800, 1890, 1890, 1890, 1890],
  rows: [
    new TableRow({ children: ['Phase', 'Account', 'Text', 'Cross', 'AI'].map((t, i) =>
      new TableCell({ borders: cb(BLUE_DARK), shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, width: { size: [1800,1890,1890,1890,1890][i], type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, font: 'Arial', size: 20, bold: true, color: WHITE })] })] })
    )}),
    // Phase 2 short
    new TableRow({ children: [
      new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREY_LIGHT, type: ShadingType.CLEAR }, width: { size: 1800, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: 'Phase 2  Short', font: 'Arial', size: 20 })] })] }),
      ...['30%','55%','10%','5%'].map(t => new TableCell({ borders: cb('CCCCCC'), shading: { fill: YELLOW_BG, type: ShadingType.CLEAR }, width: { size: 1890, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, font: 'Arial', size: 20, bold: true })] })] })),
    ]}),
    // Phase 2 long
    new TableRow({ children: [
      new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREY_LIGHT, type: ShadingType.CLEAR }, width: { size: 1800, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: 'Phase 2  Long', font: 'Arial', size: 20 })] })] }),
      ...['25%','45%','10%','20%'].map(t => new TableCell({ borders: cb('CCCCCC'), shading: { fill: YELLOW_BG, type: ShadingType.CLEAR }, width: { size: 1890, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, font: 'Arial', size: 20, bold: true })] })] })),
    ]}),
    // Phase 3 short
    new TableRow({ children: [
      new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREY_LIGHT, type: ShadingType.CLEAR }, width: { size: 1800, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: 'Phase 3  Short', font: 'Arial', size: 20 })] })] }),
      ...['40%','35%','10%','15%'].map(t => new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREEN_BG, type: ShadingType.CLEAR }, width: { size: 1890, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, font: 'Arial', size: 20, bold: true })] })] })),
    ]}),
    // Phase 3 long
    new TableRow({ children: [
      new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREY_LIGHT, type: ShadingType.CLEAR }, width: { size: 1800, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: 'Phase 3  Long', font: 'Arial', size: 20 })] })] }),
      ...['35%','25%','15%','25%'].map(t => new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREEN_BG, type: ShadingType.CLEAR }, width: { size: 1890, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, font: 'Arial', size: 20, bold: true })] })] })),
    ]}),
  ]
})

// Signal table
const sigHeader = () => new TableRow({ children: ['Signal', 'Weight', 'Notes'].map((t, i) =>
  new TableCell({ borders: cb(BLUE_DARK), shading: { fill: BLUE_DARK, type: ShadingType.CLEAR },
    width: { size: [4000,1200,4160][i], type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: t, font: 'Arial', size: 20, bold: true, color: WHITE })] })] })
) })
const sigRow = (signal, weight, note, fill = WHITE) => new TableRow({ children: [
  new TableCell({ borders: cb('CCCCCC'), shading: { fill, type: ShadingType.CLEAR }, width: { size: 4000, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: signal, font: 'Arial', size: 20, bold: true })] })] }),
  new TableCell({ borders: cb('CCCCCC'), shading: { fill, type: ShadingType.CLEAR }, width: { size: 1200, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: weight, font: 'Arial', size: 20, bold: true, color: BLUE_MID })] })] }),
  new TableCell({ borders: cb('CCCCCC'), shading: { fill, type: ShadingType.CLEAR }, width: { size: 4160, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: note, font: 'Arial', size: 20, italics: true, color: '555555' })] })] }),
]})

// Example table
const exHeader = () => new TableRow({ children: ['Component','Signal Score','Weight','Contribution'].map((t, i) =>
  new TableCell({ borders: cb(BLUE_DARK), shading: { fill: BLUE_DARK, type: ShadingType.CLEAR },
    width: { size: [2800,1800,1800,2960][i], type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, font: 'Arial', size: 20, bold: true, color: WHITE })] })] })
) })
const exRow = (label, score, weight, contrib, fill = WHITE) => new TableRow({ children: [
  new TableCell({ borders: cb('CCCCCC'), shading: { fill, type: ShadingType.CLEAR }, width: { size: 2800, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: label, font: 'Arial', size: 20, bold: true })] })] }),
  new TableCell({ borders: cb('CCCCCC'), shading: { fill, type: ShadingType.CLEAR }, width: { size: 1800, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: score, font: 'Arial', size: 20 })] })] }),
  new TableCell({ borders: cb('CCCCCC'), shading: { fill, type: ShadingType.CLEAR }, width: { size: 1800, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: weight, font: 'Arial', size: 20 })] })] }),
  new TableCell({ borders: cb('CCCCCC'), shading: { fill, type: ShadingType.CLEAR }, width: { size: 2960, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: contrib, font: 'Arial', size: 20, bold: true, color: BLUE_MID })] })] }),
]})
const exTotal = (total, label, fill) => new TableRow({ children: [
  new TableCell({ borders: cb(BLUE_DARK), shading: { fill, type: ShadingType.CLEAR }, width: { size: 6400, type: WidthType.DXA }, columnSpan: 3,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'FINAL SCORE', font: 'Arial', size: 22, bold: true })] })] }),
  new TableCell({ borders: cb(BLUE_DARK), shading: { fill, type: ShadingType.CLEAR }, width: { size: 2960, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${total}  →  ${label}`, font: 'Arial', size: 22, bold: true })] })] }),
]})

// ─── Document ────────────────────────────────────────────────────────────────
const doc = new Document({
  numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•',
    alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial', color: BLUE_DARK }, paragraph: { spacing: { before: 400, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: BLUE_MID }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: BLUE_DARK }, paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 2 } },
    ]
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({
      children: [
        new TextRun({ text: 'YouTube Bot Detector  |  Scoring Model — v2.1 (Revised)', font: 'Arial', size: 18, color: '888888' }),
        new TextRun({ text: '\t', font: 'Arial', size: 18 }),
        new TextRun({ text: 'Incorporates peer review feedback', font: 'Arial', size: 18, color: '888888', italics: true }),
      ],
      tabStops: [{ type: 'right', position: 9360 }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GREY_MID, space: 1 } },
    })]}) },
    footers: { default: new Footer({ children: [new Paragraph({
      children: [
        new TextRun({ text: 'YouTube Bot Detector — Scoring Weights Rationale', font: 'Arial', size: 18, color: '888888' }),
        new TextRun({ text: '\t', font: 'Arial', size: 18 }),
        new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: 'Arial', size: 18, color: '888888' }),
      ],
      tabStops: [{ type: 'right', position: 9360 }],
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: GREY_MID, space: 1 } },
    })]}) },
    children: [

      // ── COVER ──────────────────────────────────────────────────────────────
      new Paragraph({ children: [new TextRun({ text: 'YouTube Bot Detector', font: 'Arial', size: 56, bold: true, color: BLUE_DARK })], spacing: { before: 480, after: 80 } }),
      new Paragraph({ children: [new TextRun({ text: 'Scoring Model Design & Weight Rationale', font: 'Arial', size: 32, color: BLUE_MID })], spacing: { before: 0, after: 80 } }),
      new Paragraph({ children: [new TextRun({ text: 'Version 2.1  |  Revised after peer review', font: 'Arial', size: 22, color: '888888', italics: true })], spacing: { before: 0, after: 600 } }),
      rule(),

      // ── PEER REVIEW RESPONSES ──────────────────────────────────────────────
      h1('0.  Peer Review Response Summary'),
      p('Four issues were raised in review. This section summarises the response to each before the full technical explanation.'),
      gap(120),

      issueBox(1,
        'Sub-signal aggregation was undefined',
        'FIXED IN CODE',
        'Both account.ts and text.ts now use probabilistic OR: score = 1 − ∏(1 − wᵢ). This replaces the previous additive+clamp approach, prevents double-penalisation, and naturally stays ≤ 1.0. See Section 2 for a full explanation of the formula.'
      ),
      gap(120),
      issueBox(2,
        'Account age tiers appeared to fire cumulatively',
        'DOC FIX',
        'The age tiers were already mutually exclusive (else-if) in the code — this was a documentation gap, not a bug. A 5-day-old account fires only the <7-day tier (+0.40), not all three tiers. Section 4 now states this explicitly.'
      ),
      gap(120),
      issueBox(3,
        'AI weight discrepancy — Phase 3 formula not specified',
        'FIXED IN CODE',
        'scorer.ts now documents both the current Phase 2 formula (AI = 5% stub) and the locked Phase 3 formula (AI = 15% short / 25% long). See Section 6 for both full weight tables.'
      ),
      gap(120),
      issueBox(4,
        'Thresholds have no empirical basis',
        'ACKNOWLEDGED',
        'Valid. The 30% and 55% thresholds are provisional, chosen by reasoning rather than labelled data. They are user-adjustable via the popup slider. A labelled test set of ≥100 comments is needed to optimise them empirically. See Section 7.'
      ),
      gap(200),

      // ── 1. FORMULA ─────────────────────────────────────────────────────────
      h1('1.  The Scoring Formula'),
      p('Every comment is scored on a 0–100% scale by combining four independent signal categories:'),
      gap(100),
      weightBar(),
      gap(140),
      code('final  =  account × 0.30  +  text × 0.55  +  cross × 0.10  +  AI × 0.05'),
      p('Each category independently scores 0–1 using probabilistic OR aggregation (see Section 2). The category scores are then combined with fixed weights.'),
      gap(80),

      // Classification table
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [3120, 3120, 3120],
        rows: [
          new TableRow({ children: ['Score range', 'Classification', 'Badge colour'].map((t, i) =>
            new TableCell({ borders: cb(BLUE_DARK), shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, width: { size: 3120, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, font: 'Arial', size: 22, bold: true, color: WHITE })] })] })) }),
          new TableRow({ children: [
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREEN_BG, type: ShadingType.CLEAR }, width: { size: 3120, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '0% – 29%', font: 'Arial', size: 22 })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREEN_BG, type: ShadingType.CLEAR }, width: { size: 3120, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Human', font: 'Arial', size: 22, bold: true, color: '155724' })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREEN_BG, type: ShadingType.CLEAR }, width: { size: 3120, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Green', font: 'Arial', size: 22, color: '155724' })] })] }),
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: YELLOW_BG, type: ShadingType.CLEAR }, width: { size: 3120, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '30% – 54%', font: 'Arial', size: 22 })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: YELLOW_BG, type: ShadingType.CLEAR }, width: { size: 3120, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Suspicious', font: 'Arial', size: 22, bold: true, color: '856404' })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: YELLOW_BG, type: ShadingType.CLEAR }, width: { size: 3120, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Yellow', font: 'Arial', size: 22, color: '856404' })] })] }),
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: RED_BG, type: ShadingType.CLEAR }, width: { size: 3120, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '55% +', font: 'Arial', size: 22 })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: RED_BG, type: ShadingType.CLEAR }, width: { size: 3120, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Likely Bot', font: 'Arial', size: 22, bold: true, color: '721C24' })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: RED_BG, type: ShadingType.CLEAR }, width: { size: 3120, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Red', font: 'Arial', size: 22, color: '721C24' })] })] }),
          ]}),
        ]
      }),
      gap(200),

      // ── 2. AGGREGATION ─────────────────────────────────────────────────────
      h1('2.  Signal Aggregation — Probabilistic OR  (Issue 1 Fix)'),
      p('Within each category, multiple signals can fire simultaneously. The previous approach was additive with a clamp to 1.0:'),
      code('score = min(1,  w₁ + w₂ + w₃ + ...)   ← old, removed'),
      p('This has a flaw: once the running total exceeds 1.0, every additional signal has zero effect. A comment that scores 1.05 additively and one that scores 1.40 are indistinguishable.'),
      gap(80),
      p('The replacement is Probabilistic OR:'),
      code('score  =  1  −  ∏(1 − wᵢ)   for all fired signals i'),
      p('This is the standard formula for combining independent probabilities. Each signal contributes, but with diminishing returns — adding a weak signal to a strong one only nudges the result slightly, rather than potentially pushing it past the ceiling.'),
      gap(80),

      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [4680, 4680],
        rows: [
          new TableRow({ children: ['Additive + clamp (old)', 'Probabilistic OR (new)'].map(t =>
            new TableCell({ borders: cb(BLUE_DARK), shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, width: { size: 4680, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, font: 'Arial', size: 20, bold: true, color: WHITE })] })] })) }),
          new TableRow({ children: [
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: RED_BG, type: ShadingType.CLEAR }, width: { size: 4680, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 },
              children: [
                new Paragraph({ children: [new TextRun({ text: 'URL(0.45) + keyword(0.30) + hashtag(0.20)', font: 'Courier New', size: 18 })] }),
                new Paragraph({ children: [new TextRun({ text: '= 0.95  (OK here, but at 1.10 further signals are wasted)', font: 'Arial', size: 20, italics: true })] }),
              ] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREEN_BG, type: ShadingType.CLEAR }, width: { size: 4680, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 },
              children: [
                new Paragraph({ children: [new TextRun({ text: '1 − (0.55)(0.70)(0.80)  =  0.692', font: 'Courier New', size: 18 })] }),
                new Paragraph({ children: [new TextRun({ text: 'Every signal always contributes; none are wasted', font: 'Arial', size: 20, italics: true })] }),
              ] }),
          ]}),
        ]
      }),
      gap(160),
      callout('Concrete example: a new empty account (age, 0 subs, 0 videos, no description, no banner) — the probabilistic OR score is 0.61, vs 0.81 additive. The probabilistic result is more honest: six imperfect signals together are not certainty.'),
      gap(200),

      // ── 3. DESIGN PHILOSOPHY ───────────────────────────────────────────────
      h1('3.  Design Philosophy'),
      p('The weights reflect one core rule: no single signal can convict a comment on its own. Every threshold requires at least two independent signals stacking. This is the most important property the scorer can have — it is what prevents the extension from turning into a tool that harasses innocent new viewers.'),
      gap(80),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [2200, 3580, 3580],
        rows: [
          new TableRow({ children: ['Bot Type', 'Behaviour', 'Primary evidence'].map((t, i) =>
            new TableCell({ borders: cb(BLUE_DARK), shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, width: { size: [2200,3580,3580][i], type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 },
              children: [new Paragraph({ children: [new TextRun({ text: t, font: 'Arial', size: 20, bold: true, color: WHITE })] })] })) }),
          new TableRow({ children: [
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: YELLOW_BG, type: ShadingType.CLEAR }, width: { size: 2200, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'Promotional Spam', font: 'Arial', size: 20, bold: true, color: '856404' })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: WHITE, type: ShadingType.CLEAR }, width: { size: 3580, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'Posts links, crypto promos, "check my channel"', font: 'Arial', size: 20 })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: WHITE, type: ShadingType.CLEAR }, width: { size: 3580, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'Comment text itself', font: 'Arial', size: 20, bold: true, color: BLUE_MID })] })] }),
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: RED_BG, type: ShadingType.CLEAR }, width: { size: 2200, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'Engagement Farm', font: 'Arial', size: 20, bold: true, color: '721C24' })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: WHITE, type: ShadingType.CLEAR }, width: { size: 3580, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'New empty accounts posting generic praise', font: 'Arial', size: 20 })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: WHITE, type: ShadingType.CLEAR }, width: { size: 3580, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'Channel profile (age, subs, videos)', font: 'Arial', size: 20, bold: true, color: BLUE_MID })] })] }),
          ]}),
        ]
      }),
      gap(200),

      // ── 4. ACCOUNT 30% ─────────────────────────────────────────────────────
      h1('4.  Account  —  30%'),
      h3('Why 30%, not higher?'),
      p('Most real YouTube viewers look like bots on account signals alone. A typical passive viewer has an old account, 0 subscribers, 0 videos, no banner, no description. Weighting account signals above 35% flags enormous numbers of legitimate users.'),
      h3('Why 30%, not lower?'),
      p('Account signals are the only mechanism that can catch engagement farm bots posting generic innocent text. Without account weight, a brand-new empty account saying "great video!" scores 0%.'),
      gap(80),
      callout('Issue 2 clarification: age tiers are mutually exclusive (else-if in code). A 5-day account fires ONLY the <7-day tier (+0.40 weight). It does NOT also fire the <30-day or <6-month tiers. The code uses: if <7d ... else if <30d ... else if <6mo ...'),
      gap(120),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [4000, 1200, 4160],
        rows: [
          sigHeader(),
          sigRow('Account < 7 days old  (else-if tier 1)', '0.40', 'Fires ONLY if age < 7 days', GREY_LIGHT),
          sigRow('Account < 30 days old  (else-if tier 2)', '0.28', 'Fires ONLY if 7 ≤ age < 30 days'),
          sigRow('Account < 6 months  (else-if tier 3)', '0.14', 'Fires ONLY if 30 ≤ age < 180 days', GREY_LIGHT),
          sigRow('0 subscribers', '0.14', ''),
          sigRow('0 videos uploaded', '0.12', '', GREY_LIGHT),
          sigRow('No channel description', '0.07', ''),
          sigRow('No banner image', '0.05', '', GREY_LIGHT),
          sigRow('Hidden sub count (small channel)', '0.05', ''),
          sigRow('No country set', '0.03', '', GREY_LIGHT),
          sigRow('Abnormal view/sub ratio (>500×)', '0.06', ''),
          sigRow('Auto-generated handle (@user-xxxxx)', '0.10', 'YouTube auto-assigns to new accounts', GREY_LIGHT),
        ]
      }),
      gap(120),
      p('Example — brand-new empty account (age 3d, 0 subs, 0 videos, no description, no banner, no country):', { italics: true, color: '666666' }),
      code('Fired weights: [0.40, 0.14, 0.12, 0.07, 0.05, 0.03]'),
      code('Score = 1 − (0.60)(0.86)(0.88)(0.93)(0.95)(0.97)  =  0.611'),
      code('Contribution to final: 0.611 × 30%  =  18.3%'),
      gap(200),

      // ── 5. TEXT 55% ────────────────────────────────────────────────────────
      h1('5.  Text  —  55%'),
      h3('Why 55%?'),
      bullMix({ text: 'Direct evidence.', bold: true }, '  The comment IS the spam. When a bot posts "IntoTheCryptoVerse•Com #DYOR #NFA", no inference is required — the text convicts itself.'),
      bullMix({ text: 'Always runs.', bold: true }, '  Text analysis fires on every comment instantly, with no API key or external dependency. Account signals require a configured YouTube API key.'),
      bullMix({ text: 'Scales against evolved bots.', bold: true }, '  Bots that buy aged accounts to bypass account signals still have to post something, and what they post is the giveaway.'),
      h3('Why not 70%?'),
      p('A single keyword match contributes only 0.30 × 55% = 16.5% — safely in the green zone. It takes 2–3 signals stacking to reach suspicious territory, which mirrors how real spam actually behaves.'),
      gap(80),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [4000, 1200, 4160],
        rows: [
          sigHeader(),
          sigRow('External URL (non-YouTube)', '0.55', 'Linking off-platform — strongest single signal', GREY_LIGHT),
          sigRow('Disguised domain  (else-if URL)', '0.45', '"site•com", "site[dot]com", "site (dot) com"'),
          sigRow('Promotional keywords', '0.30', '"crypto", "dm me", "make money", "onlyfans"...', GREY_LIGHT),
          sigRow('Income template', '0.30', '"I make $500/day from home" fill-in patterns'),
          sigRow('Hashtag spam (3+ hashtags)', '0.20', 'Promotional hashtag clusters', GREY_LIGHT),
          sigRow('Very short / emoji-only (<4 words)', '0.10', 'Engagement farm filler'),
          sigRow('Excessive caps (>60% uppercase)', '0.10', '', GREY_LIGHT),
          sigRow('Zero-width / invisible characters', '0.10', 'Injected to bypass text filters'),
          sigRow('Repeated characters (heeeello)', '0.08', '', GREY_LIGHT),
          sigRow('High non-ASCII ratio (>35%)', '0.08', 'Foreign character spam'),
        ]
      }),
      gap(120),
      p('@ITC_Admin example — disguised URL + hashtag spam + promo keyword:', { italics: true, color: '666666' }),
      code('Fired weights: [0.45, 0.20, 0.30]'),
      code('Score = 1 − (0.55)(0.80)(0.70)  =  0.692'),
      code('Contribution to final: 0.692 × 55%  =  38.1%'),
      gap(200),

      // ── 6. CROSS 10% ───────────────────────────────────────────────────────
      h1('6.  Cross-Comment  —  10%'),
      p('Compares the current comment against all comments seen this session. Only 10% weight due to three structural constraints:'),
      bullMix({ text: 'Cold start.', bold: true }, '  The first bot in a coordinated campaign scores 0 here — only duplicates 2, 3, 4... get caught.'),
      bullMix({ text: 'Session-only.', bold: true }, '  Cache resets on tab close. Bots that posted on different days look fresh each session.'),
      bullMix({ text: 'Popular phrase collision.', bold: true }, '  Short phrases like "W" or "first!" cause false near-duplicates among real users.'),
      gap(80),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [4000, 1200, 4160],
        rows: [
          sigHeader(),
          sigRow('Exact duplicate (different author)', 'Flat 0.50', 'Clearest sign of a coordinated campaign', GREY_LIGHT),
          sigRow('Self-repeating author (NEW)', 'Flat 0.45', 'Same author posts near-identical text repeatedly'),
          sigRow('Near-duplicate (different author)', 'Flat 0.30', 'Levenshtein distance < 10 edits', GREY_LIGHT),
          sigRow('Username cluster pattern', 'Flat 0.25', '2+ @FirstnameSurname#### handles seen'),
        ]
      }),
      p('Cross signals use Math.max(), not addition. Only the highest cross-comment score applies.', { italics: true, color: '666666' }),
      gap(200),

      // ── 7. AI 5% / PHASE 3 ─────────────────────────────────────────────────
      h1('7.  AI Classifier  —  Phase 2 vs Phase 3  (Issue 3 Fix)'),
      p('The AI weight is 5% in Phase 2 because the classifier is not yet implemented (always returns 0). The 5% placeholder ensures a zero return costs at most 5% — a negligible drag — rather than distorting the formula by assigning a higher weight to a non-functional signal.'),
      gap(80),
      p('Both weight sets are now locked in the codebase (scorer.ts):'),
      gap(80),
      phaseTable(),
      gap(120),
      callout('When Phase 3 ships: change the four weight constants in scorer.ts. No other file needs updating. The Phase 3 weights shift 10% from text to AI (short) and 20% from text+account to AI (long), reflecting that AI carries part of the detection burden that text was compensating for.'),
      gap(200),

      // ── 8. THRESHOLDS ──────────────────────────────────────────────────────
      h1('8.  Classification Thresholds  (Issue 4 — Acknowledged)'),
      p('The 30% (suspicious) and 55% (likely-bot) thresholds are provisional. They were chosen by reasoning through worked examples, not from empirical precision/recall analysis.'),
      gap(80),
      callout('Action required: once a labelled test set of ≥100 YouTube comments exists, plot a precision-recall curve over both thresholds and choose values that meet targets — for example, >85% precision, <15% false-positive rate. Until then, treat both thresholds as estimates.', YELLOW_BG, '856404'),
      gap(120),
      p('Mitigations currently in place:'),
      bull('Both thresholds are user-adjustable via the popup sensitivity slider (range: 40–80%)'),
      bull('The "hide above threshold" feature is off by default — suspicious comments are flagged with a badge, not hidden'),
      bull('Worked examples were explicitly constructed to verify the most important case: a new empty account with a genuine comment stays green (16.5%) — well clear of both thresholds'),
      gap(200),

      // ── 9. WORKED EXAMPLES ─────────────────────────────────────────────────
      h1('9.  Worked Examples'),

      h3('Example A — Promotional spam bot  (new account + crypto link)'),
      p('Account: 3 days old, 0 subs, 0 videos, no description, no banner.'),
      p('Comment: "Check IntoTheCryptoVerse•Com for premium signals #DYOR #NFA #Crypto"'),
      gap(80),
      new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [2800,1800,1800,2960], rows: [
        exHeader(),
        exRow('Account  (probabilistic OR)', '0.61', '× 30%', '18.3%', GREY_LIGHT),
        exRow('Text  (URL + hashtags + keyword)', '0.69', '× 55%', '38.0%'),
        exRow('Cross-comment', '0.00', '× 10%', '0.0%', GREY_LIGHT),
        exRow('AI  (stub)', '0.00', '× 5%', '0.0%'),
        exTotal('56.3%', '🔴 Likely Bot', RED_BG),
      ]}),
      gap(200),

      h3('Example B — Channel admin promotional comment  (@ITC_Admin)'),
      p('Account: years old, many subscribers — account looks completely legitimate.'),
      p('Comment: "IntoTheCryptoVerse•Com #DYOR #NFA #MakeYourOwnDecisions"'),
      gap(80),
      new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [2800,1800,1800,2960], rows: [
        exHeader(),
        exRow('Account  (old + established)', '0.02', '× 30%', '0.6%', GREY_LIGHT),
        exRow('Text  (disguised URL + hashtags + keyword)', '0.69', '× 55%', '38.0%'),
        exRow('Cross-comment', '0.00', '× 10%', '0.0%', GREY_LIGHT),
        exRow('AI  (stub)', '0.00', '× 5%', '0.0%'),
        exTotal('38.6%', '🟡 Suspicious', YELLOW_BG),
      ]}),
      gap(200),

      h3('Example C — New account, completely normal comment  (key safety case)'),
      p('Account: 25 days old, 0 subscribers, 0 videos.'),
      p('Comment: "Really enjoyed this breakdown, thanks for explaining it clearly."'),
      gap(80),
      new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [2800,1800,1800,2960], rows: [
        exHeader(),
        exRow('Account  (new + empty)', '0.47', '× 30%', '14.1%', GREY_LIGHT),
        exRow('Text  (no signals)', '0.00', '× 55%', '0.0%'),
        exRow('Cross-comment', '0.00', '× 10%', '0.0%', GREY_LIGHT),
        exRow('AI  (stub)', '0.00', '× 5%', '0.0%'),
        exTotal('14.1%', '🟢 Human', GREEN_BG),
      ]}),
      gap(80),
      callout('This is the most important test case. A new empty account with a genuine comment stays clearly in the green zone. There is a 16-point gap to the suspicious threshold — robust to small weight adjustments.'),
      gap(200),

      // ── 10. LIMITATIONS ────────────────────────────────────────────────────
      h1('10.  Current Limitations'),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [3000, 3180, 3180],
        rows: [
          new TableRow({ children: ['Missing signal', 'Why it is missing', 'Impact'].map((t, i) =>
            new TableCell({ borders: cb(BLUE_DARK), shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, width: { size: [3000,3180,3180][i], type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 },
              children: [new Paragraph({ children: [new TextRun({ text: t, font: 'Arial', size: 20, bold: true, color: WHITE })] })] })) }),
          new TableRow({ children: [
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREY_LIGHT, type: ShadingType.CLEAR }, width: { size: 3000, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'Comment history across videos', font: 'Arial', size: 20 })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREY_LIGHT, type: ShadingType.CLEAR }, width: { size: 3180, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'YouTube API has no "get comments by user" endpoint', font: 'Arial', size: 20 })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREY_LIGHT, type: ShadingType.CLEAR }, width: { size: 3180, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'Serial cross-video spammers appear fresh each session', font: 'Arial', size: 20 })] })] }),
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: WHITE, type: ShadingType.CLEAR }, width: { size: 3000, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'Bought aged accounts', font: 'Arial', size: 20 })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: WHITE, type: ShadingType.CLEAR }, width: { size: 3180, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'Account age market is not detectable from public data', font: 'Arial', size: 20 })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: WHITE, type: ShadingType.CLEAR }, width: { size: 3180, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'Bots using old purchased accounts bypass account signals entirely', font: 'Arial', size: 20 })] })] }),
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREY_LIGHT, type: ShadingType.CLEAR }, width: { size: 3000, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'AI-generated text  (Phase 3)', font: 'Arial', size: 20 })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREY_LIGHT, type: ShadingType.CLEAR }, width: { size: 3180, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'Transformers.js model not yet integrated', font: 'Arial', size: 20 })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: GREY_LIGHT, type: ShadingType.CLEAR }, width: { size: 3180, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: '15–25% of scoring potential is unused', font: 'Arial', size: 20 })] })] }),
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: WHITE, type: ShadingType.CLEAR }, width: { size: 3000, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'Empirically validated thresholds', font: 'Arial', size: 20 })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: WHITE, type: ShadingType.CLEAR }, width: { size: 3180, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'No labelled test set yet — thresholds set by reasoning', font: 'Arial', size: 20 })] })] }),
            new TableCell({ borders: cb('CCCCCC'), shading: { fill: WHITE, type: ShadingType.CLEAR }, width: { size: 3180, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: 'Borderline cases (25–35%) may be wrong; thresholds are user-adjustable', font: 'Arial', size: 20 })] })] }),
          ]}),
        ]
      }),
      gap(200),
    ]
  }]
})

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('Scoring_Model_Design_v2.1.docx', buf)
  console.log('Done: Scoring_Model_Design_v2.1.docx')
})
