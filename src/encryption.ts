/// <reference lib="dom" preserve="true" />

import { fromBytes } from "./utils.js";
import { descendants, parseXml } from "./xml.js";

export const ENCRYPTION_XML = "META-INF/encryption.xml";

const FONT_OBFUSCATION_ALGORITHMS = new Set(["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"]);

export function obfuscatedFontAlgorithm(doc: Document): string | undefined {
  return descendants(doc, "EncryptionMethod")
    .map((method) => method.getAttribute("Algorithm") || undefined)
    .find((algorithm) => algorithm && FONT_OBFUSCATION_ALGORITHMS.has(algorithm));
}

export function obfuscatedFontAlgorithmFromXml(data: Uint8Array, label: string): string | undefined {
  return obfuscatedFontAlgorithm(parseXml(fromBytes(data), label));
}
