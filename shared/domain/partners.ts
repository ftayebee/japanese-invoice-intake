import type {
  Partner,
  PartnerMatchCandidate,
  PartnerMatchInput,
  PartnerMatchMethod,
  PartnerMatchOptions,
  PartnerMatchResult,
} from "./types.js";

const DEFAULT_FUZZY_THRESHOLD = 0.84;
const DEFAULT_AMBIGUITY_MARGIN = 0.08;

/** Normalize formatting variations while retaining legally meaningful name text. */
export function normalizePartnerName(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^\(株\)/u, "株式会社")
    .replace(/\(株\)$/u, "株式会社")
    .replace(/^\(有\)/u, "有限会社")
    .replace(/\(有\)$/u, "有限会社")
    .replace(/[\s\u3000・･.,，。､、_/'"「」『』【】()[\]（）\-‐‑‒–—―]/gu, "");
}

/** Registration IDs are compared exactly after harmless display normalization. */
export function normalizeRegistrationNumber(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\s\u3000\u002d\u2010-\u2015]/gu, "");
}

function levenshteinDistance(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? Number.POSITIVE_INFINITY) + 1,
        (previous[rightIndex] ?? Number.POSITIVE_INFINITY) + 1,
        (previous[rightIndex - 1] ?? Number.POSITIVE_INFINITY) + substitutionCost,
      );
    }
    previous = current;
  }

  return previous[right.length] ?? Math.max(left.length, right.length);
}

/** Unicode-code-point Levenshtein similarity in the inclusive range 0..1. */
export function partnerNameSimilarity(left: string, right: string): number {
  const normalizedLeft = Array.from(normalizePartnerName(left));
  const normalizedRight = Array.from(normalizePartnerName(right));
  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  if (maxLength === 0) {
    return 1;
  }
  return 1 - levenshteinDistance(normalizedLeft, normalizedRight) / maxLength;
}

interface ExactNameMatch {
  readonly partner: Partner;
  readonly method: Extract<PartnerMatchMethod, "normalized_name" | "alias">;
  readonly matchedName: string;
}

function exactNameMatches(name: string, partners: readonly Partner[]): readonly ExactNameMatch[] {
  const normalizedInput = normalizePartnerName(name);
  if (normalizedInput === "") {
    return [];
  }

  const matches = new Map<string, ExactNameMatch>();
  for (const partner of partners) {
    if (normalizePartnerName(partner.name) === normalizedInput) {
      matches.set(partner.partnerCode, {
        partner,
        method: "normalized_name",
        matchedName: partner.name,
      });
      continue;
    }

    const alias = partner.aliases.find(
      (candidateAlias) => normalizePartnerName(candidateAlias) === normalizedInput,
    );
    if (alias !== undefined) {
      matches.set(partner.partnerCode, { partner, method: "alias", matchedName: alias });
    }
  }
  return [...matches.values()];
}

function fuzzyCandidates(name: string, partners: readonly Partner[]): readonly PartnerMatchCandidate[] {
  const candidates = partners.map((partner): PartnerMatchCandidate => {
    const knownNames = [partner.name, ...partner.aliases];
    let bestScore = 0;
    let matchedName: string | null = null;
    for (const knownName of knownNames) {
      const score = partnerNameSimilarity(name, knownName);
      if (score > bestScore) {
        bestScore = score;
        matchedName = knownName;
      }
    }
    return { partner, score: bestScore, matchedName };
  });

  return candidates.sort(
    (left, right) =>
      right.score - left.score || left.partner.partnerCode.localeCompare(right.partner.partnerCode),
  );
}

function boundedOption(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
}

function uniqueCandidates(
  candidates: readonly PartnerMatchCandidate[],
): readonly PartnerMatchCandidate[] {
  const unique = new Map<string, PartnerMatchCandidate>();
  for (const candidate of candidates) {
    const previous = unique.get(candidate.partner.partnerCode);
    if (previous === undefined || candidate.score > previous.score) {
      unique.set(candidate.partner.partnerCode, candidate);
    }
  }
  return [...unique.values()].sort(
    (left, right) =>
      right.score - left.score || left.partner.partnerCode.localeCompare(right.partner.partnerCode),
  );
}

/**
 * Match in safety order: registration number, normalized official name, alias,
 * then a thresholded fuzzy suggestion. A supplied-but-unknown registration ID
 * blocks name fallback so a contradictory identity always requires review.
 */
