"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * CONSTANTS
 */
const DEFAULT_EDITOR_ZOOM = 0.85;
const MIN_EDITOR_ZOOM = 0.5;
const MAX_EDITOR_ZOOM = 1.75;
const ZOOM_STEP = 0.05;

/**
 * TYPES
 */
interface FileItem {
  id: string;
  name: string;
  buffer: ArrayBuffer;
}

interface Stroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

interface Annotation {
  id: number;
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  color: string;
  bgColor: string;
  textAlign: "left" | "center" | "right";
  fontFamily: string;
  isBold: boolean;
  isItalic: boolean;
}

interface EditorState {
  strokes: { [page: number]: Stroke[] };
  annotations: { [page: number]: Annotation[] };
}

const PRESET_COLORS = [
  "#1d1d1f",
  "#ffffff",
  "#e02020",
  "#0071e3",
  "#28a745",
  "#f5a623",
  "#8e44ad",
  "#86868b",
];

/**
 * UTILS
 */
const deepCloneState = (state: EditorState): EditorState => {
  return JSON.parse(JSON.stringify(state));
};

const isExpectedPdfError = (err: any) => {
  return (
    err?.name === "RenderingCancelledException" ||
    err?.name === "AbortException" ||
    err?.message?.includes("cancelled") ||
    err?.message?.includes("Transport destroyed")
  );
};

/**
 * COMPONENT: PDF PAGE CANVAS (MEMOIZED)
 */
const PdfPageCanvas = memo(
  ({
    pageNum,
    pdfDoc,
    zoom,
    canvasRefs,
  }: {
    pageNum: number;
    pdfDoc: any;
    zoom: number;
    canvasRefs: React.MutableRefObject<{
      [key: number]: HTMLCanvasElement | null;
    }>;
  }) => {
    const renderTaskRef = useRef<any>(null);

    useEffect(() => {
      if (!pdfDoc) return;

      let isCancelled = false;
      const renderPage = async () => {
        try {
          if (renderTaskRef.current) {
            renderTaskRef.current.cancel();
            renderTaskRef.current = null;
          }

          const page = await pdfDoc.getPage(pageNum);
          if (isCancelled) return;

          const viewport = page.getViewport({ scale: zoom });
          const canvas = canvasRefs.current[pageNum];

          if (canvas) {
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderTask = page.render({ canvasContext: ctx, viewport });
            renderTaskRef.current = renderTask;

            await renderTask.promise;
          }
        } catch (err: any) {
          if (!isExpectedPdfError(err)) {
            console.error(`Error rendering page ${pageNum}:`, err);
          }
        }
      };

      renderPage();
      return () => {
        isCancelled = true;
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }
      };
    }, [pageNum, pdfDoc, zoom, canvasRefs]);

    return (
      <canvas
        ref={(el) => {
          canvasRefs.current[pageNum] = el;
        }}
        style={{ display: "block" }}
      />
    );
  },
);
PdfPageCanvas.displayName = "PdfPageCanvas";

/**
 * COMPONENT: STROKE CANVAS
 */
const StrokeCanvas = memo(
  ({
    pageNum,
    strokes,
    zoom,
    drawCanvasRefs,
    pdfCanvas,
  }: {
    pageNum: number;
    strokes: Stroke[];
    zoom: number;
    drawCanvasRefs: React.MutableRefObject<{
      [key: number]: HTMLCanvasElement | null;
    }>;
    pdfCanvas: HTMLCanvasElement | null;
  }) => {
    useEffect(() => {
      const canvas = drawCanvasRefs.current[pageNum];
      if (!canvas || !pdfCanvas) return;

      // Sync dimensions to match PDF canvas exactly
      canvas.width = pdfCanvas.width;
      canvas.height = pdfCanvas.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      (strokes || []).forEach((s) => {
        ctx.beginPath();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width * zoom;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        s.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x * zoom, p.y * zoom);
          else ctx.lineTo(p.x * zoom, p.y * zoom);
        });
        ctx.stroke();
      });
    }, [pageNum, strokes, zoom, drawCanvasRefs, pdfCanvas]);

    return (
      <canvas
        ref={(el) => {
          drawCanvasRefs.current[pageNum] = el;
        }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "none",
          zIndex: 5,
          width: "100%",
          height: "100%",
        }}
      />
    );
  },
);
StrokeCanvas.displayName = "StrokeCanvas";

/**
 * COMPONENT: TEXT ANNOTATION
 */
