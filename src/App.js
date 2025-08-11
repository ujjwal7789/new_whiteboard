import React, { useRef, useEffect, useState } from "react";

const WS_SERVER = "wss://new-whiteboard-backend.onrender.com";
const GRID_STYLES = [
  { value: "none", label: "No Grid" },
  { value: "square", label: "Square Grid" },
  { value: "dots", label: "Dot Grid" },
  { value: "ruled", label: "Ruled Lines" },
];

function App() {
  const gridCanvasRef = useRef(null);
  const drawCanvasRef = useRef(null);
  const ws = useRef(null);
  const drawing = useRef(false);
  const [ctx, setCtx] = useState(null);

  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#1e5cff");
  const [strokeSize, setStrokeSize] = useState(4);
  const [eraserSize, setEraserSize] = useState(12);
  const [gridStyle, setGridStyle] = useState("none");

  // Multi-page state
  const [pages, setPages] = useState([[]]);
  const [currentPage, setCurrentPage] = useState(0);

  // --- Draw grid background ---
  const drawGrid = (canvas, context, style) => {
    context.fillStyle = "#f5e2b8";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (style === "none") return;
    context.save();
    context.globalAlpha = 0.18;
    context.strokeStyle = "#6b5c19";
    context.fillStyle = "#6b5c19";
    if (style === "square") {
      for (let x = 0; x < canvas.width; x += 40) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvas.height);
        context.stroke();
      }
      for (let y = 0; y < canvas.height; y += 40) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(canvas.width, y);
        context.stroke();
      }
    } else if (style === "dots") {
      for (let x = 20; x < canvas.width; x += 40) {
        for (let y = 20; y < canvas.height; y += 40) {
          context.beginPath();
          context.arc(x, y, 2, 0, 2 * Math.PI);
          context.fill();
        }
      }
    } else if (style === "ruled") {
      for (let y = 30; y < canvas.height; y += 40) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(canvas.width, y);
        context.stroke();
      }
    }
    context.restore();
  };

  // --- Drawing layer canvas ---
  const clearCanvas = React.useCallback(() => {
    if (ctx && drawCanvasRef.current) {
      ctx.clearRect(
        0,
        0,
        drawCanvasRef.current.width,
        drawCanvasRef.current.height
      );
    }
  }, [ctx]);

  const redrawPage = React.useCallback(
    (pageIndex) => {
      if (!ctx) return;
      clearCanvas();
      (pages[pageIndex] || []).forEach((action) => {
        drawLine(
          ctx,
          action.prev,
          action.current,
          action.tool,
          action.color,
          action.strokeSize
        );
      });
    },
    [ctx, pages, clearCanvas]
  );

  const goToPage = (pageIndex) => {
    if (pageIndex < 0 || pageIndex >= pages.length) return;
    setCurrentPage(pageIndex);
    if (ws.current && ws.current.readyState === 1) {
      ws.current.send(`joinPage:${pageIndex}`);
    }
  };

  const addPage = () => {
    setPages((prevPages) => [...prevPages, []]);
    // Joining new page happens in useEffect when currentPage updates.
    setCurrentPage(pages.length);
  };

  const addDrawingAction = React.useCallback(
    (action) => {
      setPages((prevPages) => {
        const updatedPages = [...prevPages];
        updatedPages[currentPage] = [...updatedPages[currentPage], action];
        return updatedPages;
      });
    },
    [currentPage]
  );

  const handleNewDrawing = React.useCallback(
    (action) => {
      addDrawingAction(action); // Assuming addDrawingAction is stable or also memoized
      if (ctx) {
        drawLine(
          ctx,
          action.prev,
          action.current,
          action.tool,
          action.color,
          action.strokeSize
        );
      }
    },
    [ctx, addDrawingAction]
  );

  const drawLine = (context, start, end, tool, color, size) => {
    context.save();
    if (tool === "eraser") {
      context.globalCompositeOperation = "destination-out";
      context.strokeStyle = "rgba(0,0,0,1)";
    } else {
      context.globalCompositeOperation = "source-over";
      context.strokeStyle = color || "#000";
    }
    context.lineWidth = size;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.restore();
  };

  // --- WebSocket setup and syncing ---
  useEffect(() => {
    ws.current = new window.WebSocket(WS_SERVER);

    ws.current.onopen = () => {
      // Join the initial page
      ws.current.send(`joinPage:${currentPage}`);
    };

    ws.current.onmessage = async (message) => {
      let data = message.data;
      if (data instanceof Blob) data = await data.text();
      const msg = JSON.parse(data);

      if (msg.type === "history" && msg.page === currentPage) {
        // Replace current page history with server's version
        setPages((prev) => {
          const updated = [...prev];
          updated[currentPage] = (msg.data || [])
            .map((act) => {
              try {
                return typeof act === "string" ? JSON.parse(act) : act;
              } catch {
                return null;
              }
            })
            .filter(Boolean);
          return updated;
        });
      } else if (msg.type === "clear" && msg.page === currentPage) {
        setPages((prev) => {
          const updated = [...prev];
          updated[currentPage] = [];
          return updated;
        });
        clearCanvas();
      } else if (msg.page === currentPage && msg.prev && msg.current) {
        handleNewDrawing(msg);
      }
    };

    ws.current.onclose = () => {};
    return () => ws.current && ws.current.close();
  }, [currentPage, clearCanvas, handleNewDrawing]); // reinitialize on page switch

  // Setup drawing canvas
  useEffect(() => {
    if (drawCanvasRef.current) {
      const context = drawCanvasRef.current.getContext("2d");
      context.lineCap = "round";
      setCtx(context);
    }
  }, []);

  // Redraw content when needed
  useEffect(() => {
    redrawPage(currentPage);
  }, [currentPage, redrawPage]);

  // Redraw grid if style changes
  useEffect(() => {
    if (!gridCanvasRef.current) return;
    const canvas = gridCanvasRef.current;
    const context = canvas.getContext("2d");
    drawGrid(canvas, context, gridStyle);
  }, [gridStyle]);

  // Mouse events for drawing
  const getPos = (e) => {
    const rect = drawCanvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleMouseDown = (e) => {
    drawing.current = true;
    drawing.prev = getPos(e);
  };

  const handleMouseUp = () => {
    drawing.current = false;
  };

  const handleMouseMove = (e) => {
    if (!drawing.current || !ctx) return;
    const current = getPos(e);
    const size = tool === "pen" ? strokeSize : eraserSize;
    drawLine(ctx, drawing.prev, current, tool, color, size);
    const action = {
      page: currentPage,
      prev: drawing.prev,
      current,
      tool,
      color,
      strokeSize: size,
    };
    if (ws.current && ws.current.readyState === 1) {
      ws.current.send(JSON.stringify(action));
    }
    addDrawingAction(action);
    drawing.prev = current;
  };

  const handleClear = () => {
    setPages((prev) => {
      const updated = [...prev];
      updated[currentPage] = [];
      return updated;
    });
    clearCanvas();
    if (ws.current && ws.current.readyState === 1) {
      ws.current.send("clear");
    }
  };

  // --- Render UI ---
  return (
    <div
      style={{
        fontFamily: '"Segoe UI", Arial, sans-serif',
        background: "#f3eadb",
        minHeight: "100vh",
        padding: "16px",
      }}
    >
      <h2
        style={{
          textAlign: "center",
          marginBottom: 18,
          fontWeight: 700,
          color: "#7b602e",
          letterSpacing: "1px",
          textShadow: "0 1px 6px #d6c091",
        }}
      >
        Collaborative Whiteboard
      </h2>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginBottom: "20px",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            background: "#fef8f0",
            borderRadius: 16,
            boxShadow: "0 2px 12px rgba(123, 96, 46, 0.25)",
            padding: "16px 32px",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <label style={{ fontWeight: 600, color: "#7b602e" }}>
            Grid:
            <select
              style={{
                marginLeft: 7,
                fontSize: 16,
                borderRadius: 5,
                border: "1px solid #d6c091",
                padding: "2px 8px",
                background: "#fbf5e7",
                color: "#7b602e",
              }}
              value={gridStyle}
              onChange={(e) => setGridStyle(e.target.value)}
            >
              {GRID_STYLES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontWeight: 600, color: "#7b602e" }}>
            Tool:
            <select
              style={{
                marginLeft: 7,
                fontSize: 16,
                borderRadius: 5,
                border: "1px solid #d6c091",
                padding: "2px 8px",
                background: "#fbf5e7",
                color: "#7b602e",
              }}
              value={tool}
              onChange={(e) => setTool(e.target.value)}
            >
              <option value="pen">Pen</option>
              <option value="eraser">Eraser</option>
            </select>
          </label>
          {tool === "pen" && (
            <>
              <label style={{ fontWeight: 600, color: "#7b602e" }}>
                Color:
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  style={{
                    marginLeft: 7,
                    border: "none",
                    padding: 0,
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    boxShadow: "0 0 6px #d6c091",
                    background: "#f3eadb",
                    cursor: "pointer",
                  }}
                />
              </label>
              <label style={{ fontWeight: 600, color: "#7b602e" }}>
                Stroke:&nbsp;
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={strokeSize}
                  onChange={(e) => setStrokeSize(parseInt(e.target.value, 10))}
                  style={{
                    accentColor: "#7b602e",
                    height: 5,
                  }}
                />
                &nbsp;{strokeSize}px
              </label>
            </>
          )}
          {tool === "eraser" && (
            <label style={{ fontWeight: 600, color: "#7b602e" }}>
              Size:&nbsp;
              <input
                type="range"
                min="5"
                max="50"
                value={eraserSize}
                onChange={(e) => setEraserSize(parseInt(e.target.value, 10))}
                style={{
                  accentColor: "#a96532",
                  height: 5,
                }}
              />
              &nbsp;{eraserSize}px
            </label>
          )}
          <button
            onClick={handleClear}
            style={{
              padding: "8px 20px",
              border: "none",
              borderRadius: 8,
              background: "#a96532",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 15,
              boxShadow: "0 2px 8px rgba(169, 101, 50, 0.5)",
              transition: "background 0.3s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#7b5d29")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#a96532")}
          >
            Clear Board
          </button>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          marginBottom: 16,
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage === 0}
          style={{
            padding: "6px 14px",
            cursor: currentPage === 0 ? "not-allowed" : "pointer",
            background: currentPage === 0 ? "#f3eadb" : "#a96532",
            border: "none",
            borderRadius: 6,
            color: currentPage === 0 ? "#ccc" : "#fff",
            fontWeight: "600",
            boxShadow: "0 1px 5px rgba(169, 101, 50, 0.5)",
          }}
        >
          Previous Page
        </button>
        <div style={{ fontWeight: 600, color: "#7b602e" }}>
          Page {currentPage + 1} of {pages.length}
        </div>
        <button
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage === pages.length - 1}
          style={{
            padding: "6px 14px",
            cursor:
              currentPage === pages.length - 1 ? "not-allowed" : "pointer",
            background:
              currentPage === pages.length - 1 ? "#f3eadb" : "#a96532",
            border: "none",
            borderRadius: 6,
            color: currentPage === pages.length - 1 ? "#ccc" : "#fff",
            fontWeight: "600",
            boxShadow: "0 1px 5px rgba(169, 101, 50, 0.5)",
          }}
        >
          Next Page
        </button>
        <button
          onClick={addPage}
          style={{
            padding: "6px 16px",
            background: "#7b602e",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            fontWeight: "600",
            cursor: "pointer",
            boxShadow: "0 1px 5px rgba(123, 96, 46, 0.7)",
            marginLeft: 12,
          }}
        >
          Add Page
        </button>
      </div>
      <div
        style={{
          background: "#f5e2b8",
          borderRadius: 18,
          boxShadow: "0 2px 16px rgba(123, 96, 46, 0.3)",
          padding: "28px",
          maxWidth: "820px",
          margin: "auto",
          position: "relative",
          height: 620,
        }}
      >
        {/* Grid background canvas */}
        <canvas
          ref={gridCanvasRef}
          width={800}
          height={600}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            zIndex: 0,
            borderRadius: "10px",
            pointerEvents: "none",
            backgroundColor: "#f5e2b8",
          }}
        />
        {/* Drawing layer canvas */}
        <canvas
          ref={drawCanvasRef}
          width={800}
          height={600}
          style={{
            position: "relative",
            zIndex: 1,
            border: "3px solid #aa7b3b",
            borderRadius: "10px",
            boxShadow: "0 1px 14px rgba(188, 174, 134, 0.6)",
            display: "block",
            margin: "auto",
            cursor: tool === "pen" ? "crosshair" : "pointer",
            background: "transparent",
          }}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseOut={handleMouseUp}
          onMouseMove={handleMouseMove}
        />
        <p
          style={{
            textAlign: "center",
            marginTop: 16,
            marginBottom: 0,
            color: "#7b602e",
            fontSize: 17,
            fontWeight: 500,
            userSelect: "none",
          }}
        >
          Draw collaboratively with multiple pages, grid backgrounds, pen
          colors, and erase features.
        </p>
      </div>
    </div>
  );
}
export default App;
