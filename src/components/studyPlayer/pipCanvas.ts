type PipStudyItem = {
  japanese?: string | null;
  kana?: string | null;
  romaji?: string | null;
  portuguese?: string | null;
};

type DrawStudyPipCanvasOptions = {
  canvas: HTMLCanvasElement;
  item: PipStudyItem;
  currentIndex: number;
  totalItems: number;
  isPlaying: boolean;
};

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const isSpaceToken = text.includes(" ");
  const tokens = isSpaceToken ? text.split(" ") : text.split("");
  let line = "";
  let currentY = y;

  for (let n = 0; n < tokens.length; n++) {
    const testLine = line + tokens[n] + (isSpaceToken ? " " : "");
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, currentY);
      line = tokens[n] + (isSpaceToken ? " " : "");
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, currentY);
  return currentY;
}

export function drawStudyPipCanvas({
  canvas,
  item,
  currentIndex,
  totalItems,
  isPlaying,
}: DrawStudyPipCanvasOptions): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#1E293B";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#0F172A";
  ctx.fillRect(12, 12, canvas.width - 24, canvas.height - 24);

  ctx.fillStyle = "#1E293B";
  ctx.fillRect(12, 12, canvas.width - 24, 38);

  ctx.fillStyle = "#94A3B8";
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("NIHONGO LOOP - PIP STUDY", 26, 36);

  ctx.textAlign = "right";
  ctx.fillText(`${currentIndex + 1} / ${totalItems}`, canvas.width - 26, 36);

  ctx.textAlign = "center";
  ctx.fillStyle = "#FFFFFF";

  let yPos = 110;

  ctx.font = "bold 28px sans-serif";
  yPos = drawWrappedText(ctx, item.japanese || "", canvas.width / 2, yPos, canvas.width - 70, 36);

  if (item.kana) {
    yPos += 26;
    ctx.fillStyle = "#A78BFA";
    ctx.font = "bold 15px sans-serif";
    yPos = drawWrappedText(ctx, item.kana, canvas.width / 2, yPos, canvas.width - 70, 20);
  }

  if (item.romaji) {
    yPos += 22;
    ctx.fillStyle = "#94A3B8";
    ctx.font = "italic 12px system-ui, monospace";
    yPos = drawWrappedText(ctx, item.romaji.toUpperCase(), canvas.width / 2, yPos, canvas.width - 70, 16);
  }

  yPos += 14;
  ctx.strokeStyle = "#334155";
  ctx.beginPath();
  ctx.moveTo(80, yPos);
  ctx.lineTo(canvas.width - 80, yPos);
  ctx.stroke();

  if (item.portuguese) {
    yPos += 26;
    ctx.fillStyle = "#FDE047";
    ctx.font = "bold 16px system-ui, sans-serif";
    drawWrappedText(ctx, item.portuguese, canvas.width / 2, yPos, canvas.width - 90, 20);
  } else {
    yPos += 22;
    ctx.fillStyle = "#475569";
    ctx.font = "italic 12px system-ui, sans-serif";
    ctx.fillText("Sem traducao disponivel", canvas.width / 2, yPos);
  }

  ctx.fillStyle = isPlaying ? "#059669" : "#334155";
  ctx.fillRect(12, canvas.height - 48, canvas.width - 24, 36);

  ctx.textAlign = "center";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.fillText(
    isPlaying ? "TOCANDO AUTOMATICO - SESSAO DE ESTUDO ATIVA" : "SESSAO PAUSADA (CLIQUE PLAY PARA CONTINUAR)",
    canvas.width / 2,
    canvas.height - 26
  );
}
