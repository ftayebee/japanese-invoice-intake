import { describe, expect, it } from "vitest";

import {
  matchPartner,
  normalizePartnerName,
  partnerNameSimilarity,
  type Partner,
} from "../../shared/domain/index.js";

const partners: readonly Partner[] = [
  {
    partnerCode: "P-1001",
    name: "株式会社山田製作所",
    aliases: ["ヤマダ製作所", "山田製作所"],
    registrationNo: "T1010001000101",
  },
  {
    partnerCode: "P-1002",
    name: "有限会社佐藤商店",
    aliases: ["佐藤商店"],
    registrationNo: "T2020002000202",
  },
  {
    partnerCode: "P-1005",
    name: "みらいITソリューションズ株式会社",
    aliases: ["みらいIT", "みらいITソリューションズ"],
    registrationNo: "T5050005000505",
  },
];

describe("partner matching", () => {
  it("prioritizes an exact normalized registration number", () => {
    const result = matchPartner(
      { name: "unreadable", registrationNo: "ｔ1010-0010-00101" },
      partners,
    );

    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.partner.partnerCode).toBe("P-1001");
      expect(result.method).toBe("registration_number");
    }
  });

  it("normalizes Japanese company abbreviations and matches official names", () => {
    expect(normalizePartnerName(" （株） 山田製作所 ")).toBe(
      normalizePartnerName("株式会社山田製作所"),
    );
    const result = matchPartner(
      { name: "（株） 山田製作所", registrationNo: null },
      partners,
    );
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.method).toBe("normalized_name");
    }
  });

  it("matches a supplied alias exactly", () => {
    const result = matchPartner({ name: "佐藤 商店", registrationNo: null }, partners);
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.partner.partnerCode).toBe("P-1002");
      expect(result.method).toBe("alias");
    }
  });

  it("accepts a clear long-name fuzzy match", () => {
    const result = matchPartner(
      { name: "みらいITソリューションス", registrationNo: null },
      partners,
    );
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.partner.partnerCode).toBe("P-1005");
      expect(result.method).toBe("fuzzy");
      expect(result.confidence).toBeGreaterThanOrEqual(0.84);
    }
  });

  it("does not fall back to a name when a supplied registration number is unknown", () => {
    const result = matchPartner(
      { name: "株式会社山田製作所", registrationNo: "T9999999999999" },
      partners,
    );
    expect(result.status).toBe("not_found");
    expect(result.reason).toContain("registration number is not in");
  });

  it("requires review when registration and exact name identify different partners", () => {
    const result = matchPartner(
      { name: "有限会社佐藤商店", registrationNo: "T1010001000101" },
      partners,
    );
    expect(result.status).toBe("ambiguous");
    expect(result.candidates.map((candidate) => candidate.partner.partnerCode)).toEqual([
      "P-1001",
      "P-1002",
    ]);
  });

  it("reports close fuzzy candidates as ambiguous instead of choosing one", () => {
    const closePartners: readonly Partner[] = [
      {
        partnerCode: "P-A",
        name: "東都開発株式会社",
        aliases: ["東都開発"],
        registrationNo: "T1000000000000",
      },
      {
        partnerCode: "P-B",
        name: "東都開拓株式会社",
        aliases: ["東都開拓"],
        registrationNo: "T2000000000000",
      },
    ];
    const result = matchPartner(
      { name: "東都開杜", registrationNo: null },
      closePartners,
      { fuzzyThreshold: 0.7, ambiguityMargin: 0.1 },
    );

    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toHaveLength(2);
    expect(partnerNameSimilarity("東都開杜", "東都開発")).toBe(0.75);
  });

  it("rejects an unrelated supplier name", () => {
    const result = matchPartner({ name: "未知物流", registrationNo: null }, partners);
    expect(result.status).toBe("not_found");
  });
});
