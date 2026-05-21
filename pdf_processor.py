"""PDF processing: extract text, chunk, and store in knowledge base."""

import os
import re
import time
import uuid

import pdfplumber

from knowledge.schema import Concept


def extract_pdf_text(file_path: str) -> str:
    """Extract all text from a PDF file."""
    text_parts = []
    with pdfplumber.open(file_path) as pdf:
        for i, page in enumerate(pdf.pages):
            page_text = page.extract_text()
            if page_text:
                text_parts.append(f"[Page {i+1}]\n{page_text}")
    return "\n\n".join(text_parts)


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> list[str]:
    """Split text into overlapping chunks.

    Strategy:
    1. Split by paragraphs first
    2. Merge small paragraphs until chunk_size
    3. Keep overlap between chunks
    """
    # Split by double newline (paragraphs)
    paragraphs = re.split(r'\n{2,}', text)
    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    chunks = []
    current_chunk = ""

    for para in paragraphs:
        # If adding this paragraph exceeds chunk_size, save current and start new
        if current_chunk and len(current_chunk) + len(para) > chunk_size:
            chunks.append(current_chunk.strip())
            # Keep overlap from end of current chunk
            if overlap > 0 and len(current_chunk) > overlap:
                current_chunk = current_chunk[-overlap:] + "\n\n" + para
            else:
                current_chunk = para
        else:
            if current_chunk:
                current_chunk += "\n\n" + para
            else:
                current_chunk = para

    # Don't forget the last chunk
    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    # Handle case where a single paragraph is longer than chunk_size
    final_chunks = []
    for chunk in chunks:
        if len(chunk) > chunk_size * 2:
            # Split long chunks by sentences
            sentences = re.split(r'(?<=[。！？.!?])\s*', chunk)
            sub_chunk = ""
            for sent in sentences:
                if sub_chunk and len(sub_chunk) + len(sent) > chunk_size:
                    final_chunks.append(sub_chunk.strip())
                    sub_chunk = sent
                else:
                    sub_chunk += " " + sent if sub_chunk else sent
            if sub_chunk.strip():
                final_chunks.append(sub_chunk.strip())
        else:
            final_chunks.append(chunk)

    return final_chunks


def process_pdf(file_path: str, filename: str, store, session_id: str = "") -> dict:
    """Full pipeline: extract → chunk → store in ChromaDB.

    Returns: {filename, pages, chunks_stored, text_preview}
    """
    # Extract text
    text = extract_pdf_text(file_path)
    if not text.strip():
        return {"error": "无法从 PDF 中提取文本（可能是扫描版 PDF）"}

    # Count pages
    with pdfplumber.open(file_path) as pdf:
        page_count = len(pdf.pages)

    # Chunk
    chunks = chunk_text(text)

    # Store in ChromaDB as ideas (reuse the ideas collection for PDF content)
    pdf_id = uuid.uuid4().hex[:8]
    timestamp = time.time()

    from knowledge.schema import Idea
    ideas = []
    for i, chunk in enumerate(chunks):
        idea = Idea(
            text=chunk,
            agent_name=f"PDF:{filename}",
            round=i,
            topic=f"PDF Document: {filename}",
            session_id=session_id or f"pdf_{pdf_id}",
            domain="document",
            timestamp=timestamp,
            id=f"pdf_{pdf_id}_chunk_{i}",
        )
        ideas.append(idea)

    if ideas:
        store.add_ideas(ideas)

    # Extract and store key concepts from the PDF
    _extract_pdf_concepts(text[:3000], filename, store)

    return {
        "filename": filename,
        "pages": page_count,
        "chunks_stored": len(chunks),
        "text_length": len(text),
        "text_preview": text[:500] + "..." if len(text) > 500 else text,
    }


def _extract_pdf_concepts(text_preview: str, filename: str, store):
    """Extract key concepts from PDF preview text and store them."""
    # Simple keyword extraction based on frequency
    # (Avoids LLM call for faster processing)
    import re
    from collections import Counter

    # Remove common words and punctuation
    words = re.findall(r'[\u4e00-\u9fff]{2,}|[A-Za-z][a-z]{3,}', text_preview)

    # Count frequency
    counter = Counter(words)

    # Filter common stop words
    stop_words = {
        'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was',
        'were', 'been', 'have', 'has', 'had', 'not', 'but', 'can', 'will',
        'would', 'could', 'should', 'may', 'might', 'shall', 'into',
        '的', '是', '在', '了', '不', '有', '和', '就', '人', '也',
        '都', '我', '到', '说', '要', '会', '可以', '这', '上', '着',
        '把', '那', '你', '他', '她', '它', '们', '个', '能', '对',
        '一', '很', '但', '让', '被', '从', '用', '还', '个', '大',
    }

    concepts = []
    for word, count in counter.most_common(20):
        if word.lower() not in stop_words and count >= 2:
            concepts.append(Concept(
                name=word,
                description=f"(from {filename})",
                domain="document",
                mention_count=count,
            ))

    if concepts:
        store.add_concepts(concepts[:10])  # Store top 10


def search_pdf_content(query: str, store, top_k: int = 5) -> list[dict]:
    """Search for PDF content relevant to a query."""
    results = store.search_ideas(query, top_k=top_k)
    # Filter to only PDF-sourced content
    pdf_results = [
        r for r in results
        if r["metadata"].get("agent_name", "").startswith("PDF:")
    ]
    return pdf_results
