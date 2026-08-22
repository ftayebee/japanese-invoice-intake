import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type {
  ResponseInputContent,
  ResponseInputImage,
  ResponseInputText,
} from "openai/resources/responses/responses";
import { z } from "zod";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import type { DocumentContent } from "./documentContent.js";

const aiLineSchema = z.object({
  description: z.string(),
  quantity: z.number().int().nullable(),
  unit: z.string().nullable(),
  unitPrice: z.number().int().nullable(),
  amount: z.number().int(),
  taxCode: z.enum(["T10", "T08"]).nullable(),
});

const annotationSchema = z.object({
  text: z.string(),
  interpretation: z.string(),
  affectsInvoiceData: z.boolean(),
});

export const aiInvoiceExtractionSchema = z.object({
  supplierName: z.string(),
  supplierRegistrationNumber: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  issueDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  currency: z.literal("JPY"),
  lines: z.array(aiLineSchema),
  subtotal: z.number().int().nullable(),
  taxAmount: z.number().int().nullable(),
  totalAmount: z.number().int().nullable(),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
  handwrittenAnnotations: z.array(annotationSchema),
});

export type AiInvoiceExtraction = z.infer<typeof aiInvoiceExtractionSchema>;

const EXTRACTION_PROMPT = `You extract Japanese supplier invoices into structured data.

Rules:
- Use only information visible in the supplied document. Never invent a value.
- Read every page in order and preserve every line item, including continuation pages.
- Distinguish the invoice supplier from the recipient (Sample Trading Co., Ltd.).
- Return quantity and unitPrice as null when they are not printed. Do not replace missing values with 1.
- Preserve negative discounts as negative line amounts.
- Set taxCode to T10 for 10%, T08 for 8%, and null if the line tax cannot be determined from the document.
- Preserve the source date wording. The application will normalize Japanese and era dates deterministically.
- Treat printed values as authoritative. Record handwriting separately; do not overwrite printed values unless the annotation is unmistakably an intended correction to a required invoice field.
- Totals and amounts are integer JPY values without commas or currency symbols.
- Include an honest 0-1 confidence and concise warnings for ambiguity.
- Before returning, re-scan every page for missed lines and check that the visible totals were copied exactly.

Return only the required structured object.`;

function textInput(text: string): ResponseInputText {
  return { type: "input_text", text };
}

function imageInput(data: Buffer): ResponseInputImage {
  return {
    type: "input_image",
    detail: "high",
    image_url: `data:image/jpeg;base64,${data.toString("base64")}`,
  };
}

function buildInputContent(document: DocumentContent): ResponseInputContent[] {
  const content: ResponseInputContent[] = [textInput(EXTRACTION_PROMPT)];

  if (document.text) {
    content.push(textInput(`\nExtract this complete PDF text:\n\n${document.text}`));
    return content;
  }

  for (const page of document.visionPages) {
    content.push(textInput(`Page ${page.pageNumber} of ${document.pageCount}:`));
    content.push(imageInput(page.data));
  }

  return content;
}

function shouldRetry(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) {
    return true;
  }

  return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
}

function extractionError(error: unknown): AppError {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403) {
      return new AppError("LLM_AUTH_FAILED", "The configured LLM credentials were rejected.", 503);
    }
    if (error.status === 429) {
      return new AppError("LLM_RATE_LIMITED", "The extraction provider is rate limited. Try again shortly.", 503);
    }
  }

  return new AppError("LLM_EXTRACTION_FAILED", "The invoice could not be extracted safely.", 502);
}

export class AiExtractor {
  private readonly client: OpenAI | null;

  constructor() {
    this.client = config.llmApiKey
      ? new OpenAI({ apiKey: config.llmApiKey, baseURL: config.llmBaseUrl })
      : null;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  async extract(document: DocumentContent): Promise<AiInvoiceExtraction> {
    if (!this.client) {
      throw new AppError(
        "LLM_NOT_CONFIGURED",
        "Add LLM_API_KEY to .env before processing invoices.",
        503,
      );
    }

    let finalError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.client.responses.parse({
          model: config.llmModel,
          store: false,
          input: [
            {
              role: "user",
              content: buildInputContent(document),
            },
          ],
          text: {
            format: zodTextFormat(aiInvoiceExtractionSchema, "japanese_invoice"),
          },
        });

        if (!response.output_parsed) {
          throw new Error("The extraction response did not contain schema-valid data.");
        }

        return response.output_parsed;
      } catch (error) {
        finalError = error;
        if (attempt === 1 || !shouldRetry(error)) {
          break;
        }
      }
    }

    throw extractionError(finalError);
  }
}
