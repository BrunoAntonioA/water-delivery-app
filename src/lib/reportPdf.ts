import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

// Azul "agua" de la marca (sky-600).
const BRAND: [number, number, number] = [2, 132, 199]

export interface ReportDoc {
  doc: jsPDF
  y: number
}

/** Crea un PDF con encabezado (empresa + título + subtítulo). */
export function makeReportDoc(
  title: string,
  companyName: string | undefined,
  subtitle?: string,
  landscape = false
): ReportDoc {
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(15, 23, 42)
  doc.text(companyName || 'AquaGestión', 14, 18)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(13)
  doc.setTextColor(BRAND[0], BRAND[1], BRAND[2])
  doc.text(title, 14, 26)

  let y = 32
  if (subtitle) {
    doc.setFontSize(9)
    doc.setTextColor(120, 120, 120)
    doc.text(subtitle, 14, y)
    y += 5
  }
  doc.setTextColor(0, 0, 0)
  return { doc, y: y + 1 }
}

/** Agrega una tabla (con título opcional) y avanza el cursor vertical. */
export function addReportTable(
  r: ReportDoc,
  head: string[],
  body: (string | number)[][],
  opts?: { title?: string }
): void {
  if (opts?.title) {
    r.doc.setFont('helvetica', 'bold')
    r.doc.setFontSize(11)
    r.doc.setTextColor(30, 41, 59)
    r.doc.text(opts.title, 14, r.y + 5)
    r.doc.setFont('helvetica', 'normal')
    r.doc.setTextColor(0, 0, 0)
    r.y += 8
  }
  autoTable(r.doc, {
    startY: r.y,
    head: [head],
    body: body.length ? body : [['—']],
    theme: 'striped',
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 2 },
    margin: { left: 14, right: 14 },
  })
  const doc = r.doc as jsPDF & { lastAutoTable?: { finalY: number } }
  r.y = (doc.lastAutoTable?.finalY ?? r.y) + 8
}

export function saveReport(r: ReportDoc, filename: string): void {
  r.doc.save(filename)
}