export function matchPartner(
  input: PartnerMatchInput,
  partners: readonly Partner[],
  options: PartnerMatchOptions = {},
): PartnerMatchResult {
  const registrationNo = normalizeRegistrationNumber(input.registrationNo);
  const extractedName = typeof input.name === "string" ? input.name : "";

  if (registrationNo !== "") {
    const registrationMatches = partners.filter(
      (partner) => normalizeRegistrationNumber(partner.registrationNo) === registrationNo,
    );

    if (registrationMatches.length > 1) {
      return {
        status: "ambiguous",
        partner: null,
        method: null,
        confidence: 1,
        reason: "The registration number maps to more than one partner master record.",
        candidates: registrationMatches.map((partner) => ({
          partner,
          score: 1,
          matchedName: null,
        })),
      };
    }

    const registrationPartner = registrationMatches[0];
    if (registrationPartner !== undefined) {
      const nameMatches = exactNameMatches(extractedName, partners);
      const contradictoryNameMatches = nameMatches.filter(
        ({ partner }) => partner.partnerCode !== registrationPartner.partnerCode,
      );
      const nameIncludesRegistrationPartner = nameMatches.some(
        ({ partner }) => partner.partnerCode === registrationPartner.partnerCode,
      );
      if (
        extractedName.trim() !== "" &&
        contradictoryNameMatches.length > 0 &&
        !nameIncludesRegistrationPartner
      ) {
        return {
          status: "ambiguous",
          partner: null,
          method: null,
          confidence: 1,
          reason: "The registration number and supplier name identify different partners.",
          candidates: uniqueCandidates([
            { partner: registrationPartner, score: 1, matchedName: null },
            ...contradictoryNameMatches.map(({ partner, matchedName }) => ({
              partner,
              score: 0.99,
              matchedName,
            })),
          ]),
        };
      }

      return {
        status: "matched",
        partner: registrationPartner,
        method: "registration_number",
        confidence: 1,
        reason: "Matched the supplier registration number exactly.",
        candidates: [
          { partner: registrationPartner, score: 1, matchedName: null },
        ],
      };
    }

    const suggestions = extractedName.trim() === ""
      ? []
      : fuzzyCandidates(extractedName, partners).slice(0, 3);
    return {
      status: "not_found",
      partner: null,
      method: null,
      confidence: suggestions[0]?.score ?? 0,
      reason:
        "The supplied registration number is not in the partner master; name fallback was not accepted.",
      candidates: suggestions,
    };
  }

  if (extractedName.trim() === "") {
    return {
      status: "not_found",
      partner: null,
      method: null,
      confidence: 0,
      reason: "No supplier registration number or name was available for matching.",
      candidates: [],
    };
  }

  const nameMatches = exactNameMatches(extractedName, partners);
  if (nameMatches.length > 1) {
    return {
      status: "ambiguous",
      partner: null,
      method: null,
      confidence: 0.99,
      reason: "The normalized supplier name maps to more than one partner.",
      candidates: nameMatches.map(({ partner, matchedName }) => ({
        partner,
        score: 0.99,
        matchedName,
      })),
    };
  }

  const exactMatch = nameMatches[0];
  if (exactMatch !== undefined) {
    const confidence = exactMatch.method === "normalized_name" ? 0.99 : 0.98;
    return {
      status: "matched",
      partner: exactMatch.partner,
      method: exactMatch.method,
      confidence,
      reason:
        exactMatch.method === "normalized_name"
          ? "Matched the normalized official supplier name exactly."
          : "Matched a normalized supplier alias exactly.",
      candidates: [
        {
          partner: exactMatch.partner,
          score: confidence,
          matchedName: exactMatch.matchedName,
        },
      ],
    };
  }

  const threshold = boundedOption(options.fuzzyThreshold, DEFAULT_FUZZY_THRESHOLD);
  const ambiguityMargin = boundedOption(options.ambiguityMargin, DEFAULT_AMBIGUITY_MARGIN);
  const candidates = fuzzyCandidates(extractedName, partners);
  const best = candidates[0];
  if (best === undefined || best.score < threshold) {
    return {
      status: "not_found",
      partner: null,
      method: null,
      confidence: best?.score ?? 0,
      reason: `No partner met the conservative fuzzy-match threshold (${threshold.toFixed(2)}).`,
      candidates: candidates.slice(0, 3),
    };
  }

  const second = candidates[1];
  if (second !== undefined && best.score - second.score < ambiguityMargin) {
    return {
      status: "ambiguous",
      partner: null,
      method: null,
      confidence: best.score,
      reason: `The leading fuzzy match was less than ${ambiguityMargin.toFixed(2)} ahead of the next candidate.`,
      candidates: candidates
        .filter((candidate) => best.score - candidate.score < ambiguityMargin)
        .slice(0, 3),
    };
  }

  return {
    status: "matched",
    partner: best.partner,
    method: "fuzzy",
    confidence: best.score,
    reason: `Matched by controlled name similarity above ${threshold.toFixed(2)}.`,
    candidates: candidates.slice(0, 3),
  };
}
