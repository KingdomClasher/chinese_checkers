function resolveSocketServerUrl() {
  const configuredUrl = String(window.CHINESE_CHECKERS_SOCKET_URL || "").trim();
  if (!configuredUrl) {
    return { url: window.location.origin, hasInvalidConfiguredUrl: false };
  }
  if (!URL.canParse(configuredUrl, window.location.origin)) {
    return { url: window.location.origin, hasInvalidConfiguredUrl: true };
  }
  const parsedUrl = new URL(configuredUrl, window.location.origin);
  if (window.location.protocol === "https:" && parsedUrl.protocol === "http:") {
    parsedUrl.protocol = "https:";
  }
  return { url: parsedUrl.origin, hasInvalidConfiguredUrl: false };
}

const socketConnection = resolveSocketServerUrl();
const socket = io(socketConnection.url);

const ROW_LENGTHS = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1];
const CELL_SIZE = 22;
const cellRadius = CELL_SIZE * 0.36;

const joinForm = document.getElementById("join-form");
const nameInput = document.getElementById("name");
const roomInput = document.getElementById("room");
const roomLabel = document.getElementById("room-label");
const statusEl = document.getElementById("status");
const playersEl = document.getElementById("players");
const boardEl = document.getElementById("board");

let state = null;
let selected = null;
let legalTargets = new Set();

function toKey(x, y) {
  return `${x},${y}`;
}

function createCells() {
  const cells = [];
  for (let row = 0; row < ROW_LENGTHS.length; row += 1) {
    const y = row - 8;
    const len = ROW_LENGTHS[row];
    const start = -(len - 1);
    for (let i = 0; i < len; i += 1) {
      const x = start + i * 2;
      cells.push({
        key: toKey(x, y),
        px: x * CELL_SIZE * 0.5,
        py: y * CELL_SIZE * 0.866
      });
    }
  }
  return cells;
}

const CELLS = createCells();
const bounds = CELLS.reduce(
  (acc, cell) => ({
    minX: Math.min(acc.minX, cell.px),
    maxX: Math.max(acc.maxX, cell.px),
    minY: Math.min(acc.minY, cell.py),
    maxY: Math.max(acc.maxY, cell.py)
  }),
  { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
);

boardEl.setAttribute(
  "viewBox",
  `${bounds.minX - CELL_SIZE} ${bounds.minY - CELL_SIZE} ${(bounds.maxX - bounds.minX) + CELL_SIZE * 2} ${(bounds.maxY - bounds.minY) + CELL_SIZE * 2}`
);

function getPlayer(id) {
  return state?.players.find((player) => player.id === id) || null;
}

function getViewDirection() {
  if (!state) return 1;
  const viewerIndex = state.players.findIndex((player) => player.id === state.youId);
  return viewerIndex === 0 ? -1 : 1;
}

function renderPlayers() {
  playersEl.innerHTML = "";
  if (!state) return;

  state.players.forEach((player) => {
    const li = document.createElement("li");
    const turnMark = state.turnPlayerId === player.id && state.started ? " (turn)" : "";
    const winnerMark = state.winnerId === player.id ? " (winner)" : "";
    li.textContent = `${player.name}${turnMark}${winnerMark}`;
    li.style.color = player.color;
    playersEl.appendChild(li);
  });
}

function renderStatus() {
  if (!state) {
    statusEl.textContent = "Join a room to start.";
    return;
  }

  if (state.winnerId) {
    statusEl.textContent = `${getPlayer(state.winnerId)?.name || "Player"} wins.`;
    return;
  }

  if (!state.started) {
    statusEl.textContent = "Waiting for another player.";
    return;
  }

  if (state.turnPlayerId === socket.id) {
    statusEl.textContent = "Your turn.";
  } else {
    statusEl.textContent = `${getPlayer(state.turnPlayerId)?.name || "Opponent"}'s turn.`;
  }
}

function renderBoard() {
  boardEl.innerHTML = "";
  const board = state?.board || {};
  const viewDirection = getViewDirection();

  CELLS.forEach((cell) => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", cell.px * viewDirection);
    circle.setAttribute("cy", cell.py * viewDirection);
    circle.setAttribute("r", cellRadius);
    circle.dataset.key = cell.key;

    const ownerId = board[cell.key];
    if (ownerId) {
      const owner = getPlayer(ownerId);
      circle.classList.add("piece");
      circle.style.fill = owner?.color || "#9ca3af";
      if (selected === cell.key) {
        circle.classList.add("selected");
      }
    } else if (legalTargets.has(cell.key)) {
      circle.classList.add("target");
    } else {
      circle.classList.add("hole");
    }

    boardEl.appendChild(circle);
  });
}

function rerender() {
  renderPlayers();
  renderStatus();
  renderBoard();
}

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!socket.connected) {
    statusEl.textContent = "Can't reach game server. Check SOCKET_SERVER_URL and CLIENT_ORIGIN.";
    return;
  }
  socket.emit("joinRoom", {
    name: nameInput.value,
    roomCode: roomInput.value
  });
});

boardEl.addEventListener("click", (event) => {
  if (!state || !state.started || state.winnerId) return;
  const key = event.target?.dataset?.key;
  if (!key) return;

  if (selected && legalTargets.has(key)) {
    socket.emit("move", { from: selected, to: key });
    selected = null;
    legalTargets = new Set();
    rerender();
    return;
  }

  if (state.turnPlayerId !== socket.id) return;
  if (state.board[key] !== socket.id) {
    selected = null;
    legalTargets = new Set();
    rerender();
    return;
  }

  selected = key;
  legalTargets = new Set();
  socket.emit("legalMoves", { from: key });
  rerender();
});

socket.on("joined", (payload) => {
  roomLabel.textContent = `Room: ${payload.roomCode}`;
});

socket.on("state", (nextState) => {
  state = nextState;
  if (!state.board[selected]) {
    selected = null;
    legalTargets = new Set();
  }
  rerender();
});

socket.on("legalMoves", (payload) => {
  if (payload.from !== selected) return;
  legalTargets = new Set(payload.moves || []);
  rerender();
});

socket.on("errorMessage", (message) => {
  statusEl.textContent = message;
});

socket.on("connect_error", () => {
  const setupHint = socketConnection.hasInvalidConfiguredUrl
    ? "SOCKET_SERVER_URL is invalid."
    : "Check SOCKET_SERVER_URL and CLIENT_ORIGIN.";
  statusEl.textContent = `Can't reach game server. ${setupHint}`;
});

socket.on("disconnect", () => {
  if (!state) {
    statusEl.textContent = "Disconnected from game server.";
  }
});