const TextAnnotation = memo(
  ({
    annotation,
    zoom,
    isSelected,
    onSelect,
    onUpdate,
    onCommit,
    onDragStart,
  }: {
    annotation: Annotation;
    zoom: number;
    isSelected: boolean;
    onSelect: () => void;
    onUpdate: (id: number, text: string) => void;
    onCommit: () => void;
    onDragStart: (e: React.MouseEvent, id: number) => void;
  }) => {
    const [localText, setLocalText] = useState(annotation.text);

    useEffect(() => {
      setLocalText(annotation.text);
    }, [annotation.text]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setLocalText(e.target.value);
      onUpdate(annotation.id, e.target.value);
    };

    return (
      <div
        onMouseDown={(e) => onDragStart(e, annotation.id)}
        style={{
          position: "absolute",
          left: annotation.x * zoom,
          top: annotation.y * zoom,
          width: annotation.width * zoom,
          backgroundColor: annotation.bgColor || "transparent",
          border: isSelected ? `2px solid #0071e3` : "1px dashed #d2d2d7",
          cursor: "move",
          borderRadius: "2px",
          zIndex: 15,
          pointerEvents: "auto",
        }}
      >
        <textarea
          value={localText}
          onFocus={onSelect}
          onBlur={onCommit}
          onChange={handleChange}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "none",
            fontSize: `${annotation.fontSize * zoom}px`,
            fontFamily: annotation.fontFamily,
            fontWeight: annotation.isBold ? "bold" : "normal",
            fontStyle: annotation.isItalic ? "italic" : "normal",
            color: annotation.color || "#1d1d1f",
            padding: "4px",
            display: "block",
            overflow: "hidden",
          }}
          rows={localText.split("\n").length || 1}
        />
      </div>
    );
  },
);
TextAnnotation.displayName = "TextAnnotation";

/**
 * SIDEBAR SORTABLE ITEM
 */
