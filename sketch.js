// 雨水花瓶钟
// · 秒：每过一秒，画布上随机出现一道雨线（画在最前面）
// · 分钟：分钟一变，雨线全部消失，花瓶里的水升高一格（花瓶高度等分 60 格）
// · 小时：整点时一颗软边圆珠掉下来，落在底部随机的位置，碰到别的珠子就叠上去；一颗珠子 = 1 小时
//   最多 11 颗；到 12 点 / 0 点清空重来
// · 花瓶里插一枝线稿花：花瓶里的水会让花茎模糊弥散，并且每分钟折射一次
//   （水下花茎每一段 = 1 分钟，5 段一组）
// p5.js 1.x 和 2.x 都能运行

const VASE_SCALE = 0.625; // 花瓶大小
const LINE_W = 1;         // 线条粗细
const VASE_H = 400;       // 花瓶高度（瓶底 y = 0，瓶口 y = -400）
const PAPER = 'rgb(255, 255, 255)'; // 背景纸色

let rainLines = [];
let lastSecond = -1;
let lastMinute = -1;
let waterH = 0;  // 花瓶里画出来的水位（花瓶坐标，平滑变化）

// 小时珠子
let lastH12 = -1;
let fallOff = 0;    // 最新一颗珠子还没落到位的距离（0 = 已经落好）
let fallV = 0;      // 下落速度
let dropSlots = []; // 12 颗珠子的位置（开始时算一次）

let grain;        // 水的颗粒质感
let flowerSharp;  // 清晰的线稿花（当前颜色）
let flowerSoft;   // 模糊弥散版的花（水下用，当前颜色）
let flowerSharpW; // 白色原稿：换颜色时用它来染色，不用重新画、重新模糊
let flowerSoftW;

function setup() {
  createCanvas(500, 500);
  // 手机屏幕的像素密度常常是 3，图层会很大、很耗电；最多用 2 倍，画面一样清楚，运行更流畅
  pixelDensity(min(2, displayDensity()));

  // 打开时先对齐当前时间
  for (let i = 0; i <= second(); i++) {
    addRainLine();
  }
  lastSecond = second();
  lastMinute = minute();
  waterH = map(minute(), 0, 60, 0, VASE_H);
  lastH12 = hour() % 12;       // 打开时已经有的珠子直接摆好，不用掉下来
  dropSlots = makeDropSlots();
  console.log("minute:", minute());

  // 这些图层只需要画一次，之后每一帧直接贴上去
  grain = makeGrain();
  flowerSharpW = makeFlower(false); // 白色的原稿，只画一次
  flowerSoftW = makeFlower(true);
  flowerSharp = flowerSharpW;       // 一开始是白色
  flowerSoft = flowerSoftW;

  // 一打开就尝试直接播放雨声
  startAudio();
  // 如果浏览器拦住了自动播放：页面上任何一次点击、按键、触摸都会马上把声音打开（不一定要点画布）
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, startAudio, { passive: true });
  }
}



