#!/usr/bin/env python3
"""Cache the six selected, author-owned public blog articles for the local reader.

Run at authoring time: python3 scripts/sync-blog-articles.py
Offline validation:    python3 scripts/sync-blog-articles.py --check
No network request or HTML sanitization is needed in the site's runtime.
"""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urljoin, urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "src/design/blog-history.json"
NOTES_FILE = ROOT / "design/blog-source-notes.md"
BLOG = "https://blog.bbangjo.kr"
SLUGS = (
    "exchange-student-1", "exchange-student-2", "exchange-student-3",
    "2025-1", "2025-2", "2025-3",
)
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
ALLOWED = {
    "p", "h2", "h3", "h4", "ol", "ul", "li", "blockquote", "strong",
    "em", "b", "i", "del", "pre", "code", "figure", "figcaption", "img", "a",
    "br", "hr", "table", "thead", "tbody", "tr", "th", "td",
}
DROP = {"script", "style", "iframe", "svg", "math", "object", "embed", "form", "button", "input", "select", "textarea", "nav", "footer"}
ATTRIBUTES = {
    "a": {"href", "target", "rel"},
    "img": {"src", "alt", "loading", "decoding"},
}


class Node:
    def __init__(self, tag="root", attrs=()):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []


class Document(HTMLParser):
    def __init__(self, strict=False):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.strict = strict

    def handle_starttag(self, tag, attrs):
        if self.strict:
            if tag not in ALLOWED:
                raise ValueError(f"Forbidden cached HTML tag: {tag}")
            if len(attrs) != len(dict(attrs)):
                raise ValueError(f"Duplicate attributes on {tag}")
            if set(dict(attrs)) - ATTRIBUTES.get(tag, set()):
                raise ValueError(f"Forbidden cached HTML attributes on {tag}")
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if self.strict:
            if len(self.stack) < 2 or self.stack[-1].tag != tag:
                raise ValueError(f"Unbalanced cached HTML tag: {tag}")
            self.stack.pop()
            return
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                self.stack = self.stack[:index]
                return

    def handle_data(self, value):
        self.stack[-1].children.append(value)

    def handle_decl(self, value):
        if self.strict:
            raise ValueError("Declarations are not allowed in cached article HTML")

    def handle_comment(self, value):
        if self.strict:
            raise ValueError("Comments are not allowed in cached article HTML")


def nodes(node):
    yield node
    for child in node.children:
        if isinstance(child, Node):
            yield from nodes(child)


def ignored(node):
    return node.tag in DROP or node.attrs.get("aria-hidden") == "true"


def text_content(node):
    if isinstance(node, str):
        return node
    if ignored(node):
        return ""
    return "".join(text_content(child) for child in node.children)


def safe_url(value, source_url, image=False):
    if not value or re.search(r"[\x00-\x20\x7f]", value) or "\\" in value:
        return None
    absolute = urljoin(source_url, value)
    parsed = urlsplit(absolute)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return None
    if image:
        # Resolve Next.js image wrappers to the public original, not its layout placeholders.
        if parsed.netloc == "blog.bbangjo.kr" and parsed.path == "/_next/image":
            originals = parse_qs(parsed.query).get("url", [])
            return safe_url(originals[0], BLOG, image=True) if len(originals) == 1 else None
        own_blog = parsed.netloc == "blog.bbangjo.kr" and parsed.path.startswith("/static/images/")
        own_upload = parsed.netloc == "user-images.githubusercontent.com" and parsed.path.startswith("/51329156/")
        if not (own_blog or own_upload) or not re.search(r"\.(jpe?g|png|gif|webp|avif)$", parsed.path, re.I):
            return None
    return absolute


def sanitize(node, source_url):
    if isinstance(node, str):
        return escape(node, quote=False)
    if ignored(node):
        return ""
    inner = "".join(sanitize(child, source_url) for child in node.children)
    tag = node.tag
    if tag not in ALLOWED:
        # Layout wrappers (including Next.js <noscript> image fallbacks) have no behavior.
        return inner
    attrs = ""
    if tag == "a":
        href = safe_url(node.attrs.get("href"), source_url)
        if not href:
            return inner
        attrs = f' href="{escape(href, quote=True)}" target="_blank" rel="noopener noreferrer"'
    elif tag == "img":
        src = safe_url(node.attrs.get("src"), source_url, image=True)
        if not src:
            return ""
        attrs = f' src="{escape(src, quote=True)}" alt="{escape(node.attrs.get("alt") or "", quote=True)}" loading="lazy" decoding="async"'
    if tag in VOID:
        return f"<{tag}{attrs}>"
    return f"<{tag}{attrs}>{inner}</{tag}>"


def validate_html(html, source_url):
    doc = Document(strict=True)
    doc.feed(html)
    doc.close()
    if len(doc.stack) != 1:
        raise ValueError("Unclosed cached article HTML")
    for node in nodes(doc.root):
        if node.tag == "a":
            attrs = node.attrs
            if safe_url(attrs.get("href"), source_url) != attrs.get("href") or attrs.get("target") != "_blank" or attrs.get("rel") != "noopener noreferrer":
                raise ValueError("Unsafe cached article link")
        elif node.tag == "img":
            attrs = node.attrs
            if safe_url(attrs.get("src"), source_url, image=True) != attrs.get("src") or attrs.get("loading") != "lazy" or attrs.get("decoding") != "async":
                raise ValueError("Unsafe cached article image")
    plain = text_content(doc.root).strip()
    counts = Counter(node.tag for node in nodes(doc.root))
    if len(plain) < 800 or counts["p"] + counts["li"] < 5:
        raise ValueError("Cached article body is missing or unexpectedly short")
    return {"characters": len(plain), "paragraphs": counts["p"], "list_items": counts["li"], "images": counts["img"], "sha256": sha256(html.encode()).hexdigest()}