function SortableFileItem({
  file,
  index,
  onRemove,
  onSelect,
  isSelected,
  theme,
}: any) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: file.id });
  const rowStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    padding: "10px 12px",
    marginBottom: "6px",
    backgroundColor: isSelected ? theme.accent + "15" : theme.itemBg,
    border: `1px solid ${isSelected ? theme.accent : theme.border}`,
    borderRadius: "8px",
    fontSize: "12px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    color: theme.text,
  };
  return (
    <div ref={setNodeRef} style={rowStyle} onClick={onSelect}>
      <div
        {...attributes}
        {...listeners}
        style={{
          cursor: "grab",
          display: "flex",
          color: isSelected ? theme.accent : theme.subText,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="5" r="2" />
          <circle cx="9" cy="12" r="2" />
          <circle cx="9" cy="19" r="2" />
          <circle cx="15" cy="5" r="2" />
          <circle cx="15" cy="12" r="2" />
          <circle cx="15" cy="19" r="2" />
        </svg>
      </div>
      <span
        style={{
          color: isSelected ? theme.accent : theme.subText,
          fontSize: "10px",
          fontWeight: 600,
          width: "10px",
        }}
      >
        {index + 1}
      </span>
      <div
        style={{
          flex: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontWeight: isSelected ? 600 : 500,
          cursor: "pointer",
        }}
      >
        {file.name}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        style={{
          border: "none",
          background: "none",
          color: theme.subText,
          cursor: "pointer",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/**
 * PRE-MERGE PREVIEW
 */
function SelectedFilePreview({ file, pdfjs, theme }: any) {
  const [pages, setPages] = useState<number[]>([]);
  const canvasRefs = useRef<{ [key: number]: HTMLCanvasElement | null }>({});
  const renderTasks = useRef<{ [key: number]: any }>({});

  useEffect(() => {
    if (!pdfjs || !file.buffer) return;
    let isCancelled = false;
    let pdfDocInstance: any = null;

    const load = async () => {
      try {
        const pdf = await pdfjs.getDocument({ data: file.buffer.slice(0) })
          .promise;
        if (isCancelled) return pdf.destroy();
        pdfDocInstance = pdf;
        setPages(Array.from({ length: pdf.numPages }, (_, i) => i + 1));
        for (let i = 1; i <= pdf.numPages; i++) {
          if (isCancelled) break;
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 1.1 });
          const cvs = canvasRefs.current[i];
          if (cvs) {
            cvs.height = vp.height;
            cvs.width = vp.width;
            const renderTask = page.render({
              canvasContext: cvs.getContext("2d")!,
              viewport: vp,
            });
            renderTasks.current[i] = renderTask;
            try {
              await renderTask.promise;
            } catch (e) {
              if (!isExpectedPdfError(e)) throw e;
            }
          }
        }
      } catch (e) {
        if (!isExpectedPdfError(e)) console.error(e);
      }
    };
    load();
    return () => {
      isCancelled = true;
      Object.values(renderTasks.current).forEach((t) => t?.cancel());
      if (pdfDocInstance) pdfDocInstance.destroy();
    };
  }, [file, pdfjs]);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "850px",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "32px",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 600, color: theme.text }}>
          {file.name}
        </h2>
        <span style={{ fontSize: "13px", color: theme.subText }}>
          {pages.length} pages
        </span>
      </div>
      {pages.map((p) => (
        <div
          key={p}
          style={{
            boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
            border: `1px solid ${theme.border}`,
            background: "#fff",
            lineHeight: 0,
          }}
        >
          <canvas
            ref={(el) => {
              canvasRefs.current[p] = el;
            }}
            style={{ width: "100%", height: "auto" }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * MAIN PAGE
 */
export default function EditPDFLite() {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pdfjs, setPdfjs] = useState<any>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [mergedBytes, setMergedBytes] = useState<Uint8Array | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(DEFAULT_EDITOR_ZOOM);
  const [darkMode, setDarkMode] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);
  const [uploadedFiles, setUploadedFiles] = useState<FileItem[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [isAddTextMode, setIsAddTextMode] = useState(false);

  const [strokeColor, setStrokeColor] = useState("#e02020");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [isDrawing, setIsDrawing] = useState(false);

  const [strokes, setStrokes] = useState<{ [page: number]: Stroke[] }>({});
  const [annotations, setAnnotations] = useState<{
    [page: number]: Annotation[];
  }>({});
  const [past, setPast] = useState<EditorState[]>([]);
  const [future, setFuture] = useState<EditorState[]>([]);
  const [selectedId, setSelectedId] = useState<{
    id: number;
    page: number;
  } | null>(null);
  const [isDraggingText, setIsDraggingText] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const canvasRefs = useRef<{ [key: number]: HTMLCanvasElement | null }>({});
  const drawCanvasRefs = useRef<{ [key: number]: HTMLCanvasElement | null }>(
    {},
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      if (localStorage.getItem("pdf-studio-theme") === "dark")
        setDarkMode(true);
    }
    import("pdfjs-dist").then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
      setPdfjs(pdfjsLib);
    });
  }, []);

  useEffect(() => {
    if (
      uploadedFiles.length > 0 &&
      (!selectedFileId || !uploadedFiles.some((f) => f.id === selectedFileId))
    ) {
      setSelectedFileId(uploadedFiles[0].id);
    } else if (uploadedFiles.length === 0) setSelectedFileId(null);
  }, [uploadedFiles, selectedFileId]);

  const takeSnapshot = useCallback(() => {
    setPast((prev) => [...prev, deepCloneState({ strokes, annotations })]);
    setFuture([]);
  }, [strokes, annotations]);

  const handleFileProcess = useCallback(async (files: FileList | File[]) => {
    setLoading(true);
    const items: FileItem[] = [];
    for (const file of Array.from(files)) {
      const lower = file.name.toLowerCase();
      try {
        if (lower.endsWith(".pdf")) {
          items.push({
            id: `f-${Date.now()}-${Math.random()}`,
            name: file.name,
            buffer: await file.arrayBuffer(),
          });
        } else if (/\.(jpg|jpeg|png)$/.test(lower)) {
          const doc = await PDFDocument.create();
          const imgData = await file.arrayBuffer();
          const img = lower.endsWith(".png")
            ? await doc.embedPng(imgData)
            : await doc.embedJpg(imgData);
          const { width, height } = img.scale(1);
          doc
            .addPage([width, height])
            .drawImage(img, { x: 0, y: 0, width, height });
          const bytes = await doc.save();
          const buf = new ArrayBuffer(bytes.length);
          new Uint8Array(buf).set(bytes);
          items.push({
            id: `f-${Date.now()}-${Math.random()}`,
            name: file.name.replace(/\.[^/.]+$/, "") + ".pdf",
            buffer: buf,
          });
        }
      } catch (e) {
        console.error(e);
      }
    }
    setUploadedFiles((prev) => [...prev, ...items]);
    setLoading(false);
  }, []);

  const mergeAndLoad = async () => {
    if (uploadedFiles.length === 0 || !pdfjs) return;
    setLoading(true);
    setPdfDoc(null);
    setAnnotations({});
    setStrokes({});
    setPast([]);
    setFuture([]);
    setZoom(DEFAULT_EDITOR_ZOOM);
    try {
      const mergedPdf = await PDFDocument.create();
      for (const file of uploadedFiles) {
        const src = await PDFDocument.load(file.buffer.slice(0));
        const copied = await mergedPdf.copyPages(src, src.getPageIndices());
        copied.forEach((p) => mergedPdf.addPage(p));
      }
      const bytes = await mergedPdf.save();
      setMergedBytes(bytes);
      const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
    } catch (e) {
      if (!isExpectedPdfError(e)) console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const updateNote = useCallback(
    (page: number, id: number, updates: Partial<Annotation>) => {
      setAnnotations((prev) => ({
        ...prev,
        [page]: (prev[page] || []).map((n) =>
          n.id === id ? { ...n, ...updates } : n,
        ),
      }));
    },
    [],
  );

  const onTextUpdate = useCallback(
    (id: number, text: string) => {
      if (!selectedId) return;
      updateNote(selectedId.page, id, { text });
    },
    [selectedId, updateNote],
  );

  const onTextCommit = useCallback(() => {
    takeSnapshot();
  }, [takeSnapshot]);

  const downloadPDF = async () => {
    if (!mergedBytes) return;
    setLoading(true);
    try {
      const doc = await PDFDocument.load(mergedBytes.slice(0));
      const pages = doc.getPages();
      const hexToRgb = (hex: string) => {
        if (!hex || hex === "transparent") return null;
        return rgb(
          parseInt(hex.slice(1, 3), 16) / 255,
          parseInt(hex.slice(3, 5), 16) / 255,
          parseInt(hex.slice(5, 7), 16) / 255,
        );
      };
      for (let i = 1; i <= totalPages; i++) {
        const p = pages[i - 1];
        const { height: ph } = p.getSize();
        (strokes[i] || []).forEach((s) => {
          const c = hexToRgb(s.color);
          if (c)
            for (let j = 0; j < s.points.length - 1; j++)
              p.drawLine({
                start: { x: s.points[j].x, y: ph - s.points[j].y },
                end: { x: s.points[j + 1].x, y: ph - s.points[j + 1].y },
                thickness: s.width,
                color: c,
              });
        });
        (annotations[i] || []).forEach((n) => {
          const lh = n.fontSize * 1.2;
          const rh = n.text.split("\n").length * lh + 10;
          if (n.bgColor && n.bgColor !== "transparent") {
            const bg = hexToRgb(n.bgColor);
            if (bg)
              p.drawRectangle({
                x: n.x,
                y: ph - n.y - rh + 5,
                width: n.width,
                height: rh,
                color: bg,
              });
          }
          const tc = hexToRgb(n.color || "#000000");
          if (tc) {
            let fontVariant;
            if (n.isBold && n.isItalic)
              fontVariant = StandardFonts.HelveticaBoldOblique;
            else if (n.isBold) fontVariant = StandardFonts.HelveticaBold;
            else if (n.isItalic)
              fontVariant =
                n.fontFamily === "TimesRoman"
                  ? StandardFonts.TimesRomanItalic
                  : StandardFonts.HelveticaOblique;
            else
              fontVariant =
                n.fontFamily === "TimesRoman"
                  ? StandardFonts.TimesRoman
                  : StandardFonts.Helvetica;

            p.drawText(n.text, {
              x: n.x + 5,
              y: ph - n.y - n.fontSize - 2,
              size: n.fontSize,
              color: tc,
              font: doc.embedStandardFont(fontVariant as any),
              maxWidth: n.width - 10,
              lineHeight: lh,
            });
          }
        });
      }
      const b = await doc.save();
      const fb = new ArrayBuffer(b.length);
      new Uint8Array(fb).set(b);
      const url = URL.createObjectURL(
        new Blob([fb], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "Edited.pdf";
      a.click();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const theme = {
    bg: darkMode ? "#1c1c1e" : "#f5f5f7",
    uiBg: darkMode ? "#2c2c2e" : "#ffffff",
    toolbarBg: darkMode
      ? "rgba(44, 44, 46, 0.85)"
      : "rgba(255, 255, 255, 0.85)",
    sidebarBg: darkMode ? "#1c1c1e" : "#f5f5f7",
    border: darkMode ? "#3a3a3c" : "#d2d2d7",
    text: darkMode ? "#f5f5f7" : "#1d1d1f",
    subText: darkMode ? "#86868b" : "#6e6e73",
    itemBg: darkMode ? "#2c2c2e" : "#ffffff",
    accent: "#0071e3",
    dropOverlay: "rgba(0, 113, 227, 0.1)",
  };

  const selectedNoteObj = selectedId
    ? annotations[selectedId.page]?.find((n) => n.id === selectedId.id)
    : null;

  const nudge = (dx: number, dy: number) => {
    if (!selectedId || !selectedNoteObj) return;
    takeSnapshot();
    updateNote(selectedId.page, selectedId.id, {
      x: selectedNoteObj.x + dx,
      y: selectedNoteObj.y + dy,
    });
  };

  const ColorSwatch = ({
    color,
    active,
    onClick,
  }: {
    color: string;
    active: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "20px",
        height: "20px",
        backgroundColor: color === "transparent" ? "transparent" : color,
        borderRadius: "50%",
        border:
          color === "transparent"
            ? "1px solid #ccc"
            : `2px solid ${active ? theme.accent : "transparent"}`,
        boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.1)`,
        cursor: "pointer",
        padding: 0,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {color === "transparent" && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 0,
            width: "100%",
            height: "1px",
            background: "red",
            transform: "rotate(45deg)",
          }}
        />
      )}
    </button>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: theme.bg,
        color: theme.text,
        fontFamily: "sans-serif",
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounter.current++;
        setIsDraggingOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        dragCounter.current--;
        if (dragCounter.current === 0) setIsDraggingOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        dragCounter.current = 0;
        if (e.dataTransfer.files) handleFileProcess(e.dataTransfer.files);
      }}
    >
      {isDraggingOver && !pdfDoc && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            backgroundColor: theme.dropOverlay,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            style={{
              padding: "40px",
              borderRadius: "20px",
              border: `2px dashed ${theme.accent}`,
              backgroundColor: theme.uiBg,
            }}
          >
            <div style={{ fontSize: "20px", fontWeight: 600 }}>
              Drop PDFs or Images
            </div>
          </div>
        </div>
      )}

      <header
        style={{
          height: "52px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          backgroundColor: theme.uiBg,
          borderBottom: `1px solid ${theme.border}`,
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <div style={{ fontWeight: 600 }}>PDF Studio</div>
          {pdfDoc && (
            <div
              style={{
                display: "flex",
                background: darkMode ? "#3a3a3c" : "#e8e8ed",
                padding: "2px",
                borderRadius: "8px",
              }}
            >
              <button
                onClick={() => {
                  setIsDrawMode(true);
                  setIsAddTextMode(false);
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "none",
                  fontSize: "12px",
                  background: isDrawMode ? theme.accent : "transparent",
                  color: isDrawMode ? "#fff" : theme.text,
                  cursor: "pointer",
                }}
              >
                Markup
              </button>
              <button
                onClick={() => {
                  setIsAddTextMode(true);
                  setIsDrawMode(false);
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "none",
                  fontSize: "12px",
                  background: isAddTextMode ? theme.accent : "transparent",
                  color: isAddTextMode ? "#fff" : theme.text,
                  cursor: "pointer",
                }}
              >
                Text
              </button>
            </div>
          )}
          <input
            type="file"
            multiple
            hidden
            id="f-in"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) =>
              e.target.files && handleFileProcess(e.target.files)
            }
          />
          <label
            htmlFor="f-in"
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: `1px solid ${theme.border}`,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Add Files
          </label>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          {pdfDoc && (
            <div
              style={{
                display: "flex",
                gap: "8px",
                borderRight: `1px solid ${theme.border}`,
                paddingRight: "12px",
              }}
            >
              <button
                disabled={past.length === 0}
                onClick={() => {
                  const p = past[past.length - 1];
                  setFuture((f) => [
                    deepCloneState({ strokes, annotations }),
                    ...f,
                  ]);
                  setPast((prev) => prev.slice(0, -1));
                  setStrokes(p.strokes);
                  setAnnotations(p.annotations);
                }}
                style={{
                  opacity: past.length ? 1 : 0.4,
                  border: "none",
                  background: "none",
                  color: theme.text,
                  cursor: "pointer",
                }}
              >
                Undo
              </button>
              <button
                disabled={future.length === 0}
                onClick={() => {
                  const n = future[0];
                  setPast((p) => [
                    ...p,
                    deepCloneState({ strokes, annotations }),
                  ]);
                  setFuture((prev) => prev.slice(1));
                  setStrokes(n.strokes);
                  setAnnotations(n.annotations);
                }}
                style={{
                  opacity: future.length ? 1 : 0.4,
                  border: "none",
                  background: "none",
                  color: theme.text,
                  cursor: "pointer",
                }}
              >
                Redo
              </button>
            </div>
          )}
          {pdfDoc && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: darkMode ? "#3a3a3c" : "#f2f2f7",
                borderRadius: "6px",
                padding: "2px 8px",
              }}
            >
              <button
                onClick={() =>
                  setZoom((z) => Math.max(z - ZOOM_STEP, MIN_EDITOR_ZOOM))
                }
                style={{
                  border: "none",
                  background: "none",
                  color: theme.text,
                  cursor: "pointer",
                }}
              >
                -
              </button>
              <span
                style={{
                  fontSize: "11px",
                  minWidth: "40px",
                  textAlign: "center",
                }}
              >
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() =>
                  setZoom((z) => Math.min(z + ZOOM_STEP, MAX_EDITOR_ZOOM))
                }
                style={{
                  border: "none",
                  background: "none",
                  color: theme.text,
                  cursor: "pointer",
                }}
              >
                +
              </button>
            </div>
          )}
          <button
            onClick={() => {
              setDarkMode(!darkMode);
              localStorage.setItem(
                "pdf-studio-theme",
                !darkMode ? "dark" : "light",
              );
            }}
            style={{
              border: "none",
              background: "none",
              color: theme.text,
              cursor: "pointer",
            }}
          >
            {darkMode ? "Light" : "Dark"}
          </button>
          {pdfDoc && (
            <button
              onClick={downloadPDF}
              style={{
                padding: "6px 12px",
                background: theme.accent,
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Export
            </button>
          )}
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <aside
          style={{
            width: "260px",
            borderRight: `1px solid ${theme.border}`,
            backgroundColor: theme.sidebarBg,
            padding: "16px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              opacity: 0.6,
              marginBottom: "12px",
            }}
          >
            QUEUE
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => {
                if (e.over && e.active.id !== e.over.id)
                  setUploadedFiles((f) =>
                    arrayMove(
                      f,
                      f.findIndex((x) => x.id === e.active.id),
                      f.findIndex((x) => x.id === e.over.id),
                    ),
                  );
              }}
            >
              <SortableContext
                items={uploadedFiles.map((f) => f.id)}
                strategy={verticalListSortingStrategy}
              >
                {uploadedFiles.map((f, i) => (
                  <SortableFileItem
                    key={f.id}
                    file={f}
                    index={i}
                    isSelected={selectedFileId === f.id}
                    onSelect={() => setSelectedFileId(f.id)}
                    onRemove={() =>
                      setUploadedFiles((p) => p.filter((x) => x.id !== f.id))
                    }
                    theme={theme}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
          <button
            onClick={mergeAndLoad}
            disabled={uploadedFiles.length === 0 || loading}
            style={{
              marginTop: "16px",
              padding: "12px",
              background: theme.text,
              color: theme.uiBg,
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {loading ? "..." : "Merge & Edit"}
          </button>
        </aside>

        <main
          style={{
            flex: 1,
            overflowY: "auto",
            position: "relative",
            backgroundColor: theme.bg,
          }}
        >
          {pdfDoc && (isDrawMode || selectedNoteObj) && (
            <div
              style={{
                position: "absolute",
                top: "20px",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 1000,
                background: theme.toolbarBg,
                backdropFilter: "blur(10px)",
                border: `1px solid ${theme.border}`,
                borderRadius: "12px",
                padding: "8px 16px",
                display: "flex",
                gap: "16px",
                alignItems: "center",
                boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
              }}
            >
              {isDrawMode && !selectedNoteObj && (
                <div
                  style={{ display: "flex", gap: "12px", alignItems: "center" }}
                >
                  <div style={{ display: "flex", gap: "6px" }}>
                    {PRESET_COLORS.slice(0, 5).map((c) => (
                      <ColorSwatch
                        key={c}
                        color={c}
                        active={strokeColor === c}
                        onClick={() => setStrokeColor(c)}
                      />
                    ))}
                  </div>
                  <div
                    style={{
                      width: "1px",
                      height: "20px",
                      backgroundColor: theme.border,
                    }}
                  />
                  <input
                    type="range"
                    min="1"
                    max="15"
                    value={strokeWidth}
                    onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
                    style={{ width: "60px" }}
                  />
                  <span
                    style={{ fontSize: "11px", fontWeight: 600, width: "30px" }}
                  >
                    {strokeWidth}px
                  </span>
                </div>
              )}

              {selectedNoteObj && (
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <select
                    value={selectedNoteObj.fontFamily}
                    onChange={(e) => {
                      takeSnapshot();
                      updateNote(selectedId!.page, selectedId!.id, {
                        fontFamily: e.target.value,
                      });
                    }}
                    style={{
                      fontSize: "12px",
                      padding: "4px",
                      borderRadius: "4px",
                    }}
                  >
                    <option value="Helvetica">Sans</option>
                    <option value="TimesRoman">Serif</option>
                  </select>
                  <input
                    type="number"
                    value={selectedNoteObj.fontSize}
                    onChange={(e) => {
                      takeSnapshot();
                      updateNote(selectedId!.page, selectedId!.id, {
                        fontSize: parseInt(e.target.value),
                      });
                    }}
                    style={{ width: "40px", fontSize: "12px", padding: "4px" }}
                  />
                  <div
                    style={{
                      display: "flex",
                      border: `1px solid ${theme.border}`,
                      borderRadius: "6px",
                      overflow: "hidden",
                    }}
                  >
                    <button
                      onClick={() => {
                        takeSnapshot();
                        updateNote(selectedId!.page, selectedId!.id, {
                          isBold: !selectedNoteObj.isBold,
                        });
                      }}
                      style={{
                        padding: "4px 8px",
                        background: selectedNoteObj.isBold
                          ? theme.border
                          : "transparent",
                        border: "none",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      B
                    </button>
                    <button
                      onClick={() => {
                        takeSnapshot();
                        updateNote(selectedId!.page, selectedId!.id, {
                          isItalic: !selectedNoteObj.isItalic,
                        });
                      }}
                      style={{
                        padding: "4px 8px",
                        background: selectedNoteObj.isItalic
                          ? theme.border
                          : "transparent",
                        border: "none",
                        fontSize: "12px",
                        fontStyle: "italic",
                        cursor: "pointer",
                      }}
                    >
                      I
                    </button>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span style={{ fontSize: "10px", fontWeight: 700 }}>W</span>
                    <input
                      type="range"
                      min="50"
                      max="600"
                      value={selectedNoteObj.width}
                      onChange={(e) => {
                        takeSnapshot();
                        updateNote(selectedId!.page, selectedId!.id, {
                          width: parseInt(e.target.value),
                        });
                      }}
                      style={{ width: "60px" }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: "4px",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: "10px", fontWeight: 700 }}>T</span>
                    {PRESET_COLORS.slice(0, 3).map((c) => (
                      <ColorSwatch
                        key={c}
                        color={c}
                        active={selectedNoteObj.color === c}
                        onClick={() => {
                          takeSnapshot();
                          updateNote(selectedId!.page, selectedId!.id, {
                            color: c,
                          });
                        }}
                      />
                    ))}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: "4px",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: "10px", fontWeight: 700 }}>F</span>
                    <ColorSwatch
                      color="transparent"
                      active={selectedNoteObj.bgColor === "transparent"}
                      onClick={() => {
                        takeSnapshot();
                        updateNote(selectedId!.page, selectedId!.id, {
                          bgColor: "transparent",
                        });
                      }}
                    />
                    {PRESET_COLORS.slice(1, 4).map((c) => (
                      <ColorSwatch
                        key={c}
                        color={c}
                        active={selectedNoteObj.bgColor === c}
                        onClick={() => {
                          takeSnapshot();
                          updateNote(selectedId!.page, selectedId!.id, {
                            bgColor: c,
                          });
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "2px" }}>
                    <button
                      onClick={() => nudge(0, -2)}
                      style={{
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => nudge(0, 2)}
                      style={{
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => nudge(-2, 0)}
                      style={{
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      ←
                    </button>
                    <button
                      onClick={() => nudge(2, 0)}
                      style={{
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      →
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      takeSnapshot();
                      setAnnotations((p) => ({
                        ...p,
                        [selectedId!.page]: p[selectedId!.page].filter(
                          (n) => n.id !== selectedId!.id,
                        ),
                      }));
                      setSelectedId(null);
                    }}
                    style={{
                      color: "red",
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}

          <div
            style={{
              padding: pdfDoc ? "80px 40px" : "40px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            {!pdfDoc ? (
              uploadedFiles.length === 0 ? (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    marginTop: "100px",
                    opacity: 0.5,
                  }}
                >
                  <div style={{ fontSize: "17px", fontWeight: 600 }}>
                    No documents selected
                  </div>
                  <div style={{ fontSize: "14px" }}>
                    Drag PDFs or Images here
                  </div>
                </div>
              ) : (
                uploadedFiles.find((f: any) => f.id === selectedFileId) && (
                  <SelectedFilePreview
                    file={uploadedFiles.find(
                      (f: any) => f.id === selectedFileId,
                    )}
                    pdfjs={pdfjs}
                    theme={theme}
                  />
                )
              )
            ) : (
              Array.from({ length: totalPages }, (_, i) => i + 1).map(
                (pageNum) => (
                  <div
                    key={pageNum}
                    style={{
                      position: "relative",
                      marginBottom: "40px",
                      touchAction: "none",
                    }}
                    onMouseMove={(e) => {
                      const pdfCanvas = canvasRefs.current[pageNum];
                      if (!pdfCanvas) return;

                      if (isDrawing && isDrawMode) {
                        const rect = pdfCanvas.getBoundingClientRect();
                        setStrokes((prev) => {
                          const s = [...(prev[pageNum] || [])];
                          if (s.length) {
                            s[s.length - 1].points.push({
                              x: (e.clientX - rect.left) / zoom,
                              y: (e.clientY - rect.top) / zoom,
                            });
                          }
                          return { ...prev, [pageNum]: s };
                        });
                      }
                      if (isDraggingText && selectedId?.page === pageNum) {
                        const rect = pdfCanvas.getBoundingClientRect();
                        updateNote(pageNum, selectedId.id, {
                          x: (e.clientX - rect.left - dragOffset.x) / zoom,
                          y: (e.clientY - rect.top - dragOffset.y) / zoom,
                        });
                      }
                    }}
                    onMouseUp={() => {
                      if (isDrawing || isDraggingText) takeSnapshot();
                      setIsDrawing(false);
                      setIsDraggingText(false);
                    }}
                    onMouseDown={(e) => {
                      const pdfCanvas = canvasRefs.current[pageNum];
                      if (!pdfCanvas) return;

                      const rect = pdfCanvas.getBoundingClientRect();
                      const x = (e.clientX - rect.left) / zoom;
                      const y = (e.clientY - rect.top) / zoom;

                      if (isDrawMode) {
                        takeSnapshot();
                        setIsDrawing(true);
                        setStrokes((p) => ({
                          ...p,
                          [pageNum]: [
                            ...(p[pageNum] || []),
                            {
                              points: [{ x, y }],
                              color: strokeColor,
                              width: strokeWidth,
                            },
                          ],
                        }));
                      } else if (isAddTextMode) {
                        takeSnapshot();
                        const id = Date.now();
                        setAnnotations((p) => ({
                          ...p,
                          [pageNum]: [
                            ...(p[pageNum] || []),
                            {
                              id,
                              text: "New Text",
                              x,
                              y,
                              width: 150,
                              fontSize: 14,
                              color: "#1d1d1f",
                              bgColor: "transparent",
                              textAlign: "left",
                              fontFamily: "Helvetica",
                              isBold: false,
                              isItalic: false,
                            },
                          ],
                        }));
                        setSelectedId({ id, page: pageNum });
                        setIsAddTextMode(false);
                      }
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: "-25px",
                        fontSize: "11px",
                        fontWeight: 700,
                        opacity: 0.5,
                      }}
                    >
                      PAGE {pageNum}
                    </div>
                    <div
                      style={{
                        position: "relative",
                        background: "#fff",
                        boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
                        cursor: isDrawMode
                          ? "crosshair"
                          : isAddTextMode
                            ? "text"
                            : "default",
                      }}
                    >
                      <PdfPageCanvas
                        pageNum={pageNum}
                        pdfDoc={pdfDoc}
                        zoom={zoom}
                        canvasRefs={canvasRefs}
                      />
                      <StrokeCanvas
                        pageNum={pageNum}
                        strokes={strokes[pageNum] || []}
                        zoom={zoom}
                        drawCanvasRefs={drawCanvasRefs}
                        pdfCanvas={canvasRefs.current[pageNum]}
                      />
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          zIndex: 10,
                          pointerEvents: isDrawMode ? "none" : "auto",
                        }}
                      >
                        {(annotations[pageNum] || []).map((n) => (
                          <TextAnnotation
                            key={n.id}
                            annotation={n}
                            zoom={zoom}
                            isSelected={selectedId?.id === n.id}
                            onSelect={() =>
                              setSelectedId({ id: n.id, page: pageNum })
                            }
                            onUpdate={onTextUpdate}
                            onCommit={onTextCommit}
                            onDragStart={(e, id) => {
                              if (isDrawMode) return;
                              e.stopPropagation();
                              setSelectedId({ id, page: pageNum });
                              setIsDraggingText(true);
                              const r = e.currentTarget.getBoundingClientRect();
                              setDragOffset({
                                x: e.clientX - r.left,
                                y: e.clientY - r.top,
                              });
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ),
              )
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