function draw() {
  background(0,0,0);

  const s = second();
  const m = minute();
  const h12 = hour() % 12; // 12 小时制：0–11

  // 分钟变了：清空雨线，在控制台记录
  if (m !== lastMinute) {
    rainLines = [];
    console.log("minute:", m);
    lastMinute = m;
  }

  // 秒数变了：加一道雨线，同时"滴答"响一声
  if (s !== lastSecond) {
    addRainLine();
    playDrip();
    lastSecond = s;
  }

  // 小时变了：多一颗珠子，从画布顶上掉下来
  if (h12 !== lastH12) {
    if (h12 > lastH12) {
      fallOff = -(dropSlots[h12 - 1].y + 40); // 从画布上方开始
      fallV = 0;
    }
    lastH12 = h12;
  }

  // 花瓶水位平滑变化（整点时花瓶的水退下去，变成一颗珠子）
  waterH = lerp(waterH, map(m, 0, 60, 0, VASE_H), 0.05);

  // ① 清晰的线稿花
  image(flowerSharp, 0, 0);
  drawVaseBody();

  // ③ 花瓶里的水（分钟）：只有这里会让花茎模糊，并且每分钟折射一次
  drawVaseWater(waterH);

  // ④ 花瓶轮廓 + 最后一分钟的溢出
  push();
  translate(width / 2, baseY());
  scale(VASE_SCALE);
  drawVaseOutline();
  if (m === 59) drawOverflow(s);
  pop();

  // ⑤ 小时珠子：随机落在底部，会叠起来
  drawHourDrops(h12);

  // ⑥ 雨线：画在最前面，用"差值"混合，颜色永远是底下的反色
  blendMode(DIFFERENCE);
  for (const r of rainLines) {
    stroke(60, 130, 220, r.alpha);   // ← 用蓝色，不用白色
    strokeWeight(r.w);
    line(r.x, r.y, r.x - r.len * rainSlant, r.y + r.len); // 倾斜程度由 rainSlant 决定
  }
  blendMode(BLEND);

  // ⑦ 还没开声音时，左上角小字提示（浏览器规定要先点一下页面才能出声）
  drawSoundHint();
}   // ← draw() 结束

// 瓶底在画布上的 y 坐标（留出线条粗细，避免被画布边缘切掉）
function baseY() {
  return height - LINE_W;
}

// ---------- 雨线 ----------

let rainSlant = 0.45;  // 雨的倾斜：正数 = 往左下斜，负数 = 往右下斜，0 = 垂直

// 点击画布：
// · 雨的方向左右翻转（已经在画面上的雨线也会一起变）
// · 花（花茎 + 椭圆）随机换一个颜色
function mousePressed() {
  startAudio(); // 第一次点击时打开声音
  rainSlant = -rainSlant;
  changeFlowerColor();
}

function addRainLine() {
  rainLines.push({
    x: random(-20, width + 20), // 两边都留空间，往哪边斜都能铺满
    y: random(-20, height - 60),
    len: random(15, 40),
    w: random(1, 1),
    alpha: random(200, 255)
  });
}

// ---------- 声音 ----------
// 所有声音都是用浏览器自带的 Web Audio 当场合成的，不需要额外的声音文件，也不用加 p5.sound
// · 每一秒：一声清脆的"滴"（水滴落进水里那种往上扬的音，每次音高随机一点）
// · 整点珠子落地：一声低沉的"咚"
// · 背景：一层很轻的沙沙雨声
// · 一打开就会尝试自动播放；如果浏览器拦住了，页面上随便点一下或按任意键就会开始
// · 按 M 键：静音 / 取消静音

const SOUND_VOLUME = 0.6;    // 总音量：0 = 没声音，1 = 最大
const DRIP_VOLUME = 0.5;     // 每秒"滴"一声的音量
const PLOP_VOLUME = 0.8;     // 整点珠子落地的音量
const RAIN_AMBIENCE = 0.05;  // 背景沙沙雨声的音量：0 = 关掉

let audioCtx = null;  // 声音的"总开关"
let masterGain;       // 总音量
let muted = false;

function startAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return; // 很老的浏览器不支持，就安静地跳过
  audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {}); // 试着直接开始
  masterGain = audioCtx.createGain();
  masterGain.gain.value = SOUND_VOLUME;
  masterGain.connect(audioCtx.destination);
  if (RAIN_AMBIENCE > 0) startRainAmbience();
}

function soundReady() {
  return audioCtx && audioCtx.state === 'running' && !muted;
}

// 一声"滴"：正弦波，音高在 0.04 秒里快速往上扬（真实水滴落水的声音就是往上扬的），再很快消失
// 开头再加一点点短促的噪声，像水滴碰到水面的那一下
function playDrip() {
  if (!soundReady()) return;
  const t = audioCtx.currentTime;
  const f0 = random(500, 900);           // 每次音高随机，听起来不会太机械

  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f0 * 2.2, t + 0.04);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(DRIP_VOLUME, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.13);

  playTick(t, DRIP_VOLUME * 0.25, 4000);
}