def read_entries():
    entries = json.loads(DATA_FILE.read_text())
    if [entry["id"] for entry in entries] != list(SLUGS):
        raise ValueError("Expected exactly the six curated articles in their original order")
    for entry in entries:
        if entry["url"] != f"{BLOG}/{entry['id']}":
            raise ValueError(f"Unexpected public source URL for {entry['id']}")
    return entries


def fetch_article(entry):
    request = Request(entry["url"], headers={"User-Agent": "buffalo-article-sync/1.0"})
    with urlopen(request, timeout=30) as response:
        if response.status != 200 or response.geturl().rstrip("/") != entry["url"]:
            raise ValueError(f"Unexpected source response for {entry['id']}")
        if response.headers.get_content_type() != "text/html":
            raise ValueError(f"Source is not HTML: {entry['id']}")
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError(f"Source exceeds size limit: {entry['id']}")
        document = raw.decode("utf-8")
    if "Vercel Security Checkpoint" in document or "cf-chl-" in document:
        raise ValueError(f"Source returned a security challenge: {entry['id']}")
    doc = Document()
    doc.feed(document)
    articles = [node for node in nodes(doc.root) if node.tag == "article"]
    if len(articles) != 1:
        raise ValueError(f"Expected one public article: {entry['id']}")
    bodies = [node for node in nodes(articles[0]) if "prose" in (node.attrs.get("class") or "").split()]
    if len(bodies) != 1:
        raise ValueError(f"Expected one article prose body: {entry['id']}")
    body = bodies[0]
    html = sanitize(body, entry["url"])
    stats = validate_html(html, entry["url"])
    cached = Document()
    cached.feed(html)
    if text_content(body).strip() != text_content(cached.root).strip():
        raise ValueError(f"Sanitization changed article text: {entry['id']}")
    return {**entry, "sourceLabel": "원문", "articleHtml": html}, stats


def write_notes(entries, stats):
    fetched = datetime.now(timezone.utc).isoformat(timespec="seconds")
    lines = [
        "# 블로그 본문 출처", "",
        f"확인·수집 시각: {fetched}. 사용자 본인이 작성한 공개 블로그 여섯 편을 기존 URL에서 HTTP 200으로 확인했다.", "",
        "본문은 `article` 안의 유일한 `.prose` 컨테이너에서 가져왔다. 원문 문장과 순서를 그대로 보존하며, 외부 블로그로 다시 이동하지 않고 작품 읽기 화면에서 바로 표시한다. 게시 제목·날짜 및 기존 연도 분류는 변경하지 않았다. 2025년 감상문은 게시일이 2026년이지만 기존 콘텐츠 연도인 2025년으로 유지한다.", "",
        "| 글 | 문단 | 목록 항목 | 이미지 | 본문 문자 |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for entry, stat in zip(entries, stats):
        lines.append(f"| [{entry['title']}]({entry['url']}) | {stat['paragraphs']} | {stat['list_items']} | {stat['images']} | {stat['characters']} |")
    lines.extend([
        "", "## 재현", "",
        "- 수집: `python3 scripts/sync-blog-articles.py` — 여섯 본문 모두 확인·정제·검증된 뒤에만 JSON을 갱신한다. 실패·보안 확인 화면·본문 누락은 기존 캐시를 유지한 채 오류로 종료한다.",
        "- 오프라인 검증: `python3 scripts/sync-blog-articles.py --check` — 본문 길이, 균형 잡힌 태그, 허용 태그·속성 및 링크·이미지 URL을 검사한다.",
        "- 본문 문자는 원문과 정제 결과가 정확히 일치하는지 비교한다. 헤더·작성자·날짜·TOC·댓글·사이트 푸터는 본문 컨테이너 바깥이므로 포함하지 않는다.",
        "- 허용된 문서 태그만 남긴다. 스크립트·iframe·SVG·스타일·이벤트 속성·클래스·ID·srcset은 포함하지 않는다. `del`은 원문 취소선 의미를 보존하기 위해 허용한다.",
        "- Next.js 이미지 래퍼와 데이터 URI 자리표시자는 제거한다. 실제 이미지는 작성자의 블로그 `/static/images/` 또는 원문 GitHub 업로드 `/51329156/` 주소만 사용한다. 다운로드한 이미지 파일은 없다.",
        "- `articleHtml`은 빌드에 포함되는 정적 캐시다. 본문 텍스트는 블로그가 일시적으로 응답하지 않아도 읽을 수 있으며, 외부 이미지는 원본 서버의 가용성에 의존한다. 링크는 HTTPS만 허용하고 새 창에 `noopener noreferrer`를 적용한다.",
        "- 원문에 포함된 ‘이어보기’와 인용·참고 링크는 글 내용으로 보존한다. 별도의 ‘글 읽기’ 버튼을 누를 필요는 없다.",
        "", "## 정제된 본문 SHA-256", "",
    ])
    for entry, stat in zip(entries, stats):
        lines.append(f"- `{entry['id']}`: `{stat['sha256']}`")
    NOTES_FILE.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate committed HTML without network access")
    args = parser.parse_args()
    entries = read_entries()
    if args.check:
        stats = [validate_html(entry.get("articleHtml", ""), entry["url"]) for entry in entries]
    else:
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(fetch_article, entries))
        entries, stats = map(list, zip(*results))
        # The entire batch has already validated; never write partial article results.
        DATA_FILE.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n")
        write_notes(entries, stats)
    for entry, stat in zip(entries, stats):
        print(f"{entry['id']}: {stat['characters']} characters, {stat['paragraphs']} paragraphs, {stat['images']} images — OK")


if __name__ == "__main__":
    main()
