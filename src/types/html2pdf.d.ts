declare module 'html2pdf.js' {
  interface Html2PdfWorker {
    set(options: Record<string, unknown>): Html2PdfWorker
    from(source: HTMLElement): Html2PdfWorker
    outputPdf(type: 'blob'): Promise<Blob>
    save(filename?: string): Promise<void>
  }

  export default function html2pdf(): Html2PdfWorker
}
