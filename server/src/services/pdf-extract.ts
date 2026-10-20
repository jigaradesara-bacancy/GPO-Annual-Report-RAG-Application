import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

/** Extract text page by page. Throws on malformed PDFs. */
export async function extractPages(data: Uint8Array): Promise<ExtractedPage[]> {
  const task = getDocument({
    data,
    useSystemFonts: false,
    verbosity: 0,
  });
  const pdf = await task.promise;
  try {
    const pages: ExtractedPage[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        text += item.hasEOL ? '\n' : ' ';
      }
      pages.push({ pageNumber: i, text });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