// 一声"咚"：比"滴"低很多、长一点，给整点落下的珠子用
function playPlop() {
  if (!soundReady()) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(320, t + 0.08);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(PLOP_VOLUME, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.5);

  playTick(t, PLOP_VOLUME * 0.2, 1500);
}

// 很短的一下噪声（几毫秒），用滤波器决定它听起来亮还是闷
function playTick(t, vol, freq) {
  const len = Math.floor(audioCtx.sampleRate * 0.02);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / len); // 越来越小
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  const g = audioCtx.createGain();
  g.gain.value = vol;
  src.connect(filter);
  filter.connect(g);
  g.connect(masterGain);
  src.start(t);
}

// 背景的沙沙雨声：一段 2 秒的白噪声，循环播放，再用滤波器把它变得柔和
function startRainAmbience() {
  const len = audioCtx.sampleRate * 2;
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;   // 把刺耳的高音去掉
  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 300;    // 把轰轰的低音去掉
  const g = audioCtx.createGain();
  g.gain.value = RAIN_AMBIENCE;
  src.connect(lp);
  lp.connect(hp);
  hp.connect(g);
  g.connect(masterGain);
  src.start();
}

// 按 M 键：静音 / 取消静音
function keyPressed() {
  if (key === 'm' || key === 'M') {
    startAudio();
    muted = !muted;
    if (masterGain) masterGain.gain.value = muted ? 0 : SOUND_VOLUME;
  }
}

// 只有在浏览器拦住了自动播放时，左上角才会显示一行小字；声音一开始就消失
function drawSoundHint() {
  if (audioCtx && audioCtx.state === 'running') return;
  noStroke();
  fill(255, 120);
  drawingContext.fillStyle = 'rgba(255, 255, 255, 0.47)'; // p5 2.x 有时会跳过重复的 fill()，这里直接设一次
  textSize(11);
  textAlign(LEFT, TOP);
  text('浏览器拦住了自动播放 · 点一下开启雨声', 10, 10);
}

// ---------- 花瓶形状 ----------

// 新的花瓶：梨形瓶 —— 喇叭口、细长的瓶颈、下半部鼓起来的圆肚子、底下一圈小圈足
// 花瓶坐标：瓶底 y = 0，瓶口 y = -400（高度不变，所以每分钟的水位还是 400 / 60）
// 只写右半边的轮廓，左半边是镜像
const LIP_HALF = 58;     // 瓶口半宽（喇叭口）
const NECK_HALF = 30;    // 瓶颈最细处的半宽
const NECK_Y = -330;     // 瓶颈最细处的高度
const BELLY_HALF = 148;  // 肚子最宽处的半宽
const BELLY_Y = -140;    // 肚子最宽处的高度
const FOOT_HALF = 58;    // 圈足（瓶底）的半宽
const BASE_HALF = FOOT_HALF;

// 右半边轮廓，从瓶口往下画到瓶底；dx = 整条往右挪多少（溢出的水流用）
function vaseRightSide(ctx, dx) {
  ctx.lineTo(LIP_HALF + dx, -400);
  ctx.bezierCurveTo(LIP_HALF - 13 + dx, -385, NECK_HALF + dx, -360, NECK_HALF + dx, NECK_Y);        // 喇叭口收到瓶颈
  ctx.bezierCurveTo(NECK_HALF + dx, -270, BELLY_HALF + dx, -250, BELLY_HALF + dx, BELLY_Y);         // 瓶颈鼓到肚子
  ctx.bezierCurveTo(BELLY_HALF + dx, -60, 80 + dx, -30, FOOT_HALF + 4 + dx, -14);                  // 肚子收到底
  ctx.lineTo(FOOT_HALF - 2 + dx, -8);                                                               // 圈足往里收一点
  ctx.lineTo(FOOT_HALF + dx, 0);
}

