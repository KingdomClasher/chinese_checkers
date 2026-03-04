const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN === "*" ? true : CLIENT_ORIGIN.split(",").map((origin) => origin.trim()),
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const ROW_LENGTHS = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1];
const DIRECTIONS = [
  [-2, 0],
  [2, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1]
];
const PLAYER_COLORS = ["#ef4444", "#3b82f6"];
const rooms = new Map();

function toKey(x, y) {
  return `${x},${y}`;
}

function fromKey(key) {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

function createBoardCells() {
  const cells = [];
  for (let row = 0; row < ROW_LENGTHS.length; row += 1) {
    const y = row - 8;
    const len = ROW_LENGTHS[row];
    const start = -(len - 1);
    for (let i = 0; i < len; i += 1) {
      const x = start + i * 2;
      cells.push({ x, y, key: toKey(x, y) });
    }
  }
  return cells;
}

const BOARD_CELLS = createBoardCells();
const BOARD_SET = new Set(BOARD_CELLS.map((cell) => cell.key));
const TOP_CAMP = BOARD_CELLS.filter((cell) => cell.y <= -5).map((cell) => cell.key);
const BOTTOM_CAMP = BOARD_CELLS.filter((cell) => cell.y >= 5).map((cell) => cell.key);

function randomRoomCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function normalizeRoomCode(rawCode) {
  const cleaned = (rawCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return cleaned || randomRoomCode();
}

function createRoom(code) {
  return {
    code,
    players: [],
    board: {},
    turn: 0,
    started: false,
    winnerId: null
  };
}

function getRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, createRoom(code));
  }
  return rooms.get(code);
}

function serializeState(room, viewerId) {
  return {
    roomCode: room.code,
    youId: viewerId,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color
    })),
    board: room.board,
    turnPlayerId: room.players[room.turn] ? room.players[room.turn].id : null,
    started: room.started,
    winnerId: room.winnerId
  };
}

function emitState(room) {
  room.players.forEach((player) => {
    io.to(player.id).emit("state", serializeState(room, player.id));
  });
}

function assignColors(room) {
  room.players.forEach((player, index) => {
    player.color = PLAYER_COLORS[index] || "#9ca3af";
  });
}

function startGame(room) {
  room.board = {};
  room.winnerId = null;
  room.turn = 0;
  room.started = true;

  [TOP_CAMP, BOTTOM_CAMP].forEach((camp, index) => {
    const player = room.players[index];
    if (!player) return;
    camp.forEach((key) => {
      room.board[key] = player.id;
    });
  });
}

function getLegalMoves(room, from) {
  if (!BOARD_SET.has(from) || !room.board[from]) return new Set();

  const origin = fromKey(from);
  const stepMoves = new Set();
  const jumpMoves = new Set();

  for (const [dx, dy] of DIRECTIONS) {
    const next = toKey(origin.x + dx, origin.y + dy);
    if (BOARD_SET.has(next) && !room.board[next]) {
      stepMoves.add(next);
    }
  }

  const queue = [origin];
  const visited = new Set([from]);

  while (queue.length > 0) {
    const current = queue.shift();
    for (const [dx, dy] of DIRECTIONS) {
      const mid = toKey(current.x + dx, current.y + dy);
      const landing = toKey(current.x + dx * 2, current.y + dy * 2);
      if (!BOARD_SET.has(mid) || !room.board[mid]) continue;
      if (!BOARD_SET.has(landing) || room.board[landing]) continue;
      if (visited.has(landing)) continue;
      visited.add(landing);
      jumpMoves.add(landing);
      queue.push(fromKey(landing));
    }
  }

  return new Set([...stepMoves, ...jumpMoves]);
}

function checkWinner(room, playerId) {
  const playerIndex = room.players.findIndex((player) => player.id === playerId);
  if (playerIndex === -1) return false;
  const goalCamp = playerIndex === 0 ? BOTTOM_CAMP : TOP_CAMP;
  return goalCamp.every((key) => room.board[key] === playerId);
}

function removePlayerFromRoom(socket) {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  if (!room) return;

  room.players = room.players.filter((player) => player.id !== socket.id);
  assignColors(room);

  if (room.players.length === 0) {
    rooms.delete(roomCode);
    socket.data.roomCode = null;
    return;
  }

  room.started = false;
  room.winnerId = null;
  room.board = {};
  room.turn = 0;
  emitState(room);
  socket.data.roomCode = null;
}

app.use(express.static("public"));

io.on("connection", (socket) => {
  socket.on("joinRoom", (payload) => {
    const roomCode = normalizeRoomCode(payload?.roomCode);
    const name = String(payload?.name || "Player").trim().slice(0, 24) || "Player";

    removePlayerFromRoom(socket);

    const room = getRoom(roomCode);
    if (room.players.length >= 2) {
      socket.emit("errorMessage", "Room is full (2 players max).");
      return;
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    room.players.push({ id: socket.id, name, color: "#9ca3af" });
    assignColors(room);

    socket.emit("joined", { roomCode, playerId: socket.id });

    if (room.players.length === 2) {
      startGame(room);
    }

    emitState(room);
  });

  socket.on("legalMoves", (payload) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.winnerId) return;
    if (!room.players[room.turn] || room.players[room.turn].id !== socket.id) return;

    const from = String(payload?.from || "");
    if (room.board[from] !== socket.id) {
      socket.emit("legalMoves", { from, moves: [] });
      return;
    }

    socket.emit("legalMoves", { from, moves: [...getLegalMoves(room, from)] });
  });

  socket.on("move", (payload) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.winnerId) return;
    const current = room.players[room.turn];
    if (!current || current.id !== socket.id) return;

    const from = String(payload?.from || "");
    const to = String(payload?.to || "");
    if (room.board[from] !== socket.id || room.board[to]) return;

    const legalMoves = getLegalMoves(room, from);
    if (!legalMoves.has(to)) return;

    room.board[to] = room.board[from];
    delete room.board[from];

    if (checkWinner(room, socket.id)) {
      room.winnerId = socket.id;
      room.started = false;
    } else {
      room.turn = (room.turn + 1) % room.players.length;
    }

    emitState(room);
  });

  socket.on("disconnect", () => {
    removePlayerFromRoom(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Chinese Checkers server running on http://localhost:${PORT}`);
});
