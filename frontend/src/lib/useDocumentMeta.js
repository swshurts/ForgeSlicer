// useDocumentMeta — per-route SEO meta tag manager.
//
// Why this lives as a custom hook rather than react-helmet-async:
//   - One less dependency in package.json.
//   - The set of tags we care about is small (title, description,
//     keywords, canonical, og:title, og:description, og:url) — a
//     30-line hook is simpler than wiring a context-based library.
//   - Googlebot now renders JS, so updating tags from inside React
//     is a fully supported SEO pattern — the crawler waits for the
//     hydration tick before snapshotting the head.
//
// Lifecycle:
//   1. Component mounts → hook reads the current values of every
//      meta tag we'll touch and stashes them in a `previous` map.
//   2. Hook writes the new values (creating tags that didn't exist).
//   3. On unmount, hook restores the previous values so a navigation
//      back to the homepage doesn't leave a landing page's title
//      stuck in the browser tab.
//
// What we DO NOT manage:
//   - Twitter card tags — they fall back to og:title/og:description
//     when not set, which is fine for our use case.
//   - JSON-LD structured data — the homepage's WebApplication script
//     is already in index.html; landing pages don't need their own.

import { useEffect } from "react";

const META_KEYS = [
    // {selector, attr, propValueKey}
    { sel: 'meta[name="description"]', attr: "content", key: "description" },
    { sel: 'meta[name="keywords"]', attr: "content", key: "keywords" },
    { sel: 'meta[property="og:title"]', attr: "content", key: "ogTitle" },
    { sel: 'meta[property="og:description"]', attr: "content", key: "ogDescription" },
    { sel: 'meta[property="og:url"]', attr: "content", key: "ogUrl" },
    { sel: 'link[rel="canonical"]', attr: "href", key: "canonical" },
];

function ensureNode(selector) {
    let el = document.head.querySelector(selector);
    if (el) return el;
    // Lazily create the tag if the index.html shell doesn't ship it.
    // Selector is in the form: meta[name="x"] | meta[property="x"] | link[rel="x"].
    const tagMatch = selector.match(/^(meta|link)\[(name|property|rel)="([^"]+)"\]$/);
    if (!tagMatch) return null;
    const [, tag, attrName, attrValue] = tagMatch;
    el = document.createElement(tag);
    el.setAttribute(attrName, attrValue);
    document.head.appendChild(el);
    return el;
}

/**
 * Set per-route document meta. Pass an object with any subset of:
 *   {title, description, keywords, ogTitle, ogDescription, ogUrl, canonical}
 *
 * Falls back to ogTitle = title and ogDescription = description so
 * landing-page authors only need to supply two fields most of the time.
 */
export function useDocumentMeta(meta) {
    useEffect(() => {
        const previous = { title: document.title };

        if (meta.title) document.title = meta.title;

        const effective = {
            ...meta,
            ogTitle: meta.ogTitle || meta.title,
            ogDescription: meta.ogDescription || meta.description,
            ogUrl: meta.ogUrl || (typeof window !== "undefined" ? window.location.href : undefined),
            canonical: meta.canonical || (typeof window !== "undefined" ? window.location.href : undefined),
        };

        for (const { sel, attr, key } of META_KEYS) {
            if (effective[key] === undefined) continue;
            const el = ensureNode(sel);
            if (!el) continue;
            previous[key] = el.getAttribute(attr) ?? "";
            el.setAttribute(attr, effective[key]);
        }

        return () => {
            // Restore so back-navigation doesn't leak a stale title /
            // description from this route into the next one.
            if (previous.title) document.title = previous.title;
            for (const { sel, attr, key } of META_KEYS) {
                if (previous[key] === undefined) continue;
                const el = document.head.querySelector(sel);
                if (el) el.setAttribute(attr, previous[key]);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        meta.title, meta.description, meta.keywords,
        meta.ogTitle, meta.ogDescription, meta.ogUrl, meta.canonical,
    ]);
}