// 花瓶形状（花瓶坐标），加进当前路径
function vaseShape(ctx) {
  ctx.moveTo(-LIP_HALF, -400);
  vaseRightSide(ctx, 0);                         // 右边：从瓶口到瓶底
  ctx.lineTo(-FOOT_HALF, 0);                     // 瓶底
  // 左边：右边的镜像，从瓶底往上
  ctx.lineTo(-(FOOT_HALF - 2), -8);
  ctx.lineTo(-(FOOT_HALF + 4), -14);
  ctx.bezierCurveTo(-80, -30, -BELLY_HALF, -60, -BELLY_HALF, BELLY_Y);
  ctx.bezierCurveTo(-BELLY_HALF, -250, -NECK_HALF, -270, -NECK_HALF, NECK_Y);
  ctx.bezierCurveTo(-NECK_HALF, -360, -(LIP_HALF - 13), -385, -LIP_HALF, -400);
  ctx.closePath();
}

// 把花瓶轮廓加进当前路径（自动换算成画布坐标），用来裁切
function addVasePath(ctx) {
  ctx.save();
  ctx.translate(width / 2, baseY());
  ctx.scale(VASE_SCALE, VASE_SCALE);
  vaseShape(ctx);
  ctx.restore();
}

// 花瓶轮廓线：现在没有轮廓线；想要的话把 null 改成颜色，比如 'rgb(255, 255, 255)'
const VASE_OUTLINE = null;

function drawVaseOutline() {
  if (!VASE_OUTLINE) return;
  const ctx = drawingContext; // 调用前已经 translate + scale 到花瓶坐标
  ctx.save();
  ctx.strokeStyle = VASE_OUTLINE;
  ctx.lineWidth = LINE_W / VASE_SCALE;
  ctx.beginPath();
  vaseShape(ctx);
  ctx.stroke();
  ctx.restore();
}

// ---------- 水 ----------

// 水下的画面：水的渐变 →（花瓶里才有）折射的花茎 → 颗粒
// layer = 画在哪一张图层上
function paintUnderwater(layer, top, bottom, colors, withFlower) {
  const ctx = layer.drawingContext;
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, colors[0]);
  g.addColorStop(0.5, colors[1]);
  g.addColorStop(1, colors[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, top - WATER_SOFT, width, bottom - top + WATER_SOFT); // 往上多画一点，给柔和的水面留空间

  if (withFlower) drawRefractedFlower(ctx, top, 'soft'); // 这里只画弥散光晕，清晰的细线最后再画

  layer.image(grain, 0, 0);
}

// ---------- 折射：每一分钟一个折点 ----------

const LEVEL = VASE_H / 60;   // 每一分钟的水位高度（花瓶坐标）
const REFRACT_STEP = 1.8;    // 每过一分钟，花茎往右错开多少（画布像素）；改成 0 就关掉折射
const REFRACT_GAP = 0.8;     // 每一分钟之间留的小缺口（画布像素），让每一段分得开

// 把水下的花茎按分钟切成一条条横向窄条，每条错开一点，像折射一样
// · 每一分钟是一小段花茎，段和段之间有个小缺口 → 数段数就是分钟数
// · 每分钟往右错一格，5 分钟后跳回原位 → 花茎变成"5 级一组"的小台阶，方便 5 个 5 个地数
// which = 'soft'（只画弥散光晕）、'sharp'（只画清晰细线）
function drawRefractedFlower(ctx, top, which) {
  const L = LEVEL * VASE_SCALE;        // 一分钟在画布上的高度
  const bottom = baseY();
  const n = ceil((bottom - top) / L);  // 水面以下有几条

  for (let i = 0; i < n; i++) {
    const y1 = max(top, bottom - (i + 1) * L); // 这一条的上边（不超过水面）
    const y2 = bottom - i * L;                 // 这一条的下边
    if (y2 <= y1) continue;

    const dx = ((i % 5) - 2) * REFRACT_STEP;   // -2, -1, 0, 1, 2 格，然后重来

    if (which === 'soft') drawStrip(ctx, flowerSoft, y1, y2, dx, 0.6);                 // 淡淡的弥散光晕（连续的）
    if (which === 'sharp') drawStrip(ctx, flowerSharp, y1 + REFRACT_GAP, y2, dx, 0.9); // 清晰的细线（上面留个缺口）
  }
}

