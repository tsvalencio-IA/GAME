const menu = document.getElementById("menu");
const game = document.getElementById("game");
const gameover = document.getElementById("gameover");

const startBtn = document.getElementById("startBtn");
const instruction = document.getElementById("instruction");
const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");
const finalScoreEl = document.getElementById("finalScore");
const video = document.getElementById("camera");

let score = 0;
let lives = 3;
let currentDirection = null;
let roundActive = false;
let lastX = null;

startBtn.onclick = startGame;

function startGame() {
  menu.classList.add("hidden");
  game.classList.remove("hidden");

  navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
    audio: false
  }).then(stream => {
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      nextRound();
      requestAnimationFrame(trackMovement);
    };
  }).catch(() => {
    alert("Permita o uso da câmera para jogar.");
  });
}

function nextRound() {
  roundActive = false;
  currentDirection = Math.random() > 0.5 ? "LEFT" : "RIGHT";
  instruction.textContent = currentDirection === "LEFT" ? "⬅️ ESQUERDA" : "➡️ DIREITA";

  setTimeout(() => {
    roundActive = true;
    lastX = null;

    setTimeout(() => {
      if (roundActive) {
        loseLife();
      }
    }, 2000);
  }, 1000);
}

function trackMovement() {
  if (video.videoWidth && roundActive) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sumX = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4 * 80) {
      const brightness = data[i] + data[i + 1] + data[i + 2];
      if (brightness > 500) {
        sumX += (i / 4) % canvas.width;
        count++;
      }
    }

    if (count > 30) {
      const avgX = sumX / count;

      if (lastX !== null) {
        const delta = avgX - lastX;

        if (delta > 20 && currentDirection === "RIGHT") {
          winRound();
        }

        if (delta < -20 && currentDirection === "LEFT") {
          winRound();
        }
      }

      lastX = avgX;
    }
  }

  requestAnimationFrame(trackMovement);
}

function winRound() {
  roundActive = false;
  score++;
  scoreEl.textContent = "Pontos: " + score;
  instruction.textContent = "✅ ACERTOU!";
  setTimeout(nextRound, 1000);
}

function loseLife() {
  roundActive = false;
  lives--;
  livesEl.textContent = "Vidas: " + lives;
  instruction.textContent = "❌ ERROU!";

  if (lives <= 0) {
    endGame();
  } else {
    setTimeout(nextRound, 1000);
  }
}

function endGame() {
  game.classList.add("hidden");
  gameover.classList.remove("hidden");
  finalScoreEl.textContent = "Pontuação final: " + score;
}
