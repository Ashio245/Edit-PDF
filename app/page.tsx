"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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

/**
 * SIDEBAR SORTABLE ITEM
 */
function SortableFileItem({
  file,
  index,
  onRemove,
  theme,
}: {
  file: FileItem;
  index: number;
  onRemove: () => void;
  theme: any;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: file.id });

  const rowStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    padding: "10px 12px",
    marginBottom: "6px",
    backgroundColor: theme.itemBg,
    border: `1px solid ${theme.border}`,
    borderRadius: "8px",
    fontSize: "12px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    cursor: "grab",
    color: theme.text,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  };

  return (
    <div ref={setNodeRef} style={rowStyle} {...attributes} {...listeners}>
      <span
        style={{
          color: theme.subText,
          fontSize: "10px",
          fontWeight: 600,
          width: "14px",
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
          fontWeight: 500,
        }}
      >
        {file.name}
      </div>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onRemove}
        style={{
          border: "none",
          background: "none",
          color: theme.subText,
          cursor: "pointer",
          padding: "4px",
          display: "flex",
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
 * PRE-MERGE PREVIEW CARD
 */
function PDFPreviewCard({
  file,
  pdfjs,
  theme,
  previewRenderTasks,
}: {
  file: FileItem;
  pdfjs: any;
  theme: any;
  previewRenderTasks: React.MutableRefObject<{ [key: string]: any }>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const lastRenderId = useRef<number>(0);

  useEffect(() => {
    if (!pdfjs || !file.buffer) return;
    const currentRenderId = ++lastRenderId.current;
    let isCancelled = false;

    const loadPreview = async () => {
      try {
        if (previewRenderTasks.current[file.id]) {
          previewRenderTasks.current[file.id].cancel();
        }
        const bufferCopy = file.buffer.slice(0);
        const loadingTask = pdfjs.getDocument({ data: bufferCopy });
        const pdf = await loadingTask.promise;

        if (isCancelled || currentRenderId !== lastRenderId.current) {
          await pdf.destroy();
          return;
        }

        setPageCount(pdf.numPages);
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.4 });
        const canvas = canvasRef.current;

        if (canvas) {
          const context = canvas.getContext("2d");
          if (!context) return;
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          if (isCancelled || currentRenderId !== lastRenderId.current) {
            await pdf.destroy();
            return;
          }

          const renderTask = page.render({ canvasContext: context, viewport });
          previewRenderTasks.current[file.id] = renderTask;
          await renderTask.promise;
        }
        await pdf.destroy();
      } catch (e: any) {
        if (e.name !== "RenderingCancelledException") console.error(e);
      }
    };
    loadPreview();
    return () => {
      isCancelled = true;
      if (previewRenderTasks.current[file.id])
        previewRenderTasks.current[file.id].cancel();
    };
  }, [file.id, file.buffer, pdfjs, previewRenderTasks]);

  return (
    <div
      style={{
        width: "180px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div
        style={{
          height: "240px",
          backgroundColor: "white",
          borderRadius: "10px",
          border: `1px solid ${theme.border}`,
          overflow: "hidden",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        }}
      >
        <canvas ref={canvasRef} style={{ maxWidth: "100%", height: "auto" }} />
      </div>
      <div style={{ textAlign: "center", padding: "0 4px" }}>
        <div
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: theme.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {file.name}
        </div>
        <div style={{ fontSize: "11px", color: theme.subText }}>
          {pageCount ? `${pageCount} pages` : "..."}
        </div>
      </div>
    </div>
  );
}

/**
 * MAIN COMPONENT
 */
export default function EditPDFLite() {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pdfjs, setPdfjs] = useState<any>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [mergedBytes, setMergedBytes] = useState<Uint8Array | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [darkMode, setDarkMode] = useState<boolean>(false);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);

  const [uploadedFiles, setUploadedFiles] = useState<FileItem[]>([]);
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
  const renderTasks = useRef<{ [key: number]: any }>({});
  const previewRenderTasks = useRef<{ [key: string]: any }>({});
  const sensors = useSensors(useSensor(PointerSensor));

  const selectedNote = selectedId
    ? annotations[selectedId.page]?.find((n) => n.id === selectedId.id) || null
    : null;

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("pdf-studio-theme");
      if (savedTheme === "dark") setDarkMode(true);
    }
    import("pdfjs-dist").then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
      setPdfjs(pdfjsLib);
    });
  }, []);

  const toggleDarkMode = () => {
    const nextMode = !darkMode;
    setDarkMode(nextMode);
    if (typeof window !== "undefined") {
      localStorage.setItem("pdf-studio-theme", nextMode ? "dark" : "light");
    }
  };

  const handleFileProcess = useCallback(async (files: FileList | File[]) => {
    const pdfFiles = Array.from(files).filter(
      (f) =>
        f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (pdfFiles.length === 0) return;

    const items: FileItem[] = [];
    for (let i = 0; i < pdfFiles.length; i++) {
      const b = await pdfFiles[i].arrayBuffer();
      items.push({
        id: `f-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`,
        name: pdfFiles[i].name,
        buffer: b,
      });
    }
    setUploadedFiles((prev) => [...prev, ...items]);
  }, []);

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0)
      setIsDraggingOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDraggingOver(false);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleFileProcess(e.dataTransfer.files);
      e.dataTransfer.clearData();
    }
  };

  const takeSnapshot = useCallback(() => {
    setPast((prev) => [...prev, deepCloneState({ strokes, annotations })]);
    setFuture([]);
  }, [strokes, annotations]);

  const undo = () => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setFuture((prev) => [deepCloneState({ strokes, annotations }), ...prev]);
    setPast((prev) => prev.slice(0, -1));
    setStrokes(previous.strokes);
    setAnnotations(previous.annotations);
  };

  const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setPast((prev) => [...prev, deepCloneState({ strokes, annotations })]);
    setFuture((prev) => prev.slice(1));
    setStrokes(next.strokes);
    setAnnotations(next.annotations);
  };

  const redrawStrokes = useCallback(
    (pageNum: number) => {
      const canvas = drawCanvasRefs.current[pageNum];
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      (strokes[pageNum] || []).forEach((s) => {
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
    },
    [strokes, zoom],
  );

  const renderAllPages = useCallback(
    async (pdf: any, scale: number) => {
      if (!pdf) return;
      setLoading(true);
      for (let i = 1; i <= pdf.numPages; i++) {
        if (renderTasks.current[i]) renderTasks.current[i].cancel();
        try {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale });
          const canvas = canvasRefs.current[i];
          if (canvas) {
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            const renderTask = page.render({ canvasContext: ctx, viewport });
            renderTasks.current[i] = renderTask;
            await renderTask.promise;
          }
          if (drawCanvasRefs.current[i]) {
            drawCanvasRefs.current[i]!.height = viewport.height;
            drawCanvasRefs.current[i]!.width = viewport.width;
            redrawStrokes(i);
          }
        } catch (e: any) {
          if (e.name !== "RenderingCancelledException") console.error(e);
        }
      }
      setLoading(false);
    },
    [zoom, redrawStrokes],
  );

  useEffect(() => {
    if (pdfDoc) renderAllPages(pdfDoc, zoom);
  }, [zoom, pdfDoc, renderAllPages]);

  useEffect(() => {
    if (pdfDoc) {
      for (let i = 1; i <= totalPages; i++) redrawStrokes(i);
    }
  }, [strokes, pdfDoc, totalPages, redrawStrokes]);

  const mergeAndLoad = async () => {
    if (uploadedFiles.length === 0 || !pdfjs) return;
    setLoading(true);
    setPdfDoc(null);
    setAnnotations({});
    setStrokes({});
    setPast([]);
    setFuture([]);
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
      console.error(e);
      alert("Merge error");
    } finally {
      setLoading(false);
    }
  };

  const updateNote = (
    page: number,
    id: number,
    updates: Partial<Annotation>,
  ) => {
    setAnnotations((prev) => ({
      ...prev,
      [page]: (prev[page] || []).map((n) =>
        n.id === id ? { ...n, ...updates } : n,
      ),
    }));
  };

  const nudge = (dx: number, dy: number) => {
    if (!selectedId) return;
    takeSnapshot();
    const note = annotations[selectedId.page]?.find(
      (n) => n.id === selectedId.id,
    );
    if (note)
      updateNote(selectedId.page, selectedId.id, {
        x: note.x + dx,
        y: note.y + dy,
      });
  };

  const downloadPDF = async () => {
    if (!mergedBytes) return;
    setLoading(true);
    try {
      const pdfLibDoc = await PDFDocument.load(mergedBytes.slice(0));
      const pages = pdfLibDoc.getPages();
      const hexToRgb = (hex: string) => {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return rgb(r, g, b);
      };
      for (let i = 1; i <= totalPages; i++) {
        const pdfPage = pages[i - 1];
        const { height: pageHeight } = pdfPage.getSize();
        (strokes[i] || []).forEach((s) => {
          for (let j = 0; j < s.points.length - 1; j++) {
            pdfPage.drawLine({
              start: { x: s.points[j].x, y: pageHeight - s.points[j].y },
              end: { x: s.points[j + 1].x, y: pageHeight - s.points[j + 1].y },
              thickness: s.width,
              color: hexToRgb(s.color),
            });
          }
        });
        (annotations[i] || []).forEach((n) => {
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
          pdfPage.drawText(n.text, {
            x: n.x,
            y: pageHeight - n.y - n.fontSize,
            size: n.fontSize,
            font: pdfLibDoc.embedStandardFont(fontVariant as any),
            maxWidth: n.width,
            color: hexToRgb(n.color || "#000000"),
          });
        });
      }
      const bytes = await pdfLibDoc.save();
      const freshBuffer = new ArrayBuffer(bytes.length);
      const uint8View = new Uint8Array(freshBuffer);
      uint8View.set(bytes);
      const blob = new Blob([freshBuffer], { type: "application/pdf" });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "Edited_Document.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 100);
    } catch (err) {
      console.error(err);
      alert("Export failure");
    } finally {
      setLoading(false);
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setUploadedFiles((items) => {
        const oldIndex = items.findIndex((it) => it.id === active.id);
        const newIndex = items.findIndex((it) => it.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
          return arrayMove(items, oldIndex, newIndex);
        }
        return items;
      });
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
    dropOverlay: darkMode
      ? "rgba(0, 113, 227, 0.15)"
      : "rgba(0, 113, 227, 0.08)",
  };

  const toolBtnStyle = (active: boolean) => ({
    padding: "6px 14px",
    backgroundColor: active ? theme.accent : "transparent",
    color: active ? "#ffffff" : theme.text,
    border: `1px solid ${active ? theme.accent : theme.border}`,
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.15s ease",
  });

  const iconBtnBase = (disabled?: boolean) => ({
    padding: "6px",
    background: "none",
    border: "none",
    color: disabled ? theme.subText : theme.text,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    borderRadius: "4px",
    display: "flex",
    alignItems: "center",
  });

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
        backgroundColor: color,
        borderRadius: "50%",
        border: `2px solid ${active ? theme.accent : "transparent"}`,
        boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.1)`,
        cursor: "pointer",
        padding: 0,
      }}
    />
  );

  if (!mounted) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: theme.bg,
        color: theme.text,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDraggingOver && !pdfDoc && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 9999,
            backgroundColor: theme.dropOverlay,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(4px)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              padding: "40px 60px",
              borderRadius: "20px",
              border: `2px dashed ${theme.accent}`,
              backgroundColor: theme.uiBg,
              boxShadow: "0 20px 40px rgba(0,0,0,0.1)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke={theme.accent}
              strokeWidth="1.5"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            <div
              style={{ fontSize: "20px", fontWeight: 600, color: theme.text }}
            >
              Drop to add PDFs
            </div>
          </div>
        </div>
      )}

      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "52px",
          padding: "0 16px",
          backgroundColor: theme.uiBg,
          borderBottom: `1px solid ${theme.border}`,
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ fontWeight: 600, fontSize: "14px" }}>PDF Studio</div>
          {pdfDoc && (
            <div
              style={{
                display: "flex",
                backgroundColor: darkMode ? "#3a3a3c" : "#e8e8ed",
                padding: "3px",
                borderRadius: "8px",
                gap: "2px",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setIsDrawMode(true);
                  setIsAddTextMode(false);
                  setSelectedId(null);
                }}
                style={toolBtnStyle(isDrawMode && !isAddTextMode) as any}
              >
                Markup
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddTextMode(true);
                  setIsDrawMode(false);
                  setSelectedId(null);
                }}
                style={toolBtnStyle(isAddTextMode) as any}
              >
                Text
              </button>
            </div>
          )}
          <input
            type="file"
            id="pdf-upload-input"
            multiple
            hidden
            accept="application/pdf"
            onChange={(e) =>
              e.target.files && handleFileProcess(e.target.files)
            }
          />
          <label htmlFor="pdf-upload-input" style={toolBtnStyle(false) as any}>
            Add Files
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {pdfDoc && (
            <div
              style={{
                display: "flex",
                gap: "4px",
                paddingRight: "8px",
                borderRight: `1px solid ${theme.border}`,
              }}
            >
              <button
                onClick={undo}
                disabled={past.length === 0}
                style={iconBtnBase(past.length === 0) as any}
                title="Undo"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M9 14L4 9l5-5" />
                  <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H13" />
                </svg>
              </button>
              <button
                onClick={redo}
                disabled={future.length === 0}
                style={iconBtnBase(future.length === 0) as any}
                title="Redo"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M15 14l5-5-5-5" />
                  <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H11" />
                </svg>
              </button>
            </div>
          )}
          {pdfDoc && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                backgroundColor: darkMode ? "#3a3a3c" : "#f2f2f7",
                borderRadius: "6px",
                padding: "2px 4px",
              }}
            >
              <button
                type="button"
                style={iconBtnBase() as any}
                onClick={() => setZoom((z) => Math.max(z - 0.1, 0.5))}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M5 12h14" />
                </svg>
              </button>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  minWidth: "35px",
                  textAlign: "center",
                }}
              >
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                style={iconBtnBase() as any}
                onClick={() => setZoom((z) => z + 0.1)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={toggleDarkMode}
            style={iconBtnBase() as any}
          >
            {darkMode ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          {pdfDoc && (
            <button
              type="button"
              onClick={downloadPDF}
              style={toolBtnStyle(true) as any}
            >
              Export PDF
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
            display: "flex",
            flexDirection: "column",
            padding: "16px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: theme.subText,
              textTransform: "uppercase",
              marginBottom: "12px",
            }}
          >
            Document Queue
          </div>
          <div style={{ flex: 1, overflowY: "auto", marginBottom: "16px" }}>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
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
                    onRemove={() =>
                      setUploadedFiles((prev) =>
                        prev.filter((x) => x.id !== f.id),
                      )
                    }
                    theme={theme}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
          <button
            type="button"
            onClick={mergeAndLoad}
            disabled={uploadedFiles.length === 0 || loading}
            style={{
              width: "100%",
              padding: "12px",
              backgroundColor:
                uploadedFiles.length > 0 ? theme.text : theme.border,
              color: theme.uiBg,
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              cursor:
                uploadedFiles.length > 0 && !loading ? "pointer" : "default",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Processing..." : "Merge & Edit"}
          </button>
        </aside>

        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {pdfDoc && (isDrawMode || selectedNote) && (
            <div
              style={{
                position: "absolute",
                top: "20px",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 1000,
                height: "48px",
                backgroundColor: theme.toolbarBg,
                backdropFilter: "blur(20px)",
                border: `1px solid ${theme.border}`,
                display: "flex",
                alignItems: "center",
                padding: "0 16px",
                gap: "16px",
                borderRadius: "12px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
              }}
            >
              {isDrawMode && !selectedNote && (
                <div
                  style={{ display: "flex", gap: "12px", alignItems: "center" }}
                >
                  <div style={{ display: "flex", gap: "6px" }}>
                    {PRESET_COLORS.slice(0, 5).map((c) => (
                      <ColorSwatch
                        key={c}
                        color={c}
                        active={strokeColor === c}
                        onClick={() => {
                          takeSnapshot();
                          setStrokeColor(c);
                        }}
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
                    onMouseDown={() => takeSnapshot()}
                    onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
                    style={{ width: "60px", accentColor: theme.accent }}
                  />
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: theme.subText,
                      width: "30px",
                    }}
                  >
                    {strokeWidth}px
                  </span>
                </div>
              )}
              {selectedNote && (
                <div
                  style={{ display: "flex", gap: "12px", alignItems: "center" }}
                >
                  <select
                    value={selectedNote.fontFamily}
                    onMouseDown={() => takeSnapshot()}
                    onChange={(e) =>
                      updateNote(selectedId!.page, selectedId!.id, {
                        fontFamily: e.target.value,
                      })
                    }
                    style={{
                      fontSize: "12px",
                      padding: "4px",
                      borderRadius: "6px",
                      border: `1px solid ${theme.border}`,
                      background: theme.itemBg,
                      color: theme.text,
                    }}
                  >
                    <option value="Helvetica">Sans</option>
                    <option value="TimesRoman">Serif</option>
                  </select>
                  <input
                    type="number"
                    value={selectedNote.fontSize}
                    onMouseDown={() => takeSnapshot()}
                    onChange={(e) =>
                      updateNote(selectedId!.page, selectedId!.id, {
                        fontSize: parseInt(e.target.value),
                      })
                    }
                    style={{
                      width: "40px",
                      fontSize: "12px",
                      border: `1px solid ${theme.border}`,
                      borderRadius: "4px",
                      textAlign: "center",
                    }}
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
                          isBold: !selectedNote.isBold,
                        });
                      }}
                      style={
                        {
                          ...iconBtnBase(),
                          padding: "4px 10px",
                          backgroundColor: selectedNote.isBold
                            ? theme.border
                            : "transparent",
                          borderRadius: 0,
                        } as any
                      }
                    >
                      B
                    </button>
                    <button
                      onClick={() => {
                        takeSnapshot();
                        updateNote(selectedId!.page, selectedId!.id, {
                          isItalic: !selectedNote.isItalic,
                        });
                      }}
                      style={
                        {
                          ...iconBtnBase(),
                          padding: "4px 10px",
                          backgroundColor: selectedNote.isItalic
                            ? theme.border
                            : "transparent",
                          borderRadius: 0,
                        } as any
                      }
                    >
                      I
                    </button>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span style={{ fontSize: "10px", fontWeight: 800 }}>W</span>
                    <input
                      type="range"
                      min="50"
                      max="600"
                      value={selectedNote.width}
                      onMouseDown={() => takeSnapshot()}
                      onChange={(e) =>
                        updateNote(selectedId!.page, selectedId!.id, {
                          width: parseInt(e.target.value),
                        })
                      }
                      style={{ width: "80px", accentColor: theme.accent }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {PRESET_COLORS.slice(0, 3).map((c) => (
                      <ColorSwatch
                        key={c}
                        color={c}
                        active={selectedNote.color === c}
                        onClick={() => {
                          takeSnapshot();
                          updateNote(selectedId!.page, selectedId!.id, {
                            color: c,
                          });
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "2px" }}>
                    <button
                      onClick={() => nudge(0, -2)}
                      style={iconBtnBase() as any}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M18 15l-6-6-6 6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => nudge(0, 2)}
                      style={iconBtnBase() as any}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => nudge(-2, 0)}
                      style={iconBtnBase() as any}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M15 18l-6-6 6-6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => nudge(2, 0)}
                      style={iconBtnBase() as any}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      if (selectedId) {
                        takeSnapshot();
                        setAnnotations((prev) => ({
                          ...prev,
                          [selectedId.page]: prev[selectedId.page].filter(
                            (n) => n.id !== selectedId.id,
                          ),
                        }));
                        setSelectedId(null);
                      }
                    }}
                    style={
                      {
                        ...iconBtnBase(),
                        color: "#e02020",
                        marginLeft: "4px",
                      } as any
                    }
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.1"
                    >
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )}

          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: pdfDoc ? "80px 40px" : "40px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "40px",
            }}
          >
            {!pdfDoc ? (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {uploadedFiles.length === 0 ? (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      color: theme.subText,
                      border: isDraggingOver
                        ? `2px dashed ${theme.accent}`
                        : "2px dashed transparent",
                      borderRadius: "24px",
                      margin: "20px",
                      transition: "all 0.2s ease",
                      backgroundColor: isDraggingOver
                        ? theme.dropOverlay
                        : "transparent",
                    }}
                  >
                    <div
                      style={{
                        width: "64px",
                        height: "64px",
                        borderRadius: "16px",
                        backgroundColor: darkMode ? "#2c2c2e" : "#e8e8ed",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: "20px",
                      }}
                    >
                      <svg
                        width="32"
                        height="32"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="12" y1="18" x2="12" y2="12" />
                        <polyline points="9 15 12 12 15 15" />
                      </svg>
                    </div>
                    <div
                      style={{
                        fontSize: "17px",
                        fontWeight: 600,
                        color: theme.text,
                        marginBottom: "4px",
                      }}
                    >
                      {isDraggingOver ? "Drop to add" : "No documents selected"}
                    </div>
                    <div style={{ fontSize: "14px" }}>
                      Drag and drop PDF files or use the Add button
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: "0 20px" }}>
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: 600,
                        color: theme.subText,
                        marginBottom: "24px",
                      }}
                    >
                      Workspace Preview
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "32px",
                        justifyContent: "flex-start",
                      }}
                    >
                      {uploadedFiles.map((file) => (
                        <PDFPreviewCard
                          key={file.id}
                          file={file}
                          pdfjs={pdfjs}
                          theme={theme}
                          previewRenderTasks={previewRenderTasks}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              Array.from({ length: totalPages }, (_, i) => i + 1).map(
                (pageNum) => (
                  <div
                    key={pageNum}
                    style={{ position: "relative" }}
                    onMouseMove={(e) => {
                      if (isDrawing && isDrawMode) {
                        const rect =
                          canvasRefs.current[pageNum]!.getBoundingClientRect();
                        setStrokes((prev) => {
                          const pageStrokes = [...(prev[pageNum] || [])];
                          if (pageStrokes.length > 0)
                            pageStrokes[pageStrokes.length - 1].points.push({
                              x: (e.clientX - rect.left) / zoom,
                              y: (e.clientY - rect.top) / zoom,
                            });
                          return { ...prev, [pageNum]: pageStrokes };
                        });
                        redrawStrokes(pageNum);
                      }
                      if (
                        isDraggingText &&
                        selectedId &&
                        selectedId.page === pageNum
                      ) {
                        const rect =
                          canvasRefs.current[pageNum]!.getBoundingClientRect();
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
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: "-28px",
                        left: "0",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        width: "100%",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: theme.subText,
                          textTransform: "uppercase",
                        }}
                      >
                        Page {pageNum}
                      </span>
                    </div>
                    <div
                      onMouseDown={(e) => {
                        const rect =
                          canvasRefs.current[pageNum]!.getBoundingClientRect();
                        const x = (e.clientX - rect.left) / zoom;
                        const y = (e.clientY - rect.top) / zoom;
                        if (isDrawMode) {
                          takeSnapshot();
                          setIsDrawing(true);
                          setStrokes((prev) => ({
                            ...prev,
                            [pageNum]: [
                              ...(prev[pageNum] || []),
                              {
                                points: [{ x, y }],
                                color: strokeColor,
                                width: strokeWidth,
                              },
                            ],
                          }));
                        } else if (isAddTextMode) {
                          takeSnapshot();
                          const n: Annotation = {
                            id: Date.now(),
                            text: "Edit text",
                            x,
                            y,
                            width: 150,
                            fontSize: 14,
                            color: "#1d1d1f",
                            bgColor: "",
                            textAlign: "left",
                            fontFamily: "Helvetica",
                            isBold: false,
                            isItalic: false,
                          };
                          setAnnotations((prev) => ({
                            ...prev,
                            [pageNum]: [...(prev[pageNum] || []), n],
                          }));
                          setSelectedId({ id: n.id, page: pageNum });
                          setIsAddTextMode(false);
                        }
                      }}
                      style={{
                        position: "relative",
                        backgroundColor: "#fff",
                        cursor: isDrawMode
                          ? "crosshair"
                          : isAddTextMode
                            ? "text"
                            : "default",
                        boxShadow:
                          "0 10px 30px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.04)",
                        border: `1px solid ${theme.border}`,
                        borderRadius: "2px",
                      }}
                    >
                      <canvas
                        ref={(el) => {
                          canvasRefs.current[pageNum] = el;
                        }}
                        style={{ display: "block" }}
                      />
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
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: "100%",
                          zIndex: 10,
                        }}
                      >
                        {(annotations[pageNum] || []).map((n) => (
                          <div
                            key={n.id}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              takeSnapshot();
                              setSelectedId({ id: n.id, page: pageNum });
                              setIsDraggingText(true);
                              const rect =
                                e.currentTarget.getBoundingClientRect();
                              setDragOffset({
                                x: e.clientX - rect.left,
                                y: e.clientY - rect.top,
                              });
                            }}
                            style={{
                              position: "absolute",
                              left: n.x * zoom,
                              top: n.y * zoom,
                              width: n.width * zoom,
                              border:
                                selectedId?.id === n.id
                                  ? `2px solid ${theme.accent}`
                                  : "1px dashed #d2d2d7",
                              cursor: "move",
                              borderRadius: "2px",
                            }}
                          >
                            <textarea
                              value={n.text}
                              onFocus={() => {
                                setSelectedId({ id: n.id, page: pageNum });
                              }}
                              onBlur={() => {
                                if (
                                  n.text !==
                                  past[past.length - 1]?.annotations[
                                    pageNum
                                  ]?.find((a) => a.id === n.id)?.text
                                )
                                  takeSnapshot();
                              }}
                              onChange={(e) =>
                                updateNote(pageNum, n.id, {
                                  text: e.target.value,
                                })
                              }
                              onMouseDown={(e) => e.stopPropagation()}
                              style={{
                                width: "100%",
                                background: "transparent",
                                border: "none",
                                outline: "none",
                                resize: "none",
                                fontSize: `${n.fontSize * zoom}px`,
                                fontFamily: n.fontFamily,
                                fontWeight: n.isBold ? "bold" : "normal",
                                fontStyle: n.isItalic ? "italic" : "normal",
                                color: n.color || "#1d1d1f",
                                padding: "4px",
                                display: "block",
                                overflow: "hidden",
                              }}
                              rows={n.text.split("\n").length || 1}
                            />
                          </div>
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