// 只贴图层里 y1 到 y2 这一条，并且横向挪 dx
// 用原生 drawImage 只复制这一小条，比每条都贴整张图快很多
function drawStrip(ctx, pg, y1, y2, dx, alpha) {
  const src = pg.elt || pg.canvas;
  const d = src.width / pg.width;      // 图层的像素密度
  ctx.globalAlpha = alpha;
  ctx.drawImage(src,
    0, y1 * d, pg.width * d, (y2 - y1) * d, // 从图层里取的那一条
    dx, y1, pg.width, y2 - y1);             // 贴到画布上的位置
  ctx.globalAlpha = 1;
}

// ---------- 花瓶里的水（分钟），外轮廓是软的 ----------

const WATER_SOFT = 4;  // 水的外轮廓有多柔和（像素）：0 = 硬边，越大越模糊

let waterLayer;  // 先把水画在这张图层上，修成软边以后再贴到画布
let vaseMask;    // 边缘模糊的花瓶形状，用来"剪"出软边的水（开始时做一次）

function drawVaseWater(h) {
  if (h < 0.5) return;
  if (!waterLayer) waterLayer = createGraphics(width, height);
  if (!vaseMask) vaseMask = makeVaseMask();

  const top = baseY() - h * VASE_SCALE;
  const g = waterLayer;
  const ctx = g.drawingContext;
  g.clear();

  // 1. 水的颜色、折射的花茎、颗粒（先不管形状）
  paintUnderwater(g, top, baseY(),
    ['rgb(45, 120, 215)', 'rgb(130, 175, 232)', 'rgb(210, 228, 246)'], true);

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in'; // 只留下"遮罩"有颜色的地方

  // 2. 用边缘模糊的花瓶形状剪一下 → 贴着瓶壁的那一圈变软
  const m = vaseMask.elt || vaseMask.canvas;
  ctx.drawImage(m, 0, 0, width, height);

  // 3. 水面也做成软的：水面上方慢慢变透明
  if (WATER_SOFT > 0) {
    const fade = ctx.createLinearGradient(0, top - WATER_SOFT, 0, top + WATER_SOFT);
    fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 1)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, top, width, height - top);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(0, 0, width, top);
  }
  ctx.restore();

  // 4. 清晰的折射花茎最后画，用硬边裁切
  //    （如果也被软边剪，最底下靠近瓶底的那一两段会被淡掉，数不出 5 段）
  ctx.save();
  ctx.beginPath();
  addVasePath(ctx);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(0, top, width, height - top);
  ctx.clip();
  drawRefractedFlower(ctx, top, 'sharp');
  ctx.restore();

  // 5. 贴到画布上
  image(g, 0, 0);
}

// 做一张边缘模糊的花瓶形状
// 小技巧：把花瓶画到画布外面很远的地方，只让它的"影子"（shadowBlur 会把影子模糊）落回画布上
// 比 filter(BLUR) 快很多，所有浏览器都支持
function makeVaseMask() {
  const pg = createGraphics(width, height);
  const c = pg.drawingContext;
  const d = pg.pixelDensity();
  const OFF = 10000;

  c.save();
  c.fillStyle = 'white';
  if (WATER_SOFT > 0) {
    c.shadowColor = 'white';
    c.shadowBlur = WATER_SOFT * 2 * d; // shadowBlur 按实际像素算
    c.shadowOffsetX = OFF * d;         // 影子往右挪回画布
    c.translate(-OFF, 0);              // 形状本身挪到画布左边外面
  }
  c.beginPath();
  addVasePath(c);
  c.fill();
  c.restore();
  return pg;
}

// ---------- 小时：珠子 ----------

