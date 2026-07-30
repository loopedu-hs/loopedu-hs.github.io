document.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("js-ready");

  const canvas = document.querySelector("#snake-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const scoreEl = document.querySelector("#score");
  const highScoreEl = document.querySelector("#high-score");
  const livesEl = document.querySelector("#lives");
  const statusEl = document.querySelector("#game-status");
  const startButton = document.querySelector("#start-game");
  const pauseButton = document.querySelector("#pause-game");
  const restartButton = document.querySelector("#restart-game");
  const cols = 24;
  const rows = 18;
  const cell = 20;
  const tickMs = 160;
  const directions = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
  };
  let snake;
  let direction;
  let queuedDirection;
  let food;
  let enemies;
  let resurrection;
  let score;
  let foodBonus;
  let lives;
  let elapsed;
  let accumulator;
  let enemyClock;
  let lastFrame;
  let animationId = 0;
  let running = false;
  let paused = false;
  let invulnerableUntil = 0;

  const storedHighScore = Number(localStorage.getItem("loop-snake-high-score") || 0);
  let highScore = Number.isFinite(storedHighScore) ? storedHighScore : 0;
  highScoreEl.textContent = highScore;

  function sameCell(a, b) { return a && b && a.x === b.x && a.y === b.y; }
  function randomCell() { return { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) }; }
  function isBlocked(candidate) {
    return snake.some((part) => sameCell(part, candidate)) || enemies.some((enemy) => sameCell(enemy, candidate)) || sameCell(food, candidate) || sameCell(resurrection, candidate);
  }
  function freeCell() {
    let candidate = randomCell();
    for (let attempt = 0; attempt < 200 && isBlocked(candidate); attempt += 1) candidate = randomCell();
    return candidate;
  }
  function makeEnemy() {
    return { ...freeCell(), direction: { ...directions[Object.keys(directions)[Math.floor(Math.random() * 4)]] } };
  }
  function resetState() {
    snake = [{ x: 12, y: 9 }, { x: 11, y: 9 }, { x: 10, y: 9 }];
    direction = { ...directions.right };
    queuedDirection = { ...direction };
    food = null;
    enemies = [];
    resurrection = null;
    score = 0;
    foodBonus = 0;
    lives = 0;
    elapsed = 0;
    accumulator = 0;
    enemyClock = 0;
    invulnerableUntil = 0;
    food = freeCell();
    enemies = [makeEnemy(), makeEnemy(), makeEnemy()];
    updateHud();
    draw();
  }
  function updateHud() {
    scoreEl.textContent = score;
    livesEl.textContent = lives;
    highScoreEl.textContent = highScore;
  }
  function setStatus(message) { statusEl.textContent = message; }
  function setDirection(next) {
    const reference = queuedDirection || direction;
    if (!next || (reference.x + next.x === 0 && reference.y + next.y === 0)) return;
    queuedDirection = { ...next };
  }
  function spawnResurrection() {
    if (!resurrection) {
      resurrection = freeCell();
      setStatus("부활아이템이 나타났습니다.");
    }
  }
  function moveEnemies() {
    enemies = enemies.map((enemy) => {
      let nextDirection = enemy.direction;
      if (Math.random() < 0.35) nextDirection = { ...directions[Object.keys(directions)[Math.floor(Math.random() * 4)]] };
      let next = { x: enemy.x + nextDirection.x, y: enemy.y + nextDirection.y };
      if (next.x < 0 || next.x >= cols || next.y < 0 || next.y >= rows) {
        nextDirection = { x: -nextDirection.x, y: -nextDirection.y };
        next = { x: enemy.x + nextDirection.x, y: enemy.y + nextDirection.y };
      }
      return { ...enemy, ...next, direction: nextDirection };
    });
  }
  function gameOver(message) {
    running = false;
    paused = false;
    cancelAnimationFrame(animationId);
    if (score > highScore) {
      highScore = score;
      localStorage.setItem("loop-snake-high-score", String(highScore));
    }
    updateHud();
    pauseButton.disabled = true;
    restartButton.disabled = false;
    startButton.disabled = false;
    setStatus(message || "게임 오버! 재시작 버튼으로 다시 도전하세요.");
    draw();
  }
  function respawnSnake() {
    const path = [];
    for (let y = 0; y < rows; y += 1) {
      const columns = y % 2 === 0 ? Array.from({ length: cols }, (_, x) => x) : Array.from({ length: cols }, (_, x) => cols - 1 - x);
      columns.forEach((x) => path.push({ x, y }));
    }
    const length = snake.length;
    if (length >= path.length) {
      gameOver("게임 공간이 가득 차 더 움직일 수 없습니다.");
      return;
    }
    let start = 0;
    for (let candidate = 0; candidate <= path.length - length - 1; candidate += 1) {
      const segment = path.slice(candidate, candidate + length);
      const next = path[candidate + length];
      const blocked = segment.some((part) => enemies.some((enemy) => sameCell(enemy, part))) || enemies.some((enemy) => sameCell(enemy, next));
      if (!blocked) { start = candidate; break; }
    }
    const segment = path.slice(start, start + length).reverse();
    const head = segment[0];
    const next = path[start + length];
    snake = segment;
    direction = { x: next.x - head.x, y: next.y - head.y };
    queuedDirection = { ...direction };
  }
  function impactCollision(gameOverMessage) {
    if (elapsed < invulnerableUntil) return false;
    if (lives > 0) {
      lives -= 1;
      invulnerableUntil = elapsed + 1;
      respawnSnake();
      setStatus("부활아이템을 사용해 계속합니다.");
      updateHud();
      return true;
    }
    gameOver(gameOverMessage);
    return true;
  }
  function impactEnemy() { return impactCollision("게임 오버! 적과 부딪혔습니다."); }
  function step() {
    direction = queuedDirection;
    const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
    const outside = head.x < 0 || head.x >= cols || head.y < 0 || head.y >= rows;
    const selfHit = snake.some((part) => sameCell(part, head));
    if (outside || selfHit) {
      const collisionHandled = impactCollision("게임 오버! 벽 또는 몸에 부딪혔습니다.");
      if (!collisionHandled && running) respawnSnake();
      return;
    }
    const enemyHit = enemies.some((enemy) => Math.hypot(enemy.x - head.x, enemy.y - head.y) <= 0.55);
    if (enemyHit && impactEnemy()) return;
    snake.unshift(head);
    if (sameCell(head, food)) {
      foodBonus += 10;
      food = freeCell();
    } else {
      snake.pop();
    }
    if (sameCell(head, resurrection)) {
      lives += 1;
      resurrection = null;
      setStatus("부활아이템을 획득했습니다.");
    }
    updateHud();
  }
  function drawCell(item, color, radius = 0) {
    ctx.fillStyle = color;
    const x = item.x * cell;
    const y = item.y * cell;
    if (radius) { ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, radius, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
  }
  function drawMonster(item) {
    const x = item.x * cell;
    const y = item.y * cell;
    ctx.fillStyle = "#c76b7e";
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 17);
    ctx.lineTo(x + 3, y + 8);
    ctx.lineTo(x + 6, y + 3);
    ctx.lineTo(x + 9, y + 7);
    ctx.lineTo(x + 12, y + 3);
    ctx.lineTo(x + 17, y + 8);
    ctx.lineTo(x + 17, y + 17);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#163a4a";
    ctx.beginPath();
    ctx.arc(x + 8, y + 10, 1.5, 0, Math.PI * 2);
    ctx.arc(x + 13, y + 10, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x + 7, y + 14, 7, 1.5);
  }
  function drawHeart(item) {
    const x = item.x * cell;
    const y = item.y * cell;
    ctx.fillStyle = "#b95c8a";
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 17);
    ctx.bezierCurveTo(x + 8, y + 15, x + 3, y + 12, x + 3, y + 8);
    ctx.bezierCurveTo(x + 3, y + 4, x + 8, y + 3, x + 10, y + 6);
    ctx.bezierCurveTo(x + 12, y + 3, x + 17, y + 4, x + 17, y + 8);
    ctx.bezierCurveTo(x + 17, y + 12, x + 12, y + 15, x + 10, y + 17);
    ctx.fill();
    ctx.strokeStyle = "#f3f8fa";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  function draw() {
    ctx.fillStyle = "#163a4a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(243,248,250,.1)";
    for (let x = 0; x <= cols; x += 1) { ctx.beginPath(); ctx.moveTo(x * cell, 0); ctx.lineTo(x * cell, canvas.height); ctx.stroke(); }
    for (let y = 0; y <= rows; y += 1) { ctx.beginPath(); ctx.moveTo(0, y * cell); ctx.lineTo(canvas.width, y * cell); ctx.stroke(); }
    drawCell(food, "#e5a85b", 6);
    if (resurrection) drawHeart(resurrection);
    enemies.forEach(drawMonster);
    snake.forEach((part, index) => drawCell(part, index === 0 ? "#e6c46a" : "#75b9a6", 7));
  }
  function loop(now) {
    if (!running) return;
    const delta = Math.min(now - lastFrame, 250);
    lastFrame = now;
    if (!paused) {
      elapsed += delta / 1000;
      score = Math.floor(elapsed) + foodBonus;
      accumulator += delta;
      enemyClock += delta;
      if (!resurrection && elapsed >= 5 && Math.floor(elapsed / 5) > Math.floor((elapsed - delta / 1000) / 5)) spawnResurrection();
      if (enemyClock >= 240) { moveEnemies(); enemyClock = 0; }
      while (accumulator >= tickMs && running) { step(); accumulator -= tickMs; }
      updateHud();
    }
    draw();
    animationId = requestAnimationFrame(loop);
  }
  function startGame() {
    if (running) return;
    resetState();
    running = true;
    paused = false;
    lastFrame = performance.now();
    startButton.disabled = true;
    pauseButton.disabled = false;
    restartButton.disabled = false;
    pauseButton.textContent = "일시정지";
    setStatus("게임 중입니다. 적을 피하세요!");
    cancelAnimationFrame(animationId);
    animationId = requestAnimationFrame(loop);
  }
  function togglePause() {
    if (!running) return;
    paused = !paused;
    pauseButton.textContent = paused ? "계속하기" : "일시정지";
    setStatus(paused ? "일시정지했습니다." : "게임을 계속합니다.");
    lastFrame = performance.now();
  }
  function restartGame() {
    if (running) {
      if (score > highScore) {
        highScore = score;
        localStorage.setItem("loop-snake-high-score", String(highScore));
      }
      running = false;
      paused = false;
      cancelAnimationFrame(animationId);
    }
    startGame();
  }
  document.addEventListener("keydown", (event) => {
    const keyMap = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
    if (keyMap[event.key]) { event.preventDefault(); setDirection(directions[keyMap[event.key]]); }
    if (event.key === " ") { event.preventDefault(); togglePause(); }
  });
  document.querySelectorAll("[data-direction]").forEach((button) => button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    setDirection(directions[button.dataset.direction]);
  }, { passive: false }));
  startButton.addEventListener("click", startGame);
  pauseButton.addEventListener("click", togglePause);
  restartButton.addEventListener("click", restartGame);
  resetState();
});
