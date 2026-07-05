export type EpubVersion = "2" | "3";

export interface Contributor {
  name: string;
  fileAs?: string;
}

export interface EpubMetadata {
  title?: string;
  authors: Contributor[];
  translators: Contributor[];
  subjects: string[];
  description?: string;
  publisher?: string;
  language?: string;
  rights?: string;
  isbn?: string;
  published?: string;
  modified?: string;
  created?: string;
}

export interface MetadataPatch {
  title?: string | null;
  authors?: Contributor[] | null;
  translators?: Contributor[] | null;
  subjects?: string[] | null;
  description?: string | null;
  publisher?: string | null;
  language?: string | null;
  rights?: string | null;
  isbn?: string | null;
  published?: string | null;
  modified?: string | null;
}

export interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
  fallback?: string;
  fallbackStyle?: string;
  mediaOverlay?: string;
  path: string;
}

export interface SpineItem {
  idref: string;
  linear?: string;
  properties?: string;
}

export interface EpubInfo {
  path?: string;
  version: EpubVersion;
  opfPath: string;
  rootDir: string;
  fileCount: number;
  manifestCount: number;
  spineCount: number;
  navPath?: string;
  ncxPath?: string;
  coverPath?: string;
  uniqueIdentifier?: string;
  metadata: EpubMetadata;
}

export interface MergeOptions {
  output?: string;
  title?: string;
  language?: string;
  force?: boolean;
  preserveOrder?: boolean;
  volumeLabels?: string[];
  volumeLabelsFromFiles?: boolean;
  volumePrefix?: string;
  volumeSuffix?: string;
  quiet?: boolean;
}

export interface UnpackOptions {
  outputDir?: string;
  force?: boolean;
}

export interface CoverInfo {
  path: string;
  id?: string;
  mediaType: string;
  data: Uint8Array;
}

export interface CoverExtractOptions {
  output?: string;
  force?: boolean;
}

export interface CoverWriteOptions {
  output?: string;
  force?: boolean;
}