// 一样大的软边圆珠：随机落在底部，花瓶左右两边都有，会自然堆起来
// · 每颗珠子随机选一个横向位置，然后像受重力一样往下落：
//   落到地面就停在地上；碰到已有的珠子，就叠在它上面
// · 所以有的地方是单颗，有的地方会叠成两三层的小堆，看起来是随机的
// · 避开花瓶；用固定的随机种子，每次打开位置都一样
const BEAD_R = 25;               // 珠子半径（全部一样大）
const BEAD_OVERLAP = 0.8;        // 两颗珠子中心最近的距离 = 直径 × 这个数（越小叠得越紧）
const BEAD_SOFT = 0.12;          // 边缘有多软：0 = 硬边，越大越模糊
const VASE_LEFT = 150;           // 花瓶在底部占的左右范围（避开这一段）
const VASE_RIGHT = 350;
const PILE_PULL = 2;             // 每颗珠子试几个位置、选落得最低的：1 = 完全随机（容易叠高），越大越平铺
const LAYOUT_SEED = 7;           // 换个数字就是另一种随机排法

// 珠子的颜色：和花瓶里的水同一组蓝色，每颗随机挑一个
const BEAD_COLORS = [
  [45, 120, 215],
  [85, 150, 228],
  [130, 175, 232],
  [175, 205, 242]
];

function makeDropSlots() {
  randomSeed(LAYOUT_SEED);
  const D = BEAD_R * 2 * BEAD_OVERLAP; // 中心之间的最小距离
  const slots = [];

  for (let i = 0; i < 12; i++) {
    let best = null;
    for (let k = 0; k < PILE_PULL; k++) {
      const x = randomBeadX();
      const y = landingY(x, slots, D);
      if (!best || y > best.y) best = { x, y };
    }
    slots.push({ x: best.x, y: best.y, r: BEAD_R, c: random(BEAD_COLORS) });
  }
  randomSeed(Date.now()); // 恢复真正的随机，雨线位置才会每次不一样
  return slots;
}

// 随机的横向位置：在花瓶左边或右边，不碰到花瓶和画布边缘
function randomBeadX() {
  const leftW = VASE_LEFT - 2 * BEAD_R - 4;           // 左边能放的宽度
  const rightW = width - VASE_RIGHT - 2 * BEAD_R - 4; // 右边能放的宽度
  const t = random(leftW + rightW);
  if (t < leftW) return BEAD_R + 4 + t;
  return VASE_RIGHT + BEAD_R + (t - leftW);
}

// 一颗珠子从 x 这个位置往下掉，会停在哪个高度
function landingY(x, slots, D) {
  let y = baseY() - BEAD_R * 0.85; // 先假设落在地上（往下压一点点，像软软地坐在地上）
  for (const o of slots) {
    const dx = abs(x - o.x);
    if (dx < D) {
      y = min(y, o.y - sqrt(D * D - dx * dx)); // 碰到下面的珠子，就叠在它上面
    }
  }
  return y;
}

// 把已经过去的小时画成珠子；最新那颗如果还在掉，就画在半空
function drawHourDrops(h12) {
  // 最新一颗的下落：重力加速，落到位就停
  if (fallOff < 0) {
    fallV += 0.6;
    fallOff = min(0, fallOff + fallV);
    if (fallOff === 0) playPlop(); // 刚落到位：低沉的"咚"一声
  }

  for (let i = 0; i < min(h12, dropSlots.length); i++) {
    const p = dropSlots[i];
    const y = i === h12 - 1 ? p.y + fallOff : p.y;
    drawDrop(p.x, y, p.r, p.c);
  }
}

// 一颗软边圆珠：和花瓶里的水用同一种质感
// · 上深下浅的渐变（和瓶里的水一样）
// · 边缘慢慢变透明，看起来模糊、晕开
// · 叠一层和瓶里的水同一张颗粒纹理
// 每种颜色的珠子只在第一次用到时画一次，存起来，之后每一帧直接贴上去
let beadSprites = {};

function drawDrop(cx, cy, r, c) {
  const key = c.join(',') + '/' + r;
  if (!beadSprites[key]) beadSprites[key] = makeBeadSprite(r, c);
  const pg = beadSprites[key];
  image(pg, cx - pg.width / 2, cy - pg.height / 2);
}

