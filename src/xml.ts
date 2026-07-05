import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

export const NS = {
  dc: "http://purl.org/dc/elements/1.1/",
  opf: "http://www.idpf.org/2007/opf",
  container: "urn:oasis:names:tc:opendocument:xmlns:container",
  xhtml: "http://www.w3.org/1999/xhtml"
} as const;

export function parseXml(xml: string, label = "XML"): Document {
  const errors: string[] = [];
  const doc = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (message) => errors.push(String(message)),
      fatalError: (message) => errors.push(String(message))
    }
  }).parseFromString(xml, "application/xml");
  if (errors.length > 0) {
    throw new Error(`Invalid ${label}: ${errors.join("; ")}`);
  }
  return doc;
}

export function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

export function localName(node: Node): string {
  return (node as Element).localName || node.nodeName.replace(/^.*:/, "");
}

export function elementChildren(node: Node): Element[] {
  const children: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes.item(i);
    if (child.nodeType === 1) children.push(child as Element);
  }
  return children;
}

export function childElements(node: Node, name: string): Element[] {
  return elementChildren(node).filter((child) => localName(child) === name);
}

export function firstChildElement(node: Node, name: string): Element | undefined {
  return childElements(node, name)[0];
}

export function descendants(node: Node, name: string): Element[] {
  const found: Element[] = [];
  function walk(current: Node): void {
    for (let i = 0; i < current.childNodes.length; i += 1) {
      const child = current.childNodes.item(i);
      if (child.nodeType !== 1) continue;
      if (localName(child) === name) found.push(child as Element);
      walk(child);
    }
  }
  walk(node);
  return found;
}

export function firstDescendant(node: Node, name: string): Element | undefined {
  return descendants(node, name)[0];
}

export function textContent(element: Element | undefined): string | undefined {
  const value = element?.textContent?.trim();
  return value || undefined;
}

export function attr(element: Element | undefined, name: string): string | undefined {
  if (!element) return undefined;
  const direct = element.getAttribute(name);
  if (direct != null && direct !== "") return direct;
  const suffix = `:${name}`;
  for (let i = 0; i < element.attributes.length; i += 1) {
    const item = element.attributes.item(i);
    if (item && item.name.endsWith(suffix) && item.value !== "") return item.value;
  }
  return undefined;
}

export function setAttr(element: Element, name: string, value: string): void {
  element.setAttribute(name, value);
}

export function removeElement(element: Element): void {
  element.parentNode?.removeChild(element);
}

export function removeChildrenWhere(parent: Element, predicate: (element: Element) => boolean): void {
  for (const child of [...elementChildren(parent)]) {
    if (predicate(child)) parent.removeChild(child);
  }
}

export function appendTextElement(
  doc: Document,
  parent: Element,
  qualifiedName: string,
  value: string,
  namespace?: string
): Element {
  const element = namespace ? doc.createElementNS(namespace, qualifiedName) : doc.createElement(qualifiedName);
  element.appendChild(doc.createTextNode(value));
  parent.appendChild(element);
  return element;
}

export function replaceText(element: Element, value: string): void {
  while (element.firstChild) element.removeChild(element.firstChild);
  element.appendChild(element.ownerDocument.createTextNode(value));
}

export function ensureChild(doc: Document, parent: Element, qualifiedName: string, namespace?: string): Element {
  const name = qualifiedName.replace(/^.*:/, "");
  const existing = firstChildElement(parent, name);
  if (existing) return existing;
  const element = namespace ? doc.createElementNS(namespace, qualifiedName) : doc.createElement(qualifiedName);
  parent.appendChild(element);
  return element;
}

export function cdataText(element: Element | undefined): string | undefined {
  if (!element) return undefined;
  let value = "";
  for (let i = 0; i < element.childNodes.length; i += 1) {
    const child = element.childNodes.item(i);
    value += child.nodeValue ?? "";
  }
  value = value.trim();
  return value || undefined;
}

export function setTextPreservingCdata(element: Element, value: string): void {
  let hadCdata = false;
  for (let i = 0; i < element.childNodes.length; i += 1) {
    if (element.childNodes.item(i).nodeType === 4) hadCdata = true;
  }
  while (element.firstChild) element.removeChild(element.firstChild);
  element.appendChild(
    hadCdata && !value.includes("]]>")
      ? element.ownerDocument.createCDATASection(value)
      : element.ownerDocument.createTextNode(value)
  );
}
