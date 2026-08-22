import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "node:path";
import { AppError } from "../errors.js";

export type SupportedMimeType = "application/pdf" | "image/jpeg";

export interface VisionPage {
  pageNumber: number;
  mimeType: "image/jpeg";
  data: Buffer;
}

export interface DocumentContent {
  strategy: "pdf-text" | "pdf-vision" | "image-vision";
  pageCount: number;
  text: string | null;
  visionPages: VisionPage[];
  warnings: string[];
}

const MIN_MEANINGFUL_TEXT_CHARACTERS = 80;
const pdfJsRoot = path.resolve(process.cwd(), "node_modules", "pdfjs-dist");
const asPdfJsResourceUrl = (resourcePath: string): string =>
  `${resourcePath.replaceAll("\\", "/")}/`;
const pdfJsCMapUrl = asPdfJsResourceUrl(path.join(pdfJsRoot, "cmaps"));
const pdfJsStandardFontUrl = asPdfJsResourceUrl(path.join(pdfJsRoot, "standard_fonts"));

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export function detectDocumentType(buffer: Buffer, declaredMimeType: string): SupportedMimeType {
  if (declaredMimeType === "application/pdf" && isPdf(buffer)) {
    return "application/pdf";
  }

  if ((declaredMimeType === "image/jpeg" || declaredMimeType === "image/jpg") && isJpeg(buffer)) {
    return "image/jpeg";
  }

  throw new AppError(
    "UNSUPPORTED_FILE",
    "Only genuine PDF and JPG invoice files are supported.",
    415,
  );
}

function meaningfulCharacterCount(text: string): number {
  return text.replace(/[\s\p{P}\p{S}]/gu, "").length;
}

async function renderPdfPage(page: Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>["promise"]>["getPage"]>>): Promise<Buffer> {
  const initialViewport = page.getViewport({ scale: 1 });
  const targetWidth = Math.min(1_600, Math.max(1_200, initialViewport.width * 2));
  const viewport = page.getViewport({ scale: targetWidth / initialViewport.width });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");

  await page.render({
    canvas: canvas as never,
    canvasContext: context as never,
    viewport,
  }).promise;

  return canvas.toBuffer("image/jpeg", 88);
}

async function extractPdf(buffer: Buffer): Promise<DocumentContent> {
  let document: Awaited<ReturnType<typeof getDocument>["promise"]>;

  try {
    document = await getDocument({
      data: new Uint8Array(buffer),
      cMapPacked: true,
      cMapUrl: pdfJsCMapUrl,
      standardFontDataUrl: pdfJsStandardFontUrl,
      useSystemFonts: true,
    }).promise;
  } catch (error) {
    throw new AppError("CORRUPT_PDF", "The PDF could not be opened.", 422, error);
  }

  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pageTexts.push(`[Page ${pageNumber}]\n${text}`);
  }

  const combinedText = pageTexts.join("\n\n");
  if (meaningfulCharacterCount(combinedText) >= MIN_MEANINGFUL_TEXT_CHARACTERS) {
    return {
      strategy: "pdf-text",
      pageCount: document.numPages,
      text: combinedText,
      visionPages: [],
      warnings: [],
    };
  }

  const visionPages: VisionPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    visionPages.push({
      pageNumber,
      mimeType: "image/jpeg",
      data: await renderPdfPage(page),
    });
  }

  return {
    strategy: "pdf-vision",
    pageCount: document.numPages,
    text: null,
    visionPages,
    warnings: ["No meaningful PDF text layer was found; every page was rendered for vision extraction."],
  };
}

async function extractJpeg(buffer: Buffer): Promise<DocumentContent> {
  try {
    const image = await loadImage(buffer);
    if (image.width < 300 || image.height < 300) {
      throw new AppError("IMAGE_TOO_SMALL", "The image is too small for reliable invoice extraction.", 422);
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("CORRUPT_IMAGE", "The JPG image could not be decoded.", 422, error);
  }

  return {
    strategy: "image-vision",
    pageCount: 1,
    text: null,
    visionPages: [{ pageNumber: 1, mimeType: "image/jpeg", data: buffer }],
    warnings: [],
  };
}

export async function extractDocumentContent(
  buffer: Buffer,
  declaredMimeType: string,
): Promise<DocumentContent> {
  const mimeType = detectDocumentType(buffer, declaredMimeType);
  return mimeType === "application/pdf" ? extractPdf(buffer) : extractJpeg(buffer);
}