function makeBeadSprite(r, c) {
  const outer = r * (1 + BEAD_SOFT * 0.5); // 模糊的边会比珠子本身稍微大一圈
  const S = ceil(outer * 2) + 2;
  const pg = createGraphics(S, S);
  const ctx = pg.drawingContext;
  const cx = S / 2;
  const cy = S / 2;

  // 1. 上深下浅的渐变：上面是这颗珠子的颜色，下面往白色淡开
  const light = c.map(v => round(v + (255 - v) * 0.55));
  const g = ctx.createLinearGradient(0, cy - outer, 0, cy + outer);
  g.addColorStop(0, 'rgb(' + c.join(',') + ')');
  g.addColorStop(1, 'rgb(' + light.join(',') + ')');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // 2. 用一个从中心往外变透明的圆当"遮罩"，做出模糊的软边
  ctx.globalCompositeOperation = 'destination-in';
  const m = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
  m.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
  m.addColorStop(1 - BEAD_SOFT, 'rgba(0, 0, 0, 0.9)');
  m.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = m;
  ctx.fillRect(0, 0, S, S);

  // 3. 叠上颗粒：source-atop 只会画在珠子已有的地方，软边处颗粒也跟着淡掉
  ctx.globalCompositeOperation = 'source-atop';
  pg.image(grain, -random(width - S), -random(height - S)); // 每颗取颗粒纹理里不同的一块
  ctx.globalCompositeOperation = 'source-over';

  return pg;
}

// 溢出：瓶口鼓起一层水，一股水沿着右侧瓶颈、圆球外面流到地上
function drawOverflow(s) {
  const a = map(s, 0, 59, 60, 230);
  const ctx = drawingContext; // 调用前已经 translate + scale 到花瓶坐标

  // 瓶口上鼓起的水
  noStroke();
  fill(45, 120, 215, a);
  ellipse(0, -401, LIP_HALF * 2 + 6, 16);

  // 沿着右边外侧流下来的水：把右半边轮廓往外挪 6 再画一遍
  ctx.save();
  ctx.strokeStyle = 'rgba(60, 135, 222, ' + (a / 255).toFixed(2) + ')';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(LIP_HALF + 6, -400);
  vaseRightSide(ctx, 6);
  ctx.stroke();
  ctx.restore();

  // 地上的一小摊水，越积越大
  noStroke();
  fill(85, 150, 228, a);
  const w = map(s, 0, 59, 20, 160);
  ellipse(BASE_HALF + 40 + w * 0.25, -2, w, 10);
}

// ---------- 线稿花 ----------

// 一枝很简单的花：一根细长弯曲的花茎 + 三个叠在一起的椭圆当花头
// 不填色，只有白色线条
// soft = false：清晰的细线
// soft = true ：线条加粗再整体模糊，做出水下弥散的效果

// 花头的三个椭圆：[中心 x, 中心 y, 宽, 高]（花瓶坐标）
const PETALS = [
  // [140, -665, 96, 62],
  [170, -500, 84, 84],   // 宽和高一样 = 正圆
  // [190, -510, 70, 54]
];

function makeFlower(soft) {
  const pg = createGraphics(width, height);
  if (soft) pg.pixelDensity(1); // 反正要模糊，用低分辨率让模糊算得更快

  pg.push();
  pg.translate(width / 2, height - LINE_W);
  pg.scale(VASE_SCALE);
  pg.stroke(255,255,255);
  const sw = soft ? 6 / VASE_SCALE : LINE_W / VASE_SCALE;
  pg.strokeWeight(sw);
  drawFlowerShape(pg, sw);
  pg.pop();

  if (soft) pg.filter(BLUR, 6);
  return pg;
}

// 花朵的填充色：想要不填色就设成 null
const FLOWER_FILL = 'rgb(255, 255, 255)';

// 点击时随机换的颜色：橙、红橙、黄绿、浅黄绿
const FLOWER_COLORS = [
  [255, 140, 40],
  [255, 85, 35],
  [200, 205, 45],
  [225, 220, 80]
];
let flowerColorIndex = -1; // -1 = 还是原来的白色

