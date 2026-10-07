declare module 'pdfjs-dist/build/pdf.js' {
  export interface PDFDocumentProxy {
    numPages: number
    getPage(pageNumber: number): Promise<PDFPageProxy>
    destroy(): void
  }

  export interface PDFPageProxy {
    getTextContent(options?: {
      normalizeWhitespace?: boolean
      disableCombineTextItems?: boolean
    }): Promise<{ items: Array<{ str?: unknown; transform?: unknown }> }>
    cleanup(): void
  }

  export interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>
  }

  export function getDocument(options: {
    data: Uint8Array
    disableFontFace?: boolean
    useSystemFonts?: boolean
  }): PDFDocumentLoadingTask
}

declare module 'pdfjs-dist/build/pdf.worker.js' {
  export const WorkerMessageHandler: unknown
}
