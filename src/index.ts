/// <reference lib="dom" preserve="true" />

export { readArchive, readArchiveFile, writeArchive, writeArchiveFile } from "./archive.js";
export {
  readEpub,
  readInfo,
  readStandaloneOpf,
  writeEpubArchive,
  getManifestItems,
  getSpineItems,
  findNavItem,
  findNcxItem
} from "./epub.js";
export { readMetadata, readMetadataFromOpf, updateMetadata, applyMetadataPatch } from "./metadata.js";
export { mergeEpubs, unpackMergedEpub } from "./merge.js";
export { detectCover, extractCover, repairCover, replaceCover, setCover } from "./cover.js";
export type {
  Contributor,
  CoverExtractOptions,
  CoverInfo,
  CoverWriteOptions,
  EpubInfo,
  EpubMetadata,
  EpubVersion,
  ManifestItem,
  MergeOptions,
  MetadataPatch,
  SpineItem,
  UnpackOptions
} from "./types.js";