// 随机换一个和现在不一样的颜色，把白色原稿染成这个颜色
function changeFlowerColor() {
  let i;
  do {
    i = floor(random(FLOWER_COLORS.length));
  } while (i === flowerColorIndex && FLOWER_COLORS.length > 1);
  flowerColorIndex = i;

  const c = FLOWER_COLORS[i];
  // 第一次换颜色时，各准备一张彩色图层；之后一直重复用这两张，只是重新染色
  if (flowerSharp === flowerSharpW) {
    flowerSharp = createGraphics(width, height);
    flowerSoft = createGraphics(width, height);
    flowerSoft.pixelDensity(1); // 和白色的模糊原稿一样，低分辨率就够了
  }
  tintInto(flowerSharp, flowerSharpW, c);
  tintInto(flowerSoft, flowerSoftW, c);
}

// 把白色图层 src 染成颜色 c，画到 dst 上：形状和透明度不变，只换颜色
// （source-in：新画的颜色只留在原来有东西的地方）
function tintInto(dst, src, c) {
  const ctx = dst.drawingContext;
  dst.clear();
  dst.image(src, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = 'rgb(' + c.join(',') + ')';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function drawFlowerShape(g, sw) {
  g.noFill();

  // 花茎
  // 起点放在瓶底（y = 0），这样最底下第 1 分钟那一格里也有花茎，第一组才会是完整的 5 段
  g.bezier(-30, 0, 10, -280, 20, -700, 180, -508);

  // 花头：三个椭圆的轮廓
  for (const p of PETALS) {
    g.ellipse(p[0], p[1], p[2], p[3]);
  }

  // 擦掉椭圆内部，只留外轮廓
  const c = g.drawingContext;
  c.save();
  c.globalCompositeOperation = 'destination-out';
  for (const p of PETALS) {
    c.beginPath();
    c.ellipse(p[0], p[1], p[2] / 2 - sw / 2, p[3] / 2 - sw / 2, 0, 0, TWO_PI);
    c.fill();
  }
  c.restore();

  // 再把颜色填回擦空的地方（刚好在轮廓线里面）
  if (FLOWER_FILL) {
    c.save();
    c.fillStyle = FLOWER_FILL;
    for (const p of PETALS) {
      c.beginPath();
      c.ellipse(p[0], p[1], p[2] / 2 - sw / 2, p[3] / 2 - sw / 2, 0, 0, TWO_PI);
      c.fill();
    }
    c.restore();
  }
}

function drawVaseBody() {
  const ctx = drawingContext;
  ctx.save();
  ctx.beginPath();
  addVasePath(ctx);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fill();
  ctx.restore();
}

// ---------- 颗粒纹理 ----------

// 细密的颗粒，像印刷品 / 胶片那样：每一个像素都随机变亮或变暗一点点
// 花瓶里的水和小时珠子都用这同一张纹理，质感就统一了
const GRAIN_AMOUNT = 60;  // 颗粒有多明显：0 = 没有颗粒，越大越粗糙

function makeGrain() {
  const pg = createGraphics(width, height);
  const c = pg.drawingContext;
  const w = pg.elt ? pg.elt.width : pg.canvas.width;   // 实际像素宽（高清屏会是 2 倍）
  const h = pg.elt ? pg.elt.height : pg.canvas.height;
  const img = c.createImageData(w, h);
  const d = img.data;

  // 直接改像素：比一个个画点快很多，也不会被 p5 编辑器误判成"死循环"
  for (let i = 0; i < d.length; i += 4) {
    const t = Math.random() * 2 - 1;          // -1 到 1
    const v = t > 0 ? 255 : 10;               // 一半像素变亮，一半变暗
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = t > 0 ? 255 : 40;              // 暗的颗粒稍微带一点蓝
    d[i + 3] = Math.abs(t) * Math.abs(t) * GRAIN_AMOUNT; // 大多数很淡，少数明显
  }
  c.putImageData(img, 0, 0);
  return pg;
}